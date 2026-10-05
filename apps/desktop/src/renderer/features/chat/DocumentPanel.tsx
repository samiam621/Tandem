import React, { useEffect, useState } from 'react'
import { DOC_MAX_CHARS, DOC_TITLE_MAX } from '@tandem/shared'
import type { ProjectDoc, ProjectDocMeta, User } from '@tandem/shared'
import { api } from '../../lib/api'
import { TextEditorPanel } from './TextEditorPanel'

interface Props {
  sessionId: string
  /** The open doc's listing, kept fresh by SessionView; null while creating a new one */
  meta: ProjectDocMeta | null
  members: User[]
  /** Deleting is for the doc's creator or the session owner */
  canDelete: boolean
  /** Called with the server's latest listing after a save */
  onSaved: (meta: ProjectDocMeta) => void
  onDeleted: (docId: string) => void
  onClose: () => void
}

const toMeta = ({ content, ...doc }: ProjectDoc): ProjectDocMeta => ({ ...doc, chars: content.length })

// A project doc (ARCHITECTURE.md, an uploaded PDF, …). Main's AI reads every doc; other branches
// read the ones pinned to them. Any member can create or edit.
export function DocumentPanel({ sessionId, meta, members, canDelete, onSaved, onDeleted, onClose }: Props) {
  const [doc, setDoc] = useState<ProjectDoc | null>(null)
  const [title, setTitle] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updatedByName = members.find((m) => m.id === doc?.updatedBy)?.displayName ?? null

  // Listings carry no text; fetch it on open and whenever a teammate saves a new version.
  useEffect(() => {
    if (!meta) return
    api.docs.get(meta.id).then(setDoc).catch((err) => setError(err?.message ?? 'Failed to load'))
  }, [meta?.id, meta?.updatedAt])

  async function remove() {
    if (!doc) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    try {
      await api.docs.delete(doc.id)
      onDeleted(doc.id)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete')
    }
  }

  if (meta && !doc) return null // loading; errors show once the editor opens

  return (
    <TextEditorPanel
      title={doc ? doc.title : (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={DOC_TITLE_MAX}
          placeholder="Name, e.g. ARCHITECTURE.md"
          className="w-72 rounded bg-raised px-2 py-1 text-sm font-normal outline-none focus:ring-1 focus:ring-accent"
        />
      )}
      hint="Main’s AI reads every doc; each branch reads the ones pinned to it and gets excerpts of the rest"
      current={{ content: doc?.content ?? '', version: doc?.updatedAt ?? null, updatedByName }}
      maxChars={DOC_MAX_CHARS}
      placeholder="Paste a spec, README, TODO list…"
      emptyText="This doc is empty."
      startEditing={!meta}
      error={error}
      actions={doc && canDelete && (
        <button onClick={remove} onBlur={() => setConfirmDelete(false)} className="text-xs rounded-lg px-3 py-1.5 text-danger hover:bg-danger/10">
          {confirmDelete ? 'Click again to delete' : 'Delete'}
        </button>
      )}
      onSave={async (draft, base) => {
        if (doc && base) {
          const saved = await api.docs.update(doc.id, { content: draft, baseUpdatedAt: base })
          setDoc(saved)
          onSaved(toMeta(saved))
          return
        }
        const name = title.trim()
        if (!name) throw new Error('Give the doc a name')
        if (!draft.trim()) throw new Error('The doc is empty')
        onSaved(await api.docs.upload(sessionId, { title: name, text: draft }))
      }}
      onConflict={async () => {
        if (doc) setDoc(await api.docs.get(doc.id))
      }}
      onClose={onClose}
    />
  )
}
