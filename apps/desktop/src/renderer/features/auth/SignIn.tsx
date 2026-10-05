import React, { useState } from 'react'
import { TandemMark } from '../../components/Icon'
import { useAuth } from '../../app/AuthContext'

export function SignIn() {
  const { signInGuest, signInWithGitHub, exchangeCode } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleGuest(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    setLoading(true)
    setError('')
    try {
      await signInGuest(displayName.trim())
    } catch (err: any) {
      setError(err.message ?? 'Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleExchangeCode(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      await exchangeCode(code.trim())
    } catch (err: any) {
      setError(err.message ?? 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="app-header"><span className="text-secondary">Tandem</span></div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm space-y-5 px-6">
        <div className="text-center">
          <TandemMark className="mx-auto mb-5 h-10 w-10" />
          <h1 className="font-prose text-3xl font-normal">Better thinking, together.</h1>
          <p className="mt-3 text-ui text-muted">Your team. Your agents. One conversation.</p>
        </div>

        {/* GitHub sign-in */}
        <button
          onClick={signInWithGitHub}
          disabled={loading}
          className="button-primary w-full py-2.5"
        >
          <GithubIcon />
          Continue with GitHub
        </button>

        <div className="relative flex items-center">
          <div className="flex-1 border-t border-line" />
          <span className="mx-3 text-xs text-muted">or</span>
          <div className="flex-1 border-t border-line" />
        </div>

        {/* Paste fallback code from GitHub callback */}
        <form onSubmit={handleExchangeCode} className="space-y-2">
          <input
            type="text"
            aria-label="Sign-in code" placeholder="Paste sign-in code…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="field w-full"
          />
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="button-secondary w-full"
          >
            Use code
          </button>
        </form>

        <div className="relative flex items-center">
          <div className="flex-1 border-t border-line" />
          <span className="mx-3 text-xs text-muted">or continue as guest</span>
          <div className="flex-1 border-t border-line" />
        </div>

        {/* Guest sign-in */}
        <form onSubmit={handleGuest} className="space-y-2">
          <input
            type="text"
            aria-label="Display name" placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="field w-full"
          />
          <button
            type="submit"
            disabled={loading || !displayName.trim()}
            className="button-secondary w-full"
          >
            {loading ? 'Signing in…' : 'Continue as guest'}
          </button>
        </form>

        {error && <p className="text-center text-sm text-danger">{error}</p>}
      </div>
      </div>
    </div>
  )
}

function GithubIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.807 5.625-5.479 5.92.43.372.823 1.102.823 2.222v3.293c0 .319.216.694.825.576C20.565 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  )
}
