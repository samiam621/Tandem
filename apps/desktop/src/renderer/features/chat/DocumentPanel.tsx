import React, { useState } from 'react'
import { DOCUMENT_MAX_CHARS, DOCUMENT_NAME_MAX } from '@tandem/shared'
import type { SessionDocument, User } from '@tandem/shared'
import { api } from '../../lib/api'
import { TextEditorPanel } from './TextEditorPanel'

interface Props {
  sessionId: string
  /** The open document, kept fresh by SessionView; null while creating a new one */
  doc: SessionDocument | null
  members: User[]
  /** Called with the server's latest version after a save or conflict refetch */
  onSaved: (doc: SessionDocument) => void
  onDeleted: (documentId: string) => void
  onClose: () => void
}

// A session document (ARCHITECTURE.md, TODO.md, …). Main's AI reads every document; other branches
// read the ones they selected. Any member can create, edit, or delete.
export function DocumentPanel({ sessionId, doc, members, onSaved, onDeleted, onClose }: Props) {
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updatedByName = members.find((m) => m.id === doc?.updatedBy)?.displayName ?? null

  async function remove() {
    if (!doc) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    try {
      await api.documents.delete(doc.id)
      onDeleted(doc.id)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete')
    }
  }

  return (
    <TextEditorPanel
      title={doc ? doc.name : (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DOCUMENT_NAME_MAX}
          placeholder="Name, e.g. ARCHITECTURE.md"
          className="w-72 rounded bg-gray-800 px-2 py-1 text-sm font-normal outline-none focus:ring-1 focus:ring-blue-500"
        />
      )}
      hint="Main’s AI reads every document; each branch reads the ones it selected"
      current={{ content: doc?.content ?? '', version: doc?.updatedAt ?? null, updatedByName }}
      maxChars={DOCUMENT_MAX_CHARS}
      placeholder="Paste a spec, README, TODO list…"
      emptyText="This document is empty."
      startEditing={!doc}
      error={error}
      actions={doc && (
        <button onClick={remove} onBlur={() => setConfirmDelete(false)} className="text-xs rounded-lg px-3 py-1.5 text-red-400 hover:bg-red-900/30">
          {confirmDelete ? 'Click again to delete' : 'Delete'}
        </button>
      )}
      onSave={async (draft, base) => {
        const docName = doc?.name ?? name.trim()
        if (!docName) throw new Error('Give the document a name')
        onSaved(await api.documents.save(sessionId, docName, draft, base))
      }}
      onConflict={async () => {
        if (!doc) return
        onSaved(await api.documents.get(doc.id))
      }}
      onClose={onClose}
    />
  )
}
