import { nanoid } from 'nanoid'
import { eq, and, asc, inArray } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { messages, branches, sessionMembers, messageMentions, users } from '../db/schema.js'
import { bus } from '../events.js'
import { checkRateLimit } from '../lib/rateLimit.js'
import { findMentionedLabels } from '../lib/mentions.js'
import { sessionAgentTokens } from './sessions.js'
import { summarize } from '../ai/openrouter.js'
import { fail } from './errors.js'
import type { Message } from '@tandem/shared'

function now() { return new Date().toISOString() }

export function rowToMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    branchId: row.branchId,
    parentId: row.parentId ?? null,
    authorType: row.authorType,
    authorId: row.authorId,
    agentLabel: row.agentLabel ?? null,
    sharedFromBranchId: row.sharedFromBranchId ?? null,
    kind: row.kind,
    askQuestion: row.askQuestion ?? null,
    askedBranchId: row.askedBranchId ?? null,
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
  if (!branch) fail(404, 'not_found', 'Branch not found')

  // Permission: main branch → any member; other branches → owner only
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, branch.sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) fail(403, 'forbidden', 'Not a member')

  if (!branch.isMain && branch.ownerId !== actor.userId) fail(403, 'forbidden', 'Only the branch owner can post here')

  if (!checkRateLimit(actor.userId)) fail(429, 'rate_limited', 'Rate limit exceeded (100 messages/hour)')

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

// ─── Share to main ────────────────────────────────────────────────────────────
// The branch owner posts an AI summary of the branch's own messages (everything since the fork)
// into main, so the whole team gets the result.

const SHARE_MAX_MESSAGES = 100
const SHARE_MAX_CHARS = 20_000

export async function shareBranch(actor: { userId: string }, branchId: string): Promise<Message> {
  const db = getDb()
  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  const path = branch && await getBranchMessages(actor, branchId) // also checks membership
  if (!branch || !path) fail(404, 'not_found', 'Branch not found')
  if (branch.isMain) fail(400, 'invalid_request', 'Main cannot be shared to itself')
  if (branch.ownerId !== actor.userId) fail(403, 'forbidden', 'Only the branch owner can share it')

  const own = path.filter((m) => m.branchId === branchId && m.status === 'done').slice(-SHARE_MAX_MESSAGES)
  if (!own.length) fail(400, 'invalid_request', 'This branch has no messages to share yet')
  if (!checkRateLimit(actor.userId)) fail(429, 'rate_limited', 'Rate limit exceeded (100 messages/hour)')

  const authorIds = [...new Set(own.map((m) => m.authorId))]
  const nameById = new Map(db.select().from(users).where(inArray(users.id, authorIds)).all().map((u) => [u.id, u.displayName]))
  const transcript = own
    .map((m) => m.kind === 'ask_parent'
      ? `(asked the parent branch "${m.askQuestion}": ${m.content})`
      : `${m.authorType === 'assistant' ? 'AI' : m.agentLabel ?? nameById.get(m.authorId) ?? 'someone'}: ${m.content}`)
    .join('\n')
    .slice(-SHARE_MAX_CHARS)

  const summary = await summarize(branch.sessionId, branch.model, transcript)
  const mainId = db.select().from(branches).where(and(eq(branches.sessionId, branch.sessionId), eq(branches.isMain, true))).get()!.id

  const msgId = nanoid()
  db.transaction((tx) => {
    // Read main's head inside the transaction so a concurrent post cannot fork the thread.
    const main = tx.select().from(branches).where(eq(branches.id, mainId)).get()!
    tx.insert(messages).values({
      id: msgId,
      sessionId: branch.sessionId,
      branchId: mainId,
      parentId: main.headMessageId ?? null,
      authorType: 'assistant',
      authorId: 'system',
      model: branch.model,
      content: summary,
      status: 'done',
      sharedFromBranchId: branchId,
      createdAt: now(),
    }).run()
    tx.update(branches).set({ headMessageId: msgId }).where(eq(branches.id, mainId)).run()
  })

  const shared = rowToMessage(db.select().from(messages).where(eq(messages.id, msgId)).get()!)
  bus.emitSession(branch.sessionId, { type: 'message_created', payload: shared })
  return shared
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
