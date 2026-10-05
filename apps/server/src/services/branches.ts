import { nanoid } from 'nanoid'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, sessionMembers, messages } from '../db/schema.js'
import { bus } from '../events.js'
import type { Branch } from '@tandem/shared'

function now() { return new Date().toISOString() }

function rowToBranch(row: typeof branches.$inferSelect): Branch {
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
  }
}

export async function createBranch(
  actor: { userId: string },
  sessionId: string,
  fromMessageId: string,
  model: string,
  name?: string,
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
  }).run()

  const branch = rowToBranch(db.select().from(branches).where(eq(branches.id, branchId)).get()!)

  bus.emitSession(sessionId, { type: 'branch_created', payload: branch })

  return branch
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
