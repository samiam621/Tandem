import React, { useEffect, useState } from 'react'

export interface VersionedText {
  content: string
  version: string | null // the server's updatedAt; a save must start from the current one
  updatedByName: string | null
}

interface Props {
  title: React.ReactNode
  /** Shown under the title when nothing has been saved yet */
  hint: string
  /** The latest saved text, kept fresh by the parent from REST and WS events */
  current: VersionedText
  maxChars: number
  placeholder: string
  emptyText: string
  /** Start in edit mode (e.g. a new document) */
  startEditing?: boolean
  /** Extra buttons shown while not editing (e.g. Refresh, Delete) */
  actions?: React.ReactNode
  /** Saves the draft made from `base`. On a 409, the parent refetches so `current` moves on. */
  onSave: (draft: string, base: string | null) => Promise<void>
  onConflict: () => Promise<void>
  onClose: () => void
  error?: string | null
}

// A modal for reading and editing shared text that any member can change. A save made from an
// outdated version is refused by the server (409) and the draft is kept.
export function TextEditorPanel({
  title, hint, current, maxChars, placeholder, emptyText, startEditing, actions, onSave, onConflict, onClose, error: outerError,
}: Props) {
  const [draft, setDraft] = useState<string | null>(startEditing ? current.content : null) // null = not editing
  const [base, setBase] = useState<string | null>(current.version) // version the draft started from
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editing = draft !== null
  // A teammate saved after this draft started: the next save would be refused.
  const stale = editing && current.version !== base

  function loadLatest() {
    setDraft(current.content)
    setBase(current.version)
    setError(null)
  }

  async function save() {
    if (draft === null) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft, base)
      setDraft(null)
    } catch (err: any) {
      // Pull the newer version so the "updated while you were editing" banner shows even if
      // its WS event has not arrived yet.
      if (err?.status === 409) await onConflict().catch(() => {})
      setError(err?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const shownError = error ?? outerError ?? null

  // Escape closes the panel, but never throws away a draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'New document'}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{title}</h2>
            <p className="text-[11px] text-gray-500">
              {current.version
                ? `Updated by ${current.updatedByName ?? 'Someone'} · ${new Date(current.version).toLocaleString()}`
                : hint}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-300 text-sm px-2">✕</button>
        </div>

        {stale && (
          <div className="flex items-center justify-between gap-2 border-b border-gray-800 bg-yellow-900/30 px-4 py-2 text-xs text-yellow-200">
            <span>{current.updatedByName ?? 'Someone'} saved a newer version while you were editing. Your draft is kept.</span>
            <button onClick={loadLatest} className="shrink-0 rounded bg-yellow-800/60 px-2 py-0.5 hover:bg-yellow-700/60">
              Load their version
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={maxChars}
              autoFocus
              placeholder={placeholder}
              className="w-full h-[50vh] resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
          ) : current.content ? (
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{current.content}</p>
          ) : (
            <p className="text-sm text-gray-500 leading-relaxed">{emptyText}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
          <span className="text-xs text-red-400 truncate">
            {shownError ?? (editing ? <span className="text-gray-500">{`${draft.length.toLocaleString()} / ${maxChars.toLocaleString()}`}</span> : '')}
          </span>
          {editing ? (
            <span className="flex gap-2">
              <button onClick={() => (startEditing && !current.version ? onClose() : setDraft(null))} className="text-xs rounded-lg px-3 py-1.5 text-gray-400 hover:bg-gray-800">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || stale}
                className="text-xs rounded-lg bg-blue-600 px-3 py-1.5 hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </span>
          ) : (
            <span className="flex gap-2">
              {actions}
              <button onClick={loadLatest} className="text-xs rounded-lg bg-gray-700 px-3 py-1.5 hover:bg-gray-600">
                Edit
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
