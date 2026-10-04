import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@tandem/shared'
import { api } from '../lib/api'
import { nanoid } from 'nanoid'

interface AuthState {
  user: User | null
  loading: boolean
  signInGuest: (displayName: string) => Promise<void>
  signInWithGitHub: () => Promise<void>
  exchangeCode: (code: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem('tandem_device_id')
  if (!id) {
    id = nanoid(32)
    localStorage.setItem('tandem_device_id', id)
  }
  return id
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, try to restore session from saved token
  useEffect(() => {
    ;(async () => {
      try {
        const u = await api.auth.me()
        setUser(u)
      } catch {
        // Token invalid or missing — stay logged out
        await window.tandem.clearToken()
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Listen for tandem:// deep links
  useEffect(() => {
    return window.tandem.onProtocolUrl(async (url) => {
      try {
        const parsed = new URL(url)
        if (parsed.hostname === 'auth') {
          const code = parsed.searchParams.get('code')
          if (code) await exchangeCode(code)
        }
        // tandem://join/<inviteCode> is handled by the Home screen via a separate listener
      } catch {}
    })
  }, [])

  async function signInGuest(displayName: string) {
    const deviceId = getOrCreateDeviceId()
    const { user: u, token } = await api.auth.guest(displayName, deviceId)
    await window.tandem.setToken(token)
    setUser(u)
  }

  async function signInWithGitHub() {
    const url = await api.auth.githubUrl()
    // Open in system browser — the deep link will come back via protocol handler
    window.open(url, '_blank')
  }

  async function exchangeCode(code: string) {
    const { user: u, token } = await api.auth.exchange(code)
    await window.tandem.setToken(token)
    setUser(u)
  }

  async function signOut() {
    try { await api.auth.logout() } catch {}
    await window.tandem.clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInGuest, signInWithGitHub, exchangeCode, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
