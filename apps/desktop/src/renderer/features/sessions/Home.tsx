import React, { useEffect, useState, useCallback } from 'react'
import type { Session } from '@tandem/shared'
import { api } from '../../lib/api'
import { Icon, TandemMark } from '../../components/Icon'
import { useAuth } from '../../app/AuthContext'

interface Props {
  onOpenSession: (session: Session) => void
  onSettings: () => void
  initialAction?: string | null
  onActionHandled?: () => void
}

export function Home({ onOpenSession, onSettings, initialAction, onActionHandled }: Props) {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<Session[]>([])
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [showNew, setShowNew] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newModel, setNewModel] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const data = await api.sessions.list().catch(() => [])
    setSessions(data)
  }, [])

  useEffect(() => {
    refresh()
    api.models.list().then((ms) => {
      setModels(ms)
      if (ms.length) setNewModel(ms[0].id)
    }).catch(() => {})
  }, [refresh])

  // Handle menu actions from main process
  useEffect(() => {
    if (!initialAction) return
    if (initialAction === 'new-session') {
      setShowNew(true)
      setShowJoin(false)
    } else if (initialAction === 'join-session') {
      setShowJoin(true)
      setShowNew(false)
    }
    onActionHandled?.()
  }, [initialAction, onActionHandled])

  // Handle tandem://join/<code> deep links
  useEffect(() => {
    return window.tandem.onProtocolUrl(async (url) => {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === 'join') {
          const code = parsed.pathname.slice(1) // remove leading /
          if (code) {
            const result = await api.sessions.join(code)
            setSessions((prev) => prev.find((s) => s.id === result.session.id) ? prev : [...prev, result.session])
            onOpenSession(result.session)
          }
        }
      } catch (e: any) {
        setError(e.message ?? 'Failed to join session')
      }
    })
  }, [onOpenSession])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newModel) return
    setLoading(true)
    setError('')
    try {
      const result = await api.sessions.create(newTitle.trim(), newModel)
      setSessions((prev) => [result.session, ...prev])
      setShowNew(false)
      setNewTitle('')
      onOpenSession(result.session)
    } catch (err: any) {
      setError(err.message ?? 'Failed to create session')
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!joinCode.trim()) return
    setLoading(true)
    setError('')
    try {
      const result = await api.sessions.join(joinCode.trim())
      setSessions((prev) => prev.find((s) => s.id === result.session.id) ? prev : [...prev, result.session])
      setShowJoin(false)
      setJoinCode('')
      onOpenSession(result.session)
    } catch (err: any) {
      setError(err.message ?? 'Invalid invite code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="app-header justify-between">
        <span className="flex items-center gap-2 font-medium"><TandemMark className="h-6 w-6" />Tandem</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-secondary">{user?.displayName}</span>
          <button onClick={onSettings} className="icon-button" aria-label="Settings" title="Settings"><Icon name="settings" /></button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-2xl overflow-y-auto py-12 px-8 space-y-5">
          <div className="mb-10">
            <p className="mb-3 text-xs text-muted">Your workspace</p>
            <h1 className="font-prose text-3xl">What will you build together?</h1>
            <p className="mt-3 text-ui text-secondary">Pick up a conversation, or start something new with your team.</p>
          </div>
          <div className="flex items-center justify-between">
            <h2 className="text-ui font-medium">Sessions</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowJoin(!showJoin); setShowNew(false) }}
                className="button-secondary py-1.5"
              >
                Join
              </button>
              <button
                onClick={() => { setShowNew(!showNew); setShowJoin(false) }}
                className="button-primary py-1.5"
              >
                <Icon name="plus" /> New session
              </button>
            </div>
          </div>

          {/* New session form */}
          {showNew && (
            <form onSubmit={handleCreate} className="space-y-3 rounded-xl border border-line bg-raised p-5">
              <input
                autoFocus
                type="text"
                aria-label="Session title" placeholder="Session title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="field w-full"
              />
              <select
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                aria-label="Default model" className="field w-full"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowNew(false)} className="flex-1 rounded-lg bg-selected py-2 text-xs hover:bg-hover">Cancel</button>
                <button type="submit" disabled={loading} className="button-primary flex-1 py-2 text-xs">Create</button>
              </div>
            </form>
          )}

          {/* Join session form */}
          {showJoin && (
            <form onSubmit={handleJoin} className="space-y-3 rounded-xl border border-line bg-raised p-5">
              <input
                autoFocus
                type="text"
                aria-label="Invite code" placeholder="Invite code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="field w-full"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowJoin(false)} className="flex-1 rounded-lg bg-selected py-2 text-xs hover:bg-hover">Cancel</button>
                <button type="submit" disabled={loading} className="button-primary flex-1 py-2 text-xs">Join</button>
              </div>
            </form>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          {/* Session list */}
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-6 py-12 text-center text-ui text-muted">No sessions yet. Create one to get started.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => onOpenSession(s)}
                    className="group flex w-full items-center gap-4 rounded-lg px-3 py-4 text-left hover:bg-hover"
                  >
                    <Icon name="chat" className="h-5 w-5 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{s.title}</div>
                    <div className="mt-1 truncate text-xs text-muted">{s.defaultModel.split('/').pop()}</div></div>
                    <span className="text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
