import React, { useEffect, useState } from 'react'
import type { ApiToken } from '@tandem/shared'
import { api } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../app/AuthContext'

interface Props {
  onClose: () => void
}

export function Settings({ onClose }: Props) {
  const { user, signOut } = useAuth()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [newLabel, setNewLabel] = useState('Claude')
  const [justCreated, setJustCreated] = useState<{ token: ApiToken; rawToken: string } | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [serverUrlDraft, setServerUrlDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [tokenError, setTokenError] = useState<string | null>(null)

  useEffect(() => {
    api.tokens.list().then(setTokens).catch(() => {})
    window.tandem.getServerUrl().then((url) => {
      setServerUrl(url)
      setServerUrlDraft(url)
    })
  }, [])

  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault()
    if (!newLabel.trim()) return
    setLoading(true)
    setTokenError(null)
    try {
      const result = await api.tokens.create(newLabel.trim())
      setTokens((prev) => [...prev, result.token])
      setJustCreated(result)
      setNewLabel('Claude')
    } catch (err: any) {
      setTokenError(err?.message ?? 'Failed to create token')
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(id: string) {
    await api.tokens.revoke(id)
    setTokens((prev) => prev.filter((t) => t.id !== id))
    if (justCreated?.token.id === id) setJustCreated(null)
  }

  async function handleSaveServerUrl(e: React.FormEvent) {
    e.preventDefault()
    await window.tandem.setServerUrl(serverUrlDraft.trim())
    setServerUrl(serverUrlDraft.trim())
  }

  function claudeCodeCmd(rawToken: string) {
    return `claude mcp add --transport http tandem ${serverUrl}/mcp --header "Authorization: Bearer ${rawToken}"`
  }

  function mcpConfig(rawToken: string) {
    return JSON.stringify({
      mcpServers: {
        tandem: {
          type: 'streamable-http',
          url: `${serverUrl}/mcp`,
          headers: { Authorization: `Bearer ${rawToken}` },
        },
      },
    }, null, 2)
  }

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="app-header">
        <button onClick={onClose} className="icon-button" aria-label="Back to sessions"><Icon name="back" /></button>
        <span className="font-semibold">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-10 max-w-2xl mx-auto w-full space-y-9">
        <div><h1 className="font-prose text-3xl">Make yourself at home.</h1><p className="mt-3 text-ui text-muted">Your account, connections, and workspace preferences.</p></div>
        {/* Account */}
        <section>
          <h3 className="text-sm font-semibold text-secondary mb-3">Account</h3>
          <div className="flex items-center justify-between rounded-xl border border-line bg-raised px-4 py-3">
            <div>
              <p className="text-sm font-medium">{user?.displayName}</p>
              <p className="text-xs text-muted capitalize">{user?.kind}</p>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg bg-selected px-3 py-1.5 text-xs hover:bg-hover"
            >
              Sign out
            </button>
          </div>
        </section>

        {/* Server URL */}
        <section>
          <h3 className="text-sm font-semibold text-secondary mb-3">Server URL</h3>
          <form onSubmit={handleSaveServerUrl} className="flex gap-2">
            <input
              aria-label="Server URL" type="url"
              value={serverUrlDraft}
              onChange={(e) => setServerUrlDraft(e.target.value)}
              className="field flex-1"
            />
            <button type="submit" className="button-primary px-3 py-2 text-xs">Save</button>
          </form>
        </section>

        {/* Agent tokens */}
        <section>
          <h3 className="text-sm font-semibold text-secondary mb-1">Connect an agent</h3>
          <p className="text-xs text-muted mb-3">
            Create an agent token, then give it to your MCP client (Bob, Claude Code, etc.).
            The label is the name teammates use to <span className="text-secondary">@mention</span> the agent.
          </p>

          {/* Just-created token */}
          {justCreated && (
            <div className="rounded-xl border border-line bg-raised p-4 mb-4 space-y-3">
              <p className="text-xs text-success font-medium">
                Token created — the raw token is shown only once. Copy what you need now.
              </p>

              {/* Claude Code command */}
              <div>
                <p className="text-xs text-secondary font-medium mb-1">Claude Code</p>
                <pre className="text-xs bg-sidebar rounded px-2 py-1.5 overflow-x-auto font-mono whitespace-pre-wrap break-all">{claudeCodeCmd(justCreated.rawToken)}</pre>
                <button
                  onClick={() => window.tandem.writeText(claudeCodeCmd(justCreated.rawToken))}
                  className="mt-1.5 text-xs rounded-lg bg-selected px-3 py-1.5 hover:bg-hover"
                >
                  Copy command
                </button>
              </div>

              {/* JSON MCP config */}
              <div>
                <p className="text-xs text-secondary font-medium mb-1">MCP config (JSON)</p>
                <pre className="text-xs bg-sidebar rounded px-2 py-1.5 overflow-x-auto font-mono">{mcpConfig(justCreated.rawToken)}</pre>
                <button
                  onClick={() => window.tandem.writeText(mcpConfig(justCreated.rawToken))}
                  className="mt-1.5 text-xs rounded-lg bg-selected px-3 py-1.5 hover:bg-hover"
                >
                  Copy config
                </button>
              </div>
            </div>
          )}

          {tokenError && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-danger/10 border border-danger/30 px-3 py-2">
              <p className="text-xs text-danger">{tokenError}</p>
              <button onClick={() => setTokenError(null)} className="ml-2 text-xs text-danger hover:text-primary">✕</button>
            </div>
          )}

          {/* Create token form */}
          <form onSubmit={handleCreateToken} className="flex gap-2 mb-4">
            <input
              type="text"
              aria-label="Agent label" placeholder="Label — used for @mentions"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="field flex-1"
            />
            <button
              type="submit"
              disabled={loading || !newLabel.trim()}
              className="button-primary px-3 py-2 text-xs"
            >
              Create
            </button>
          </form>

          {/* Token list */}
          {tokens.length === 0 ? (
            <p className="text-xs text-muted">No agent tokens yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-lg bg-raised px-3 py-2">
                  <div>
                    <p className="text-sm">{t.label}</p>
                    <p className="text-xs text-muted">
                      Created {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt && ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(t.id)}
                    className="text-xs text-danger hover:text-danger ml-4"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
