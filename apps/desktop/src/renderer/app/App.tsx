import React, { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './AuthContext'
import { SignIn } from '../features/auth/SignIn'
import { Home } from '../features/sessions/Home'
import { SessionView } from '../features/chat/SessionView'
import { Settings } from '../features/settings/Settings'
import type { Session } from '@tandem/shared'

function Inner() {
  const { user, loading } = useAuth()
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  // Handle File menu actions sent from the main process
  useEffect(() => {
    return window.tandem.onMenuAction((action) => {
      setPendingAction(action)
    })
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        Loading…
      </div>
    )
  }

  if (!user) return <SignIn />

  if (showSettings || pendingAction === 'settings') {
    if (pendingAction === 'settings') setPendingAction(null)
    return <Settings onClose={() => setShowSettings(false)} />
  }

  if (activeSession) {
    return <SessionView session={activeSession} onBack={() => setActiveSession(null)} />
  }

  return (
    <Home
      onOpenSession={setActiveSession}
      onSettings={() => setShowSettings(true)}
      initialAction={pendingAction}
      onActionHandled={() => setPendingAction(null)}
    />
  )
}

export function App() {
  return (
    <AuthProvider>
      <Inner />
    </AuthProvider>
  )
}
