import { nanoid } from 'nanoid'
import { eq, and, asc } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { messages, branches, sessionMembers, messageMentions } from '../db/schema.js'
import { bus } from '../events.js'
import { checkRateLimit } from '../lib/rateLimit.js'
import { findMentionedLabels } from '../lib/mentions.js'
import { sessionAgentTokens } from './sessions.js'
import type { Message } from '@tandem/shared'

function now() { return new Date().toISOString() }

function rowToMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    branchId: row.branchId,
    parentId: row.parentId ?? null,
    authorType: row.authorType,
    authorId: row.authorId,
    agentLabel: row.agentLabel ?? null,
    model: row.model ?? null,
    content: row.content,
    status: row.status,
    createdAt: row.createdAt,
  }
}

// ─── Get messages on a branch path ───────────────────────────────────────────
// Returns all messages from root to the branch head, in order.

export async function getBranchMessages(
  actor: { userId: string },
  branchId: string,
): Promise<Message[] | null> {
  const db = getDb()

  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch) return null

  // Check session membership
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, branch.sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return null

  // Walk the path from root to head by following parent_id links
  const allMessages = db.select().from(messages)
    .where(eq(messages.sessionId, branch.sessionId))
    .orderBy(asc(messages.createdAt))
    .all()

  // Build parent→children map and walk from head up to root, then reverse
  if (!branch.headMessageId) return []

  const msgById = new Map(allMessages.map((m) => [m.id, m]))
  const path: typeof allMessages[0][] = []
  let cur: typeof allMessages[0] | undefined = msgById.get(branch.headMessageId)
  while (cur) {
    path.push(cur)
    cur = cur.parentId ? msgById.get(cur.parentId) : undefined
  }
  path.reverse()
  return path.map(rowToMessage)
}

// ─── Post a message ───────────────────────────────────────────────────────────

export async function postMessage(
  actor: { userId: string; tokenKind: 'desktop' | 'agent'; tokenId?: string; tokenLabel?: string },
  branchId: string,
  content: string,
  triggerAi: boolean,
): Promise<{ userMessage: Message; pendingAssistantId?: string }> {
  const db = getDb()

  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch) throw Object.assign(new Error('Branch not found'), { code: 'not_found', status: 404 })

  // Permission: main branch → any member; other branches → owner only
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, branch.sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) throw Object.assign(new Error('Not a member'), { code: 'forbidden', status: 403 })

  if (!branch.isMain && branch.ownerId !== actor.userId) {
    throw Object.assign(new Error('Only the branch owner can post here'), { code: 'forbidden', status: 403 })
  }

  if (!checkRateLimit(actor.userId)) {
    throw Object.assign(new Error('Rate limit exceeded (100 messages/hour)'), { code: 'rate_limited', status: 429 })
  }

  const authorType = actor.tokenKind === 'agent' ? 'agent' : 'user'
  const msgId = nanoid()
  const ts = now()
  const parentId = branch.headMessageId ?? null

  // @mentions of session agents; an agent never mentions itself.
  const agentTokens = sessionAgentTokens(branch.sessionId).map((r) => r.token).filter((t) => t.id !== actor.tokenId)
  const mentionedLabels = new Set(findMentionedLabels(content, [...new Set(agentTokens.map((t) => t.label))]))
  const mentionedTokenIds = agentTokens.filter((t) => mentionedLabels.has(t.label)).map((t) => t.id)
  // A message meant for an agent gets no built-in AI reply.
  if (mentionedTokenIds.length) triggerAi = false

  let pendingId: string | undefined

  db.transaction((tx) => {
    tx.insert(messages).values({
      id: msgId,
      sessionId: branch.sessionId,
      branchId,
      parentId,
      authorType,
      authorId: actor.userId,
      agentLabel: authorType === 'agent' ? actor.tokenLabel ?? null : null,
      model: null,
      content,
      status: 'done',
      createdAt: ts,
    }).run()

    tx.update(branches).set({ headMessageId: msgId }).where(eq(branches.id, branchId)).run()

    for (const tokenId of mentionedTokenIds) {
      tx.insert(messageMentions).values({ messageId: msgId, tokenId, createdAt: ts }).run()
    }

    if (triggerAi) {
      pendingId = nanoid()
      const pendingTs = new Date(Date.parse(ts) + 1).toISOString()
      tx.insert(messages).values({
        id: pendingId,
        sessionId: branch.sessionId,
        branchId,
        parentId: msgId,
        authorType: 'assistant',
        authorId: 'system',
        model: null,
        content: '',
        status: 'pending',
        createdAt: pendingTs,
      }).run()
      tx.update(branches).set({ headMessageId: pendingId }).where(eq(branches.id, branchId)).run()
    }
  })

  const userMessage = rowToMessage(db.select().from(messages).where(eq(messages.id, msgId)).get()!)

  // Emit to event bus
  bus.emitSession(branch.sessionId, { type: 'message_created', payload: userMessage })

  if (triggerAi && pendingId) {
    const pending = rowToMessage(db.select().from(messages).where(eq(messages.id, pendingId)).get()!)
    bus.emitSession(branch.sessionId, { type: 'message_created', payload: pending })
    // Queue AI reply
    void enqueueAiReply(branchId, pendingId, branch.sessionId)
  }

  return { userMessage, pendingAssistantId: pendingId }
}

// ─── AI queue (per-branch FIFO) ───────────────────────────────────────────────

// queues: branchId → array of pending message IDs waiting to be generated
const queues = new Map<string, string[]>()
const running = new Set<string>()

async function enqueueAiReply(branchId: string, pendingMsgId: string, sessionId: string) {
  const q = queues.get(branchId) ?? []
  q.push(pendingMsgId)
  queues.set(branchId, q)
  if (!running.has(branchId)) {
    void drainQueue(branchId, sessionId)
  }
}

async function drainQueue(branchId: string, sessionId: string) {
  running.add(branchId)
  const { generateReply } = await import('../ai/openrouter.js')
  while (true) {
    const q = queues.get(branchId) ?? []
    if (!q.length) break
    const msgId = q.shift()!
    queues.set(branchId, q)
    await generateReply(branchId, msgId, sessionId)
  }
  running.delete(branchId)
}

// On server startup: mark leftover pending/streaming messages as error
export function recoverStaleMessages() {
  const db = getDb()
  db.update(messages)
    .set({ status: 'error', content: 'Server restarted before reply completed.' })
    .where(eq(messages.status, 'pending'))
    .run()
  db.update(messages)
    .set({ status: 'error', content: 'Server restarted before reply completed.' })
    .where(eq(messages.status, 'streaming'))
    .run()
}
