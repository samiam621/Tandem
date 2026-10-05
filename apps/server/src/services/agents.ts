import { and, eq, gt, asc, inArray } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, messageMentions, messages, sessionMembers, sessions, users } from '../db/schema.js'
import { bus } from '../events.js'
import type { SessionEvent } from '../events.js'
import { getBranchMessages } from './messages.js'
import { getSessionBranches } from './sessions.js'
import { listDocs } from './docs.js'
import type { Actor } from './auth.js'
import type { McpBranchContext, McpMention } from '@tandem/shared'

// Services behind the MCP tools an agent (e.g. Claude Code) uses to take part in a session.

// ─── Mentions ─────────────────────────────────────────────────────────────────

// Mentions of this agent token after `since`, only in sessions the token's user belongs to.
export function listMentions(actor: Actor, since: string): McpMention[] {
  return getDb()
    .select({
      messageId: messages.id,
      sessionId: messages.sessionId,
      branchId: messages.branchId,
      branchName: branches.name,
      authorName: users.displayName,
      agentLabel: messages.agentLabel,
      content: messages.content,
      createdAt: messageMentions.createdAt,
    })
    .from(messageMentions)
    .innerJoin(messages, eq(messages.id, messageMentions.messageId))
    .innerJoin(branches, eq(branches.id, messages.branchId))
    .innerJoin(sessionMembers, and(eq(sessionMembers.sessionId, messages.sessionId), eq(sessionMembers.userId, actor.userId)))
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messageMentions.tokenId, actor.tokenId), gt(messageMentions.createdAt, since)))
    .orderBy(asc(messageMentions.createdAt))
    .all()
    .map(({ authorName, agentLabel, ...m }) => ({ ...m, authorDisplayName: agentLabel ?? authorName ?? 'unknown' }))
}

// Resolves as soon as there are mentions after `since`, or with [] after timeoutMs.
export function waitForMentions(actor: Actor, since: string, timeoutMs: number): Promise<McpMention[]> {
  const found = listMentions(actor, since)
  if (found.length) return Promise.resolve(found)
  return new Promise((resolve) => {
    const done = (result: McpMention[]) => {
      clearTimeout(timer)
      bus.offSession(onEvent)
      resolve(result)
    }
    // Mentions are inserted in the same transaction as the message, so they exist by the time it is announced.
    const onEvent = ({ event }: SessionEvent) => {
      if (event.type !== 'message_created') return
      const next = listMentions(actor, since)
      if (next.length) done(next)
    }
    const timer = setTimeout(() => done([]), timeoutMs)
    bus.onSession(onEvent)
  })
}

// ─── Branch context ───────────────────────────────────────────────────────────

// Everything an agent needs before working on a branch: the brief, the project docs list, the root-to-head path (including the
// history inherited from the fork), who owns it, and the session's other branches.
export async function getBranchContext(actor: Actor, branchId: string, limit: number): Promise<McpBranchContext | null> {
  const path = await getBranchMessages(actor, branchId) // also checks membership
  if (!path) return null

  const db = getDb()
  const sessionId = db.select({ sessionId: branches.sessionId }).from(branches).where(eq(branches.id, branchId)).get()!.sessionId
  const { brief, briefUpdatedAt, ...session } = db
    .select({ id: sessions.id, title: sessions.title, brief: sessions.brief, briefUpdatedAt: sessions.briefUpdatedAt })
    .from(sessions).where(eq(sessions.id, sessionId)).get()!
  const sessionBranches = (await getSessionBranches(actor, sessionId))!
  const branch = sessionBranches.find((b) => b.id === branchId)!

  const userIds = [...new Set([...path.map((m) => m.authorId), ...sessionBranches.flatMap((b) => (b.ownerId ? [b.ownerId] : []))])]
  const nameById = new Map(
    userIds.length
      ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds)).all().map((u) => [u.id, u.name])
      : [],
  )
  const ownerName = (ownerId: string | null) => (ownerId ? nameById.get(ownerId) ?? null : null)
  const branchName = new Map(sessionBranches.map((b) => [b.id, b.name]))
  const fork = branch.forkMessageId ? path.find((m) => m.id === branch.forkMessageId) : undefined

  return {
    session,
    brief,
    briefUpdatedAt,
    docs: listDocs(actor, sessionId),
    branch: { ...branch, ownerDisplayName: ownerName(branch.ownerId) },
    forkedFrom: fork ? { branchId: fork.branchId, branchName: branchName.get(fork.branchId) ?? '', messageId: fork.id } : null,
    messages: path.slice(-limit).map((m) => ({
      id: m.id,
      branchId: m.branchId,
      authorType: m.authorType,
      authorDisplayName: m.authorType === 'assistant' ? 'Tandem AI' : m.agentLabel ?? nameById.get(m.authorId) ?? m.authorId,
      agentLabel: m.agentLabel ?? null,
      sharedFromBranchId: m.sharedFromBranchId ?? null,
      model: m.model,
      content: m.content,
      status: m.status,
      createdAt: m.createdAt,
    })),
    otherBranches: sessionBranches
      .filter((b) => b.id !== branchId)
      .map((b) => ({ id: b.id, name: b.name, ownerDisplayName: ownerName(b.ownerId) })),
  }
}

// ─── Working indicator ────────────────────────────────────────────────────────
// Re-sends a typing event with the agent's label every few seconds ("Claude is working…") until
// the agent posts on that branch, turns it off, or WORKING_MAX_MS passes.
// ponytail: in-memory timers, fine for the single server instance (see AGENTS.md Gotchas).

const WORKING_PING_MS = 3000
const WORKING_MAX_MS = 5 * 60 * 1000
const working = new Map<string, ReturnType<typeof setInterval>>()

function stopWorking(key: string) {
  clearInterval(working.get(key))
  working.delete(key)
}

export function setWorking(actor: Actor, branchId: string, on: boolean): boolean {
  const db = getDb()
  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch) return false
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, branch.sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return false

  const key = `${actor.userId}:${actor.tokenLabel}:${branchId}`
  stopWorking(key)
  if (!on) return true

  const ping = () => bus.emitSession(branch.sessionId, {
    type: 'typing',
    payload: { userId: actor.userId, branchId, agentLabel: actor.tokenLabel },
  })
  const started = Date.now()
  ping()
  working.set(key, setInterval(() => (Date.now() - started > WORKING_MAX_MS ? stopWorking(key) : ping()), WORKING_PING_MS))
  return true
}

// An agent's post ends its working indicator on that branch.
bus.onSession(({ event }) => {
  if (event.type === 'message_created' && event.payload.authorType === 'agent') {
    stopWorking(`${event.payload.authorId}:${event.payload.agentLabel}:${event.payload.branchId}`)
  }
})
