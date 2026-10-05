import React, { useState } from 'react'
import { BRIEF_MAX_CHARS } from '@tandem/shared'
import type { Session, User } from '@tandem/shared'
import { api } from '../../lib/api'
import { TextEditorPanel } from './TextEditorPanel'

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
  /** Called with the server's latest brief after a save, refresh, or conflict refetch */
  onChange: (next: BriefState) => void
  onClose: () => void
}

const toState = (s: Session): BriefState => ({ brief: s.brief, briefUpdatedAt: s.briefUpdatedAt, briefUpdatedBy: s.briefUpdatedBy })

// The brief: a short summary of main (direction, decisions, who's on what) that every branch's AI
// reads. AI rewrites it on Refresh and every 20 main messages; any member can also edit it.
export function BriefPanel({ sessionId, current, members, onChange, onClose }: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updatedByName = current.briefUpdatedBy === 'system'
    ? 'Tandem AI'
    : members.find((m) => m.id === current.briefUpdatedBy)?.displayName ?? null

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      onChange(toState(await api.sessions.refreshBrief(sessionId)))
    } catch (err: any) {
      setError(err?.message ?? 'Failed to refresh the brief')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <TextEditorPanel
      title="Brief"
      hint="A summary of main that every branch’s AI reads"
      current={{ content: current.brief, version: current.briefUpdatedAt, updatedByName }}
      maxChars={BRIEF_MAX_CHARS}
      placeholder="Where the project stands: direction, decisions, who is working on what…"
      emptyText="No brief yet. Refresh to have AI summarize main: the direction, decisions, and who is working on what. Every branch’s AI reads the latest version. Put specs and docs in Documents instead."
      error={error}
      actions={
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-xs rounded-lg bg-gray-700 px-3 py-1.5 hover:bg-gray-600 disabled:opacity-50"
        >
          {refreshing ? 'Summarizing main…' : 'Refresh from main'}
        </button>
      }
      onSave={async (draft, base) => onChange(toState(await api.sessions.updateBrief(sessionId, draft, base)))}
      onConflict={async () => onChange(toState((await api.sessions.get(sessionId)).session))}
      onClose={onClose}
    />
  )
}
