import React, { useEffect, useState } from 'react'
import type { SessionKeyInfo, User } from '@tandem/shared'
import { api } from '../../lib/api'
import { Icon } from '../../components/Icon'

interface Props {
  info: SessionKeyInfo
  isOwner: boolean
  members: User[]
  /** Called with the server's latest key status after a set or remove */
  onChange: (next: SessionKeyInfo) => void
  onClose: () => void
}

// The session's own OpenRouter key (BYOK). The owner sets it once and every member's AI in the
// session runs on it. The key goes straight to the server; the app only ever shows its last four
// characters.
export function SessionKeyPanel({ info, isOwner, members, onChange, onClose }: Props) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setByName = members.find((m) => m.id === info.setBy)?.displayName ?? 'the owner'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(action: () => Promise<SessionKeyInfo>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await action())
      setKey('')
      setConfirmRemove(false)
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="OpenRouter key"
        className="w-full max-w-md flex flex-col rounded-2xl border border-line bg-raised shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">OpenRouter key</h2>
            <p className="text-xs text-muted">Every member’s AI in this session runs on it</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="icon-button"><Icon name="close" /></button>
        </div>

        <div className="space-y-4 px-5 py-5 text-ui">
          <p className="text-secondary">
            {info.hasKey
              ? <>Using {setByName}’s key ending in <span className="font-mono text-primary">…{info.keyLast4}</span>. Any model can be used.</>
              : 'No key yet: replies use Tandem’s shared key, free models only.'}
          </p>

          {isOwner ? (
            <form
              onSubmit={(e) => { e.preventDefault(); if (key.trim()) run(() => api.sessions.setKey(info.sessionId, key.trim())) }}
              className="space-y-2"
            >
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={info.hasKey ? 'Replace with a new key (sk-or-…)' : 'sk-or-…'}
                aria-label="OpenRouter key"
                autoComplete="off"
                className="w-full rounded-lg bg-canvas px-3 py-2 text-ui outline-none ring-1 ring-control focus:ring-accent font-mono"
              />
              <p className="text-xs text-muted leading-snug">
                Members spend your OpenRouter credits. Set a credit limit on this key in OpenRouter to cap what the session can spend.
              </p>
              <div className="flex justify-end gap-2">
                {info.hasKey && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (confirmRemove ? run(() => api.sessions.removeKey(info.sessionId)) : setConfirmRemove(true))}
                    className="text-xs rounded-lg px-3 py-1.5 text-danger hover:bg-hover disabled:opacity-50"
                  >
                    {confirmRemove ? 'Remove the key?' : 'Remove'}
                  </button>
                )}
                <button type="submit" disabled={busy || !key.trim()} className="button-primary py-1.5">
                  {busy ? 'Checking…' : info.hasKey ? 'Replace key' : 'Save key'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-xs text-muted">Only the session owner can add or change the key.</p>
          )}
          {error && <p className="text-xs text-danger break-words" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  )
}
