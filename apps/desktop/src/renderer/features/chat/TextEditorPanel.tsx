import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'

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
  const dialogRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? [])
    focusable()[0]?.focus()
    function containFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    dialog?.addEventListener('keydown', containFocus)
    return () => {
      dialog?.removeEventListener('keydown', containFocus)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  // Escape closes the panel, but never throws away a draft.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!editing) onClose() }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'New document'}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-line bg-raised shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{title}</h2>
            <p className="text-xs text-muted">
              {current.version
                ? `Updated by ${current.updatedByName ?? 'Someone'} · ${new Date(current.version).toLocaleString()}`
                : hint}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="icon-button"><Icon name="close" /></button>
        </div>

        {stale && (
          <div className="flex items-center justify-between gap-2 border-b border-line bg-warning/10 px-4 py-2 text-xs text-warning">
            <span>{current.updatedByName ?? 'Someone'} saved a newer version while you were editing. Your draft is kept.</span>
            <button onClick={loadLatest} className="shrink-0 rounded bg-warning/10 px-2 py-0.5 hover:bg-warning/20">
              Load their version
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={maxChars}
              autoFocus
              placeholder={placeholder}
              aria-label="Content"
              className="w-full h-[50vh] resize-none rounded-lg border border-control bg-canvas px-3 py-2 text-ui text-primary outline-none focus:ring-1 focus:ring-accent font-mono"
            />
          ) : current.content ? (
            <p className="text-message text-primary whitespace-pre-wrap [overflow-wrap:anywhere]">{current.content}</p>
          ) : (
            <p className="text-sm text-muted leading-relaxed">{emptyText}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <span className="text-xs text-danger truncate">
            {shownError ?? (editing ? <span className="text-muted">{`${draft.length.toLocaleString()} / ${maxChars.toLocaleString()}`}</span> : '')}
          </span>
          {editing ? (
            <span className="flex gap-2">
              <button onClick={() => (startEditing && !current.version ? onClose() : setDraft(null))} className="text-xs rounded-lg px-3 py-1.5 text-secondary hover:bg-hover">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || stale}
                className="button-primary py-1.5"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </span>
          ) : (
            <span className="flex gap-2">
              {actions}
              <button onClick={loadLatest} className="text-xs rounded-lg bg-selected px-3 py-1.5 hover:bg-hover">
                Edit
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
