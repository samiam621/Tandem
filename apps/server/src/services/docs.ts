import { nanoid } from 'nanoid'
import { eq, and, asc, inArray } from 'drizzle-orm'
import { extractText, getDocumentProxy } from 'unpdf'
import { DOC_MAX_CHARS, type ProjectDoc, type ProjectDocMeta, type DocExcerpt, type UploadDocSchema } from '@tandem/shared'
import type { z } from 'zod'
import { getDb } from '../db/index.js'
import { projectDocs, sessions, branches } from '../db/schema.js'
import { bus } from '../events.js'
import { searchDocs as searchChunks } from '../ai/docs.js'
import { rowToBranch } from './branches.js'
import { isSessionMember } from './sessions.js'
import { fail } from './errors.js'

// Project docs: the specs and files (ARCHITECTURE.md, a PDF brief, …) a session's AI works from.
// Main's AI reads all of them; every other branch reads its pinnedDocIds in full and gets excerpts
// of the rest.

type Actor = { userId: string }

function assertMember(actor: Actor, sessionId: string) {
  if (!isSessionMember(sessionId, actor.userId)) fail(404, 'not_found', 'Session not found')
}

export function toMeta({ content, ...doc }: ProjectDoc): ProjectDocMeta {
  return { ...doc, chars: content.length }
}

// Every doc in a session, with content, oldest first. Used by the context builder; no permission check.
export function sessionDocs(sessionId: string): ProjectDoc[] {
  return getDb().select().from(projectDocs).where(eq(projectDocs.sessionId, sessionId)).orderBy(asc(projectDocs.createdAt)).all()
}

export function listDocs(actor: Actor, sessionId: string): ProjectDocMeta[] {
  assertMember(actor, sessionId)
  return sessionDocs(sessionId).map(toMeta)
}

export function getDoc(actor: Actor, docId: string): ProjectDoc {
  const doc = getDb().select().from(projectDocs).where(eq(projectDocs.id, docId)).get()
  if (!doc || !isSessionMember(doc.sessionId, actor.userId)) fail(404, 'not_found', 'Doc not found')
  return doc
}

async function pdfText(base64: string): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, 'base64')))
    return (await extractText(pdf, { mergePages: true })).text
  } catch {
    fail(400, 'invalid_request', 'Could not read this PDF')
  }
}

function checkLength(content: string) {
  if (content.length > DOC_MAX_CHARS) {
    fail(400, 'invalid_request', `The text is ${content.length.toLocaleString()} characters; the limit is ${DOC_MAX_CHARS.toLocaleString()}`)
  }
}

// Any member may create a doc: written in the app, a text file, or a PDF (stored as its extracted text).
export async function uploadDoc(actor: Actor, sessionId: string, body: z.infer<typeof UploadDocSchema>): Promise<ProjectDocMeta> {
  assertMember(actor, sessionId)
  const kind = 'pdfBase64' in body ? 'pdf' : 'text'
  const content = ('pdfBase64' in body ? await pdfText(body.pdfBase64) : body.text).trim()
  if (!content) fail(400, 'invalid_request', kind === 'pdf' ? 'This PDF has no extractable text (scanned?)' : 'The file is empty')
  checkLength(content)

  const ts = new Date().toISOString()
  const doc: ProjectDoc = {
    id: nanoid(), sessionId, title: body.title, kind, content,
    uploadedBy: actor.userId, createdAt: ts, updatedAt: ts, updatedBy: actor.userId,
  }
  getDb().insert(projectDocs).values(doc).run()
  const meta = toMeta(doc)
  bus.emitSession(sessionId, { type: 'doc_created', payload: meta })
  return meta
}

// Any member may edit. baseUpdatedAt must match the stored updatedAt, so a save never silently
// overwrites a teammate's.
export function updateDoc(
  actor: Actor,
  docId: string,
  changes: { title?: string; content: string; baseUpdatedAt: string },
): ProjectDoc {
  const doc = getDoc(actor, docId)
  checkLength(changes.content)
  // updatedAt doubles as the version, so it must strictly increase even within one millisecond.
  const base = Date.parse(changes.baseUpdatedAt)
  const ts = Number.isNaN(base) || Date.now() > base ? new Date().toISOString() : new Date(base + 1).toISOString()
  const res = getDb().update(projectDocs)
    .set({ content: changes.content, title: changes.title ?? doc.title, updatedAt: ts, updatedBy: actor.userId })
    .where(and(eq(projectDocs.id, docId), eq(projectDocs.updatedAt, changes.baseUpdatedAt)))
    .run()
  if (res.changes === 0) fail(409, 'conflict', `Someone updated ${doc.title} since you started editing`)

  const updated = getDb().select().from(projectDocs).where(eq(projectDocs.id, docId)).get()!
  bus.emitSession(doc.sessionId, { type: 'doc_updated', payload: toMeta(updated) })
  return updated
}

// The uploader or the session owner may delete. The doc is unpinned from every branch in the same transaction.
export function deleteDoc(actor: Actor, docId: string): void {
  const db = getDb()
  const doc = getDoc(actor, docId)
  const ownerId = db.select({ ownerId: sessions.ownerId }).from(sessions).where(eq(sessions.id, doc.sessionId)).get()?.ownerId
  if (actor.userId !== doc.uploadedBy && actor.userId !== ownerId) {
    fail(403, 'forbidden', 'Only the uploader or the session owner can delete this doc')
  }

  const pinning = db.select().from(branches).where(eq(branches.sessionId, doc.sessionId)).all()
    .filter((b) => b.pinnedDocIds.includes(docId))
  db.transaction((tx) => {
    tx.delete(projectDocs).where(eq(projectDocs.id, docId)).run()
    for (const b of pinning) {
      tx.update(branches).set({ pinnedDocIds: b.pinnedDocIds.filter((id) => id !== docId) }).where(eq(branches.id, b.id)).run()
    }
  })

  bus.emitSession(doc.sessionId, { type: 'doc_deleted', payload: { sessionId: doc.sessionId, docId } })
  for (const b of pinning) {
    const updated = rowToBranch(db.select().from(branches).where(eq(branches.id, b.id)).get()!)
    bus.emitSession(doc.sessionId, { type: 'branch_updated', payload: updated })
  }
}

export function searchDocs(actor: Actor, sessionId: string, query: string, k: number): DocExcerpt[] {
  assertMember(actor, sessionId)
  return searchChunks(sessionDocs(sessionId), query, k)
}

// Throws 400 unless every id is a project doc in this session. Returns the ids without duplicates.
export function checkDocIds(sessionId: string, docIds: string[]): string[] {
  const ids = [...new Set(docIds)]
  if (!ids.length) return ids
  const found = getDb().select({ id: projectDocs.id }).from(projectDocs)
    .where(and(eq(projectDocs.sessionId, sessionId), inArray(projectDocs.id, ids))).all()
  if (found.length !== ids.length) fail(400, 'invalid_request', 'Unknown project doc for this session')
  return ids
}

// The docs a branch's AI reads in full, and the rest (excerpted and named). Main reads every doc.
export function docsForBranch(
  branch: { sessionId: string; isMain: boolean; pinnedDocIds: string[] },
): { pinned: ProjectDoc[]; others: ProjectDoc[] } {
  const docs = sessionDocs(branch.sessionId)
  if (branch.isMain) return { pinned: docs, others: [] }
  const ids = new Set(branch.pinnedDocIds)
  return { pinned: docs.filter((d) => ids.has(d.id)), others: docs.filter((d) => !ids.has(d.id)) }
}
