import { nanoid } from 'nanoid'
import { eq, and } from 'drizzle-orm'
import { extractText, getDocumentProxy } from 'unpdf'
import { DOC_MAX_CHARS, type ProjectDoc, type ProjectDocMeta, type DocExcerpt, type UploadDocSchema } from '@tandem/shared'
import type { z } from 'zod'
import { getDb } from '../db/index.js'
import { projectDocs, sessionMembers, sessions, branches } from '../db/schema.js'
import { bus } from '../events.js'
import { searchDocs as searchChunks } from '../ai/docs.js'
import { rowToBranch } from './branches.js'

type Actor = { userId: string }

function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { code, status })
}

function assertMember(actor: Actor, sessionId: string) {
  const member = getDb().select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, actor.userId))).get()
  if (!member) fail(404, 'not_found', 'Session not found')
}

function toMeta({ content, ...doc }: ProjectDoc): ProjectDocMeta {
  return { ...doc, chars: content.length }
}

// Every doc in a session, with content. Used by the context builder; no permission check.
export function sessionDocs(sessionId: string): ProjectDoc[] {
  return getDb().select().from(projectDocs).where(eq(projectDocs.sessionId, sessionId)).all()
}

export function listDocs(actor: Actor, sessionId: string): ProjectDocMeta[] {
  assertMember(actor, sessionId)
  return sessionDocs(sessionId).map(toMeta)
}

export function getDoc(actor: Actor, docId: string): ProjectDoc {
  const doc = getDb().select().from(projectDocs).where(eq(projectDocs.id, docId)).get()
  if (!doc) fail(404, 'not_found', 'Doc not found')
  assertMember(actor, doc.sessionId)
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

// Any member may upload. A PDF is stored as its extracted text.
export async function uploadDoc(actor: Actor, sessionId: string, body: z.infer<typeof UploadDocSchema>): Promise<ProjectDocMeta> {
  assertMember(actor, sessionId)
  const kind = 'pdfBase64' in body ? 'pdf' : 'text'
  const content = ('pdfBase64' in body ? await pdfText(body.pdfBase64) : body.text).trim()
  if (!content) fail(400, 'invalid_request', kind === 'pdf' ? 'This PDF has no extractable text (scanned?)' : 'The file is empty')
  if (content.length > DOC_MAX_CHARS) {
    fail(400, 'invalid_request', `The text is ${content.length.toLocaleString()} characters; the limit is ${DOC_MAX_CHARS.toLocaleString()}`)
  }

  const doc: ProjectDoc = { id: nanoid(), sessionId, title: body.title, kind, content, uploadedBy: actor.userId, createdAt: new Date().toISOString() }
  getDb().insert(projectDocs).values(doc).run()
  const meta = toMeta(doc)
  bus.emitSession(sessionId, { type: 'doc_created', payload: meta })
  return meta
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
