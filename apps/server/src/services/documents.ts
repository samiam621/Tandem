import { nanoid } from 'nanoid'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, sessionDocuments } from '../db/schema.js'
import { bus } from '../events.js'
import { isSessionMember } from './sessions.js'
import { rowToBranch } from './branches.js'
import { fail } from './errors.js'
import type { Branch, SessionDocument } from '@tandem/shared'

// Session documents: the specs and docs (ARCHITECTURE.md, TODO.md, …) that live in main.
// Main's AI reads all of them; every other branch reads the subset in its documentIds.

function now() { return new Date().toISOString() }

function rowToDocument(row: typeof sessionDocuments.$inferSelect): SessionDocument {
  return { ...row }
}

function assertMember(sessionId: string, userId: string) {
  if (!isSessionMember(sessionId, userId)) fail(404, 'not_found', 'Session not found')
}

export function sessionDocumentRows(sessionId: string): SessionDocument[] {
  return getDb().select().from(sessionDocuments)
    .where(eq(sessionDocuments.sessionId, sessionId))
    .orderBy(asc(sessionDocuments.name))
    .all()
    .map(rowToDocument)
}

export function listDocuments(actor: { userId: string }, sessionId: string): SessionDocument[] {
  assertMember(sessionId, actor.userId)
  return sessionDocumentRows(sessionId)
}

export function getDocument(actor: { userId: string }, documentId: string): SessionDocument {
  const row = getDb().select().from(sessionDocuments).where(eq(sessionDocuments.id, documentId)).get()
  if (!row || !isSessionMember(row.sessionId, actor.userId)) fail(404, 'not_found', 'Document not found')
  return rowToDocument(row)
}

// Any member may create or edit. Creates when baseUpdatedAt is null and the name is free; otherwise
// baseUpdatedAt must match the stored updatedAt, so a save never silently overwrites a teammate.
export function saveDocument(
  actor: { userId: string },
  sessionId: string,
  name: string,
  content: string,
  baseUpdatedAt: string | null,
): SessionDocument {
  assertMember(sessionId, actor.userId)
  const db = getDb()
  const existing = db.select().from(sessionDocuments)
    .where(and(eq(sessionDocuments.sessionId, sessionId), eq(sessionDocuments.name, name)))
    .get()

  let id: string
  if (!existing) {
    if (baseUpdatedAt !== null) fail(409, 'conflict', `${name} was deleted or renamed since you started editing`)
    id = nanoid()
    const ts = now()
    try {
      db.insert(sessionDocuments).values({ id, sessionId, name, content, createdAt: ts, updatedAt: ts, updatedBy: actor.userId }).run()
    } catch {
      fail(409, 'conflict', `Someone created ${name} at the same time`) // unique (session, name)
    }
  } else {
    if (baseUpdatedAt === null) fail(409, 'conflict', `A document named ${name} already exists`)
    // updatedAt doubles as the version, so it must strictly increase even within one millisecond.
    const ts = Date.parse(now()) <= Date.parse(baseUpdatedAt) ? new Date(Date.parse(baseUpdatedAt) + 1).toISOString() : now()
    const res = db.update(sessionDocuments)
      .set({ content, updatedAt: ts, updatedBy: actor.userId })
      .where(and(eq(sessionDocuments.id, existing.id), eq(sessionDocuments.updatedAt, baseUpdatedAt)))
      .run()
    if (res.changes === 0) fail(409, 'conflict', `Someone updated ${name} since you started editing`)
    id = existing.id
  }

  const doc = rowToDocument(db.select().from(sessionDocuments).where(eq(sessionDocuments.id, id)).get()!)
  bus.emitSession(sessionId, { type: 'document_updated', payload: doc })
  return doc
}

// Any member may delete. Branch selections keep the stale id; readers drop ids that no longer exist.
export function deleteDocument(actor: { userId: string }, documentId: string): void {
  const doc = getDocument(actor, documentId)
  getDb().delete(sessionDocuments).where(eq(sessionDocuments.id, documentId)).run()
  bus.emitSession(doc.sessionId, { type: 'document_deleted', payload: { sessionId: doc.sessionId, documentId } })
}

// Branch owner only. Main always reads every document, so its selection cannot be set.
export function setBranchDocuments(actor: { userId: string }, branchId: string, documentIds: string[]): Branch {
  const db = getDb()
  const branch = db.select().from(branches).where(eq(branches.id, branchId)).get()
  if (!branch || !isSessionMember(branch.sessionId, actor.userId)) fail(404, 'not_found', 'Branch not found')
  if (branch.isMain) fail(400, 'invalid_request', 'Main always reads every document')
  if (branch.ownerId !== actor.userId) fail(403, 'forbidden', 'Only the branch owner can choose its documents')

  db.update(branches).set({ documentIds: validDocumentIds(branch.sessionId, documentIds) }).where(eq(branches.id, branchId)).run()
  const updated = rowToBranch(db.select().from(branches).where(eq(branches.id, branchId)).get()!)
  bus.emitSession(branch.sessionId, { type: 'branch_updated', payload: updated })
  return updated
}

// Keeps only ids of documents in this session, deduplicated, in the given order.
export function validDocumentIds(sessionId: string, documentIds: string[]): string[] {
  const known = new Set(sessionDocumentRows(sessionId).map((d) => d.id))
  return [...new Set(documentIds)].filter((id) => known.has(id))
}

// The documents a branch's AI reads in full, and the rest (named only).
export function documentsForBranch(
  branch: { sessionId: string; isMain: boolean; documentIds: string[] | null },
): { selected: SessionDocument[]; others: SessionDocument[] } {
  const docs = sessionDocumentRows(branch.sessionId)
  if (branch.isMain || branch.documentIds === null) return { selected: docs, others: [] }
  const ids = new Set(branch.documentIds)
  return { selected: docs.filter((d) => ids.has(d.id)), others: docs.filter((d) => !ids.has(d.id)) }
}
