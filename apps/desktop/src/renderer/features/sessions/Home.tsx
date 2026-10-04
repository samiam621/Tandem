import React, { useEffect, useState, useCallback } from 'react'
import type { Session } from '@tandem/shared'
import { api } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'

interface Props {
  onOpenSession: (session: Session) => void
  onSettings: () => void
  initialAction?: string | null
  onActionHandled?: () => void
}

export function Home({ onOpenSession, onSettings, initialAction, onActionHandled }: Props) {
  const { user, signOut } = useAuth()
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
      <div className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
        <span className="font-bold text-lg">Tandem</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{user?.displayName}</span>
          <button onClick={onSettings} className="text-xs text-gray-500 hover:text-gray-300">Settings</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-lg overflow-y-auto py-8 px-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Sessions</h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowJoin(!showJoin); setShowNew(false) }}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs hover:bg-gray-700"
              >
                Join
              </button>
              <button
                onClick={() => { setShowNew(!showNew); setShowJoin(false) }}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs hover:bg-blue-700"
              >
                + New
              </button>
            </div>
          </div>

          {/* New session form */}
          {showNew && (
            <form onSubmit={handleCreate} className="space-y-2 rounded-xl bg-gray-800 p-4">
              <input
                autoFocus
                type="text"
                placeholder="Session title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm outline-none ring-1 ring-gray-600 focus:ring-blue-500"
              />
              <select
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm outline-none ring-1 ring-gray-600"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowNew(false)} className="flex-1 rounded-lg bg-gray-700 py-2 text-xs hover:bg-gray-600">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 rounded-lg bg-blue-600 py-2 text-xs hover:bg-blue-700 disabled:opacity-50">Create</button>
              </div>
            </form>
          )}

          {/* Join session form */}
          {showJoin && (
            <form onSubmit={handleJoin} className="space-y-2 rounded-xl bg-gray-800 p-4">
              <input
                autoFocus
                type="text"
                placeholder="Invite code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm outline-none ring-1 ring-gray-600 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowJoin(false)} className="flex-1 rounded-lg bg-gray-700 py-2 text-xs hover:bg-gray-600">Cancel</button>
                <button type="submit" disabled={loading} className="flex-1 rounded-lg bg-blue-600 py-2 text-xs hover:bg-blue-700 disabled:opacity-50">Join</button>
              </div>
            </form>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          {/* Session list */}
          {sessions.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">No sessions yet. Create one to get started.</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => onOpenSession(s)}
                    className="w-full text-left rounded-xl bg-gray-800 px-4 py-3 hover:bg-gray-700 transition-colors"
                  >
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{s.defaultModel}</div>
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
