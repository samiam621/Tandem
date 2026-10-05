import React, { useState } from 'react'
import { AI_AUTHOR, BRANCH_CONTEXT_MAX_CHARS } from '@tandem/shared'
import type { Branch, User } from '@tandem/shared'
import { api } from '../../lib/api'
import { TextEditorPanel } from './TextEditorPanel'

interface Props {
  /** The branch, kept fresh by SessionView from REST and `branch_updated` events */
  branch: Branch
  members: User[]
  canEdit: boolean // the branch owner
  /** Called with the server's latest branch after a save, regenerate, or conflict refetch */
  onChange: (next: Branch) => void
  onClose: () => void
}

// A branch's context: what it needs from the conversation it split off from, with sources in
// [brackets]. AI writes it when the branch is created; its owner can edit or regenerate it. It
// stands in for the parent's earlier messages, which the branch's AI does not see.
export function BranchContextPanel({ branch, members, canEdit, onChange, onClose }: Props) {
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updatedByName = branch.branchContextUpdatedBy === AI_AUTHOR
    ? 'Tandem AI'
    : members.find((m) => m.id === branch.branchContextUpdatedBy)?.displayName ?? null

  async function regenerate() {
    setRegenerating(true)
    setError(null)
    try {
      onChange(await api.branches.regenerateContext(branch.id))
    } catch (err: any) {
      setError(err?.message ?? 'Failed to write the branch context')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <TextEditorPanel
      title={`Branch context · ${branch.name}`}
      hint={branch.purpose ? `For: ${branch.purpose}` : 'What this branch needs from the conversation it split off from'}
      current={{ content: branch.branchContext ?? '', version: branch.branchContextUpdatedAt, updatedByName }}
      maxChars={BRANCH_CONTEXT_MAX_CHARS}
      placeholder={'- A decision this branch needs [Sam in main, Oct 2]\n- A constraint from a spec [FRONTEND.md § Styling]'}
      emptyText="No branch context yet. AI writes one from the parent conversation when the branch is created (this needs an OpenRouter key). This branch's AI does not see the parent's earlier messages, only this context, the last few messages before the fork, and its own; it can ask the parent branch for anything missing."
      readOnly={!canEdit}
      error={error}
      actions={canEdit && (
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="text-xs rounded-lg bg-selected px-3 py-1.5 hover:bg-hover disabled:opacity-50"
        >
          {regenerating ? 'Writing…' : 'Regenerate'}
        </button>
      )}
      onSave={async (draft, base) => onChange(await api.branches.updateContext(branch.id, draft, base))}
      onConflict={async () => {
        const fresh = (await api.sessions.branches(branch.sessionId)).find((b) => b.id === branch.id)
        if (fresh) onChange(fresh)
      }}
      onClose={onClose}
    />
  )
}
