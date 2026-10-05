import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, messages, sessions, users } from '../db/schema.js'
import { bus } from '../events.js'
import { aiConfigured, summarize, BRIEF_PROMPT } from '../ai/openrouter.js'
import { pathToHead } from '../ai/context.js'
import { BRIEF_MAX_CHARS } from '@tandem/shared'
import { isSessionMember, writeBrief } from './sessions.js'
import { documentsForBranch, sessionDocumentRows } from './documents.js'
import type { Session } from '@tandem/shared'

// The brief is a short AI summary of main: direction, decisions, who's on what. It is rewritten
// from the current brief plus main's latest messages, on demand or every BRIEF_REFRESH_EVERY
// new main messages.

export const BRIEF_REFRESH_EVERY = 20
const BRIEF_INPUT_MESSAGES = 60
const BRIEF_INPUT_CHARS = 20_000

function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { code, status })
}

const refreshing = new Set<string>() // sessionIds; one refresh at a time per session

export async function refreshBrief(actor: { userId: string }, sessionId: string): Promise<Session> {
  if (!isSessionMember(sessionId, actor.userId)) fail(404, 'not_found', 'Session not found')
  if (refreshing.has(sessionId)) fail(409, 'conflict', 'The brief is already being refreshed')
  return runRefresh(sessionId, actor.userId)
}

async function runRefresh(sessionId: string, updatedBy: string): Promise<Session> {
  refreshing.add(sessionId)
  try {
    const db = getDb()
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()!
    const main = db.select().from(branches).where(and(eq(branches.sessionId, sessionId), eq(branches.isMain, true))).get()!
    const input = briefInput(sessionId, session.brief, main.headMessageId)
    // A model error is the provider's, not the caller's: never pass its status (e.g. 401) through.
    const summary = await summarize(main.model, input, BRIEF_PROMPT).catch((err: unknown) =>
      fail(502, 'upstream_error', `The model could not summarize main: ${err instanceof Error ? err.message : String(err)}`))
    const brief = summary.slice(0, BRIEF_MAX_CHARS)
    // Based on the version the summary read, so a teammate's save during generation wins (409).
    return writeBrief(sessionId, brief, session.briefUpdatedAt, updatedBy)
  } finally {
    refreshing.delete(sessionId)
  }
}

function briefInput(sessionId: string, currentBrief: string, mainHeadId: string | null): string {
  const db = getDb()
  const rows = db.select().from(messages).where(eq(messages.sessionId, sessionId)).all()
  const path = mainHeadId ? pathToHead(rows, mainHeadId).filter((m) => m.status === 'done').slice(-BRIEF_INPUT_MESSAGES) : []
  const allBranches = db.select().from(branches).where(eq(branches.sessionId, sessionId)).all()

  const userIds = [...new Set([...path.map((m) => m.authorId), ...allBranches.flatMap((b) => (b.ownerId ? [b.ownerId] : []))])]
  const nameById = new Map(
    userIds.length ? db.select().from(users).where(inArray(users.id, userIds)).all().map((u) => [u.id, u.displayName]) : [],
  )
  const docs = sessionDocumentRows(sessionId)

  const branchLines = allBranches.filter((b) => !b.isMain).map((b) => {
    const reads = documentsForBranch(b).selected.map((d) => d.name).join(', ') || 'no documents'
    return `- ${b.name} (owner: ${nameById.get(b.ownerId ?? '') ?? 'unknown'}; reads: ${reads})`
  })
  const transcript = path
    .map((m) => `${m.authorType === 'assistant' ? 'AI' : m.agentLabel ?? nameById.get(m.authorId) ?? 'someone'}: ${m.content}`)
    .join('\n')
    .slice(-BRIEF_INPUT_CHARS)

  return [
    `Current brief:\n${currentBrief.trim() || '(empty)'}`,
    `Branches:\n${branchLines.join('\n') || '(none yet)'}`,
    `Documents: ${docs.map((d) => d.name).join(', ') || '(none)'}`,
    `Latest main-thread messages:\n${transcript || '(none yet)'}`,
  ].join('\n\n')
}

// ─── Automatic refresh ────────────────────────────────────────────────────────
// After a finished message lands in main, count main messages since the brief's last update; at
// BRIEF_REFRESH_EVERY, refresh in the background. Skipped without a configured model, so a dev
// stub never replaces a hand-written brief.

function mainMessagesSinceBrief(sessionId: string): number {
  const db = getDb()
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  const main = db.select().from(branches).where(and(eq(branches.sessionId, sessionId), eq(branches.isMain, true))).get()
  if (!session || !main?.headMessageId) return 0
  const rows = db.select().from(messages).where(eq(messages.sessionId, sessionId)).all()
  const since = session.briefUpdatedAt ?? ''
  return pathToHead(rows, main.headMessageId).filter((m) => m.status === 'done' && m.createdAt > since).length
}

export function maybeAutoRefresh(sessionId: string, branchId: string) {
  if (!aiConfigured() || refreshing.has(sessionId)) return
  const branch = getDb().select({ isMain: branches.isMain }).from(branches).where(eq(branches.id, branchId)).get()
  if (!branch?.isMain || mainMessagesSinceBrief(sessionId) < BRIEF_REFRESH_EVERY) return
  runRefresh(sessionId, 'system').catch(() => {}) // a conflict means a teammate just saved; try again later
}

bus.onSession(({ sessionId, event }) => {
  if (event.type === 'message_created' && event.payload.status === 'done') {
    maybeAutoRefresh(sessionId, event.payload.branchId)
  } else if (event.type === 'assistant_done') {
    const msg = getDb().select({ branchId: messages.branchId }).from(messages).where(eq(messages.id, event.payload.messageId)).get()
    if (msg) maybeAutoRefresh(sessionId, msg.branchId)
  }
})
