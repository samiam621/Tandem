import React, { useState } from 'react'
import { BRIEF_MAX_CHARS } from '@tandem/shared'
import type { User } from '@tandem/shared'
import { api } from '../../lib/api'

export interface BriefState {
  brief: string
  briefUpdatedAt: string | null
  briefUpdatedBy: string | null
}

interface Props {
  sessionId: string
  /** The latest brief, kept fresh by SessionView from REST and `brief_updated` events */
  current: BriefState
  members: User[]
  /** Called with the server's latest brief after a save, or after a conflict refetch */
  onChange: (next: BriefState) => void
  onClose: () => void
}

// The session's shared project brief. Every branch's AI reads the latest version, so this is
// where specs and decisions live. Any member can edit; a save made from an outdated version is
// refused by the server (409) and the draft is kept.
export function BriefPanel({ sessionId, current, members, onChange, onClose }: Props) {
  const [draft, setDraft] = useState<string | null>(null) // null = not editing
  const [base, setBase] = useState<string | null>(null) // briefUpdatedAt the draft started from
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editing = draft !== null
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.displayName ?? 'Someone'
  // A teammate saved after this draft started: the next save would be refused.
  const stale = editing && current.briefUpdatedAt !== base

  function startEdit() {
    setDraft(current.brief)
    setBase(current.briefUpdatedAt)
    setError(null)
  }

  function loadLatest() {
    setDraft(current.brief)
    setBase(current.briefUpdatedAt)
    setError(null)
  }

  async function save() {
    if (draft === null) return
    setSaving(true)
    setError(null)
    try {
      const s = await api.sessions.updateBrief(sessionId, draft, base)
      onChange({ brief: s.brief, briefUpdatedAt: s.briefUpdatedAt, briefUpdatedBy: s.briefUpdatedBy })
      setDraft(null)
    } catch (err: any) {
      if (err?.status === 409) {
        // Pull the newer version so the "updated while you were editing" banner shows even if
        // its brief_updated event has not arrived yet.
        const { session: s } = await api.sessions.get(sessionId)
        onChange({ brief: s.brief, briefUpdatedAt: s.briefUpdatedAt, briefUpdatedBy: s.briefUpdatedBy })
      } else {
        setError(err?.message ?? 'Failed to save the brief')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Project brief</h2>
            <p className="text-[11px] text-gray-500">
              {current.briefUpdatedAt
                ? `Updated by ${nameOf(current.briefUpdatedBy)} · ${new Date(current.briefUpdatedAt).toLocaleString()}`
                : 'Every branch’s AI reads the latest version'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm px-2">✕</button>
        </div>

        {stale && (
          <div className="flex items-center justify-between gap-2 border-b border-gray-800 bg-yellow-900/30 px-4 py-2 text-xs text-yellow-200">
            <span>{nameOf(current.briefUpdatedBy)} updated the brief while you were editing. Your draft is kept.</span>
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
              maxLength={BRIEF_MAX_CHARS}
              autoFocus
              placeholder="Specs, docs, and decisions every workstream should follow…"
              className="w-full h-[50vh] resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-blue-500 font-mono"
            />
          ) : current.brief ? (
            <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">{current.brief}</p>
          ) : (
            <p className="text-sm text-gray-500 leading-relaxed">
              No brief yet. Put the project’s specs, docs, and decisions here. Every branch’s AI reads the
              latest version, even branches created before an edit, so the team builds against one source of truth.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-4 py-3">
          <span className="text-xs text-red-400 truncate">
            {error ?? (editing ? `${draft.length.toLocaleString()} / ${BRIEF_MAX_CHARS.toLocaleString()}` : '')}
          </span>
          {editing ? (
            <span className="flex gap-2">
              <button onClick={() => setDraft(null)} className="text-xs rounded-lg px-3 py-1.5 text-gray-400 hover:bg-gray-800">
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
            <button onClick={startEdit} className="text-xs rounded-lg bg-gray-700 px-3 py-1.5 hover:bg-gray-600">
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
