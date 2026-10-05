import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, messages } from '../db/schema.js'
import { bus } from '../events.js'
import { answerFromBranch, parentBranchOf } from '../ai/openrouter.js'
import { checkRateLimit } from '../lib/rateLimit.js'
import { isSessionMember } from './sessions.js'
import { rowToMessage } from './messages.js'
import { fail } from './errors.js'
import type { Message } from '@tandem/shared'

// ask_parent: a branch asks the branch it split off from, whose AI answers from its live history
// (and can ask its own parent in turn, up to main). The question and answer are recorded in the
// asking branch as an ask_parent message, so people see what was pulled in and later replies keep it.

type BranchRow = typeof branches.$inferSelect

function askRow(branch: BranchRow, parentId: string | null, question: string, answer: string, answeredBy: BranchRow) {
  return {
    id: nanoid(),
    sessionId: branch.sessionId,
    branchId: branch.id,
    parentId,
    authorType: 'assistant' as const,
    authorId: 'system',
    kind: 'ask_parent' as const,
    askQuestion: question,
    askedBranchId: answeredBy.id,
    model: answeredBy.model,
    content: answer,
    status: 'done' as const,
    createdAt: new Date().toISOString(),
  }
}

// From the branch's own AI, mid-reply: the exchange goes just before the pending reply.
export function recordAskBeforeReply(pendingMsgId: string, question: string, answer: string, answeredBy: BranchRow) {
  const db = getDb()
  let id = ''
  db.transaction((tx) => {
    const pending = tx.select().from(messages).where(eq(messages.id, pendingMsgId)).get()
    const branch = pending && tx.select().from(branches).where(eq(branches.id, pending.branchId)).get()
    if (!pending || !branch) return
    const row = askRow(branch, pending.parentId, question, answer, answeredBy)
    tx.insert(messages).values(row).run()
    tx.update(messages).set({ parentId: row.id }).where(eq(messages.id, pendingMsgId)).run()
    id = row.id
  })
  if (!id) return
  const msg = rowToMessage(db.select().from(messages).where(eq(messages.id, id)).get()!)
  bus.emitSession(msg.sessionId, { type: 'message_created', payload: msg })
}

// From a person or an MCP agent acting for the branch owner: the exchange is appended to the branch.
export async function askParent(
  actor: { userId: string },
  branchId: string,
  question: string,
): Promise<{ answer: string; answeredBy: { branchId: string; branchName: string }; message: Message }> {
  const db = getDb()
  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch || !isSessionMember(branch.sessionId, actor.userId)) fail(404, 'not_found', 'Branch not found')
  if (branch.isMain) fail(400, 'invalid_request', 'Main has no parent branch; it holds the full record')
  if (branch.ownerId !== actor.userId) fail(403, 'forbidden', 'Only the branch owner can ask from this branch')
  if (!checkRateLimit(actor.userId)) fail(429, 'rate_limited', 'Rate limit exceeded (100 messages/hour)')
  const parent = parentBranchOf(branch)
  if (!parent) fail(404, 'not_found', 'Parent branch not found')

  const answer = await answerFromBranch(parent, question, branch.name).catch((err: unknown) =>
    fail(502, 'upstream_error', `The parent branch could not answer: ${err instanceof Error ? err.message : String(err)}`))

  let id = ''
  db.transaction((tx) => {
    // Read the head inside the transaction so a concurrent post cannot fork the thread.
    const head = tx.select({ headMessageId: branches.headMessageId }).from(branches).where(eq(branches.id, branchId)).get()!
    const row = askRow(branch, head.headMessageId, question, answer, parent)
    tx.insert(messages).values(row).run()
    tx.update(branches).set({ headMessageId: row.id }).where(eq(branches.id, branchId)).run()
    id = row.id
  })
  const message = rowToMessage(db.select().from(messages).where(eq(messages.id, id)).get()!)
  bus.emitSession(branch.sessionId, { type: 'message_created', payload: message })
  return { answer, answeredBy: { branchId: parent.id, branchName: parent.name }, message }
}
