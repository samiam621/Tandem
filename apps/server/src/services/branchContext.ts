import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, messages, sessions, users } from '../db/schema.js'
import { bus } from '../events.js'
import { aiConfigured, summarize, parentBranchOf } from '../ai/openrouter.js'
import { branchHistory, pathToHead } from '../ai/context.js'
import { dropUnknownDocumentCitations } from '../lib/citations.js'
import { AI_AUTHOR, BRANCH_CONTEXT_MAX_CHARS } from '@tandem/shared'
import { rowToBranch } from './branches.js'
import { isSessionMember } from './sessions.js'
import { sessionDocumentRows } from './documents.js'
import { fail } from './errors.js'
import type { Branch } from '@tandem/shared'

// A branch's context: a short, cited summary of what the branch needs from the conversation it
// split off from, written by AI right after the branch is created. It stands in for the parent's
// raw history in the branch's AI context (see ARCHITECTURE.md § Scoped branch context).

type BranchRow = typeof branches.$inferSelect

const BRANCH_CONTEXT_PROMPT = `In a team chat, someone split a new branch off a conversation to work on one thing.
Write the new branch's context: what it needs from the parent conversation for its purpose, so its AI does not need the whole conversation.
Keep the decisions, constraints, interfaces, and open questions relevant to the purpose; drop everything else.
Cite every point in brackets. A document: [NAME] or [NAME § Heading], using only the document names listed. A discussion: [Author in branch, Mon D], using the author, branch, and date shown on the message.
Do not copy the documents. Use short markdown bullets and stay under 250 words. Do not invent details that are not in the input.`

const INPUT_MESSAGES = 80
const INPUT_CHARS = 30_000

const generating = new Map<string, Promise<void>>() // branchId → the write in progress

// Resolves once the branch's context write (if any) has finished, successfully or not.
export function whenBranchContextReady(branchId: string): Promise<void> {
  return generating.get(branchId) ?? Promise.resolve()
}

// Starts writing a new branch's context in the background. Skipped without a configured model, so
// a dev stub never becomes a branch context.
export function startBranchContext(branch: { id: string; sessionId: string }) {
  if (!aiConfigured(branch.sessionId) || generating.has(branch.id)) return
  track(branch.id, writeBranchContext(branch.id).then(() => {}))
}

function track(branchId: string, work: Promise<void>): Promise<void> {
  const done = work.finally(() => generating.delete(branchId))
  generating.set(branchId, done.catch(() => {}))
  return done
}

// Writes the context from the parent's history up to the fork point, unless someone saved one in
// the meantime (their version wins).
async function writeBranchContext(branchId: string): Promise<BranchRow> {
  const db = getDb()
  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch || branch.isMain || !branch.forkMessageId) fail(404, 'not_found', 'Branch not found')
  const base = branch.branchContextUpdatedAt

  const docNames = sessionDocumentRows(branch.sessionId).map((d) => d.name)
  const text = await summarize(branch.sessionId, branch.model, branchContextInput(branch, docNames), BRANCH_CONTEXT_PROMPT)
  const content = dropUnknownDocumentCitations(text, docNames).slice(0, BRANCH_CONTEXT_MAX_CHARS)

  const res = db.update(branches)
    .set({ branchContext: content, branchContextUpdatedAt: nextVersion(base), branchContextUpdatedBy: AI_AUTHOR })
    .where(and(eq(branches.id, branchId), base === null ? isNull(branches.branchContextUpdatedAt) : eq(branches.branchContextUpdatedAt, base)))
    .run()
  const row = db.select().from(branches).where(eq(branches.id, branchId)).get()!
  if (res.changes) bus.emitSession(branch.sessionId, { type: 'branch_updated', payload: rowToBranch(row) })
  return row
}

function branchContextInput(branch: BranchRow, docNames: string[]): string {
  const db = getDb()
  const parent = parentBranchOf(branch)
  const rows = db.select().from(messages).where(eq(messages.sessionId, branch.sessionId)).all()
  // The parent's history as its own AI sees it, up to the fork point.
  const { tail, own } = parent
    ? branchHistory(rows, branch.forkMessageId!, parent.isMain ? null : parent.forkMessageId)
    : { tail: [], own: pathToHead(rows, branch.forkMessageId!) }
  const history = [...tail, ...own].filter((m) => m.status === 'done').slice(-INPUT_MESSAGES)

  const authorIds = [...new Set(history.map((m) => m.authorId))]
  const nameById = new Map(
    authorIds.length ? db.select().from(users).where(inArray(users.id, authorIds)).all().map((u) => [u.id, u.displayName]) : [],
  )
  const branchNames = new Map(db.select().from(branches).where(eq(branches.sessionId, branch.sessionId)).all().map((b) => [b.id, b.name]))
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const transcript = history.map((m) => {
    const author = m.authorType === 'assistant' ? 'AI' : m.agentLabel ?? nameById.get(m.authorId) ?? 'someone'
    const text = m.kind === 'ask_parent' ? `asked the parent "${m.askQuestion}": ${m.content}` : m.content
    return `[${author} in ${branchNames.get(m.branchId) ?? 'a branch'}, ${day(m.createdAt)}] ${text}`
  }).join('\n').slice(-INPUT_CHARS)

  const brief = db.select({ brief: sessions.brief }).from(sessions).where(eq(sessions.id, branch.sessionId)).get()?.brief ?? ''
  return [
    `The new branch is for: ${branch.purpose?.trim() || branch.name}`,
    `Session brief:\n${brief.trim() || '(empty)'}`,
    `Documents: ${docNames.join(', ') || '(none)'}`,
    parent && !parent.isMain ? `The parent branch "${parent.name}" has its own context:\n${parent.branchContext?.trim() || '(none)'}` : '',
    `Parent conversation up to the fork, oldest first:\n${transcript || '(no messages)'}`,
  ].filter(Boolean).join('\n\n')
}

// The version must strictly increase even for saves within the same millisecond.
function nextVersion(base: string | null): string {
  const now = new Date().toISOString()
  return base && Date.parse(now) <= Date.parse(base) ? new Date(Date.parse(base) + 1).toISOString() : now
}

function ownedBranch(actor: { userId: string }, branchId: string): BranchRow {
  const branch = getDb().select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch || !isSessionMember(branch.sessionId, actor.userId)) fail(404, 'not_found', 'Branch not found')
  if (branch.isMain) fail(400, 'invalid_request', 'Main has no branch context; it reads its whole history')
  if (branch.ownerId !== actor.userId) fail(403, 'forbidden', 'Only the branch owner can change its context')
  return branch
}

// Owner only. baseUpdatedAt must match the stored version, so a save never silently overwrites
// the AI's write or another save.
export function updateBranchContext(actor: { userId: string }, branchId: string, content: string, baseUpdatedAt: string | null): Branch {
  const branch = ownedBranch(actor, branchId)
  const db = getDb()
  const res = db.update(branches)
    .set({ branchContext: content, branchContextUpdatedAt: nextVersion(baseUpdatedAt), branchContextUpdatedBy: actor.userId })
    .where(and(
      eq(branches.id, branchId),
      baseUpdatedAt === null ? isNull(branches.branchContextUpdatedAt) : eq(branches.branchContextUpdatedAt, baseUpdatedAt),
    ))
    .run()
  if (res.changes === 0) fail(409, 'conflict', 'The branch context changed since you started editing')
  const updated = rowToBranch(db.select().from(branches).where(eq(branches.id, branchId)).get()!)
  bus.emitSession(branch.sessionId, { type: 'branch_updated', payload: updated })
  return updated
}

// Owner only: has AI write the context again from the parent's history, replacing the current one.
export async function regenerateBranchContext(actor: { userId: string }, branchId: string): Promise<Branch> {
  const branch = ownedBranch(actor, branchId)
  if (!aiConfigured(branch.sessionId)) fail(400, 'no_model', 'No OpenRouter key: add one to the session, or write the context by hand')
  if (generating.has(branchId)) fail(409, 'conflict', 'The branch context is already being written')
  let row: BranchRow | undefined
  await track(branchId, writeBranchContext(branchId).then((r) => { row = r })).catch((err: unknown) =>
    fail(502, 'upstream_error', `The model could not write the branch context: ${err instanceof Error ? err.message : String(err)}`))
  return rowToBranch(row!)
}

// On startup: branches with no context yet (created before scoped context, or whose write failed)
// get one, one at a time, using the branch name as the purpose when none was given.
export async function backfillBranchContexts() {
  const pending = getDb().select().from(branches)
    .where(and(eq(branches.isMain, false), isNull(branches.branchContextUpdatedAt)))
    .all()
  for (const branch of pending) {
    if (!aiConfigured(branch.sessionId) || generating.has(branch.id)) continue
    await track(branch.id, writeBranchContext(branch.id).then(() => {})).catch(() => {})
  }
}
