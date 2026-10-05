import { nanoid } from 'nanoid'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, sessionMembers, messages } from '../db/schema.js'
import { bus } from '../events.js'
import { checkDocIds, sessionDocs } from './docs.js'
import { assertModelForSession } from '../ai/models.js'
import { startBranchContext } from './branchContext.js'
import type { Branch } from '@tandem/shared'

function now() { return new Date().toISOString() }

export function rowToBranch(row: typeof branches.$inferSelect): Branch {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerId: row.ownerId ?? null,
    isMain: Boolean(row.isMain),
    name: row.name,
    model: row.model,
    forkMessageId: row.forkMessageId ?? null,
    headMessageId: row.headMessageId ?? null,
    createdAt: row.createdAt,
    pinnedDocIds: row.pinnedDocIds,
    purpose: row.purpose ?? null,
    branchContext: row.branchContext ?? null,
    branchContextUpdatedAt: row.branchContextUpdatedAt ?? null,
    branchContextUpdatedBy: row.branchContextUpdatedBy ?? null,
  }
}

export async function createBranch(
  actor: { userId: string },
  sessionId: string,
  fromMessageId: string,
  model: string,
  name?: string,
  docIds?: string[],
  purpose?: string,
): Promise<Branch | null> {
  const db = getDb()

  // Check membership
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return null

  // Validate fork message exists in session
  const forkMsg = db.select().from(messages)
    .where(and(eq(messages.id, fromMessageId), eq(messages.sessionId, sessionId)))
    .get()
  if (!forkMsg) return null

  assertModelForSession(sessionId, model)
  // Without an explicit choice, a branch pins what its parent branch (the one holding the fork
  // message) reads; forking from main means every doc.
  const parent = db.select().from(branches).where(eq(branches.id, forkMsg.branchId)).get()
  const pinnedDocIds = docIds
    ? checkDocIds(sessionId, docIds)
    : parent && !parent.isMain
      ? parent.pinnedDocIds
      : sessionDocs(sessionId).map((d) => d.id)

  const branchId = nanoid()
  const ts = now()
  const branchName = name ?? `Branch ${ts.slice(11, 19)}`

  db.insert(branches).values({
    id: branchId,
    sessionId,
    ownerId: actor.userId,
    isMain: false,
    name: branchName,
    model,
    forkMessageId: fromMessageId,
    headMessageId: fromMessageId, // starts at the fork point
    createdAt: ts,
    pinnedDocIds,
    purpose: purpose ?? null,
  }).run()

  const branch = rowToBranch(db.select().from(branches).where(eq(branches.id, branchId)).get()!)

  bus.emitSession(sessionId, { type: 'branch_created', payload: branch })
  // Its AI does not inherit the parent's raw history; AI writes a cited branch context instead.
  startBranchContext(branch)

  return branch
}

// Owner only; main has no owner, so it can't be patched.
export function updateBranch(
  actor: { userId: string },
  branchId: string,
  changes: { name?: string; model?: string; pinnedDocIds?: string[] },
): Branch {
  const db = getDb()
  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch) throw Object.assign(new Error('Branch not found'), { code: 'not_found', status: 404 })
  if (branch.ownerId !== actor.userId) {
    throw Object.assign(new Error('Only the owner can update this branch'), { code: 'forbidden', status: 403 })
  }

  const updates: Partial<typeof branches.$inferInsert> = {}
  if (changes.name) updates.name = changes.name
  if (changes.model) {
    assertModelForSession(branch.sessionId, changes.model)
    updates.model = changes.model
  }
  if (changes.pinnedDocIds) updates.pinnedDocIds = checkDocIds(branch.sessionId, changes.pinnedDocIds)
  if (Object.keys(updates).length) db.update(branches).set(updates).where(eq(branches.id, branchId)).run()

  const updated = rowToBranch(db.select().from(branches).where(eq(branches.id, branchId)).get()!)
  bus.emitSession(branch.sessionId, { type: 'branch_updated', payload: updated })
  return updated
}

export async function getSessionTree(actor: { userId: string }, sessionId: string) {
  const db = getDb()

  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return null

  const msgs = db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .all()

  return msgs.map((m) => ({
    id: m.id,
    branchId: m.branchId,
    parentId: m.parentId,
    authorType: m.authorType,
    status: m.status,
    createdAt: m.createdAt,
  }))
}
