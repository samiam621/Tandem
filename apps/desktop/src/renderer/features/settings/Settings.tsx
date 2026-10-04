import React, { useEffect, useState } from 'react'
import type { ApiToken } from '@tandem/shared'
import { api } from '../../lib/api'
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
    try {
      const result = await api.tokens.create(newLabel.trim())
      setTokens((prev) => [...prev, result.token])
      setJustCreated(result)
      setNewLabel('')
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
    <div className="flex h-screen flex-col bg-gray-950">
      <div className="flex items-center gap-3 border-b border-gray-800 px-6 py-3">
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-300">← Back</button>
        <span className="font-semibold">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-lg mx-auto w-full space-y-8">
        {/* Account */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Account</h3>
          <div className="flex items-center justify-between rounded-xl bg-gray-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium">{user?.displayName}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.kind}</p>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600"
            >
              Sign out
            </button>
          </div>
        </section>

        {/* Server URL */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Server URL</h3>
          <form onSubmit={handleSaveServerUrl} className="flex gap-2">
            <input
              type="url"
              value={serverUrlDraft}
              onChange={(e) => setServerUrlDraft(e.target.value)}
              className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none ring-1 ring-gray-600 focus:ring-blue-500"
            />
            <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-xs hover:bg-blue-700">Save</button>
          </form>
        </section>

        {/* Agent tokens */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Connect an agent</h3>
          <p className="text-xs text-gray-500 mb-3">
            Create an agent token, then give it to your MCP client (Bob, Claude Code, etc.).
            The label is the name teammates use to <span className="text-gray-300">@mention</span> the agent.
          </p>

          {/* Just-created token */}
          {justCreated && (
            <div className="rounded-xl bg-gray-800 p-4 mb-4 space-y-3">
              <p className="text-xs text-green-400 font-medium">
                Token created — the raw token is shown only once. Copy what you need now.
              </p>

              {/* Claude Code command */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-1">Claude Code</p>
                <pre className="text-xs bg-gray-900 rounded px-2 py-1.5 overflow-x-auto font-mono whitespace-pre-wrap break-all">{claudeCodeCmd(justCreated.rawToken)}</pre>
                <button
                  onClick={() => window.tandem.writeText(claudeCodeCmd(justCreated.rawToken))}
                  className="mt-1.5 text-xs rounded-lg bg-gray-700 px-3 py-1.5 hover:bg-gray-600"
                >
                  Copy command
                </button>
              </div>

              {/* JSON MCP config */}
              <div>
                <p className="text-xs text-gray-400 font-medium mb-1">MCP config (JSON)</p>
                <pre className="text-xs bg-gray-900 rounded px-2 py-1.5 overflow-x-auto font-mono">{mcpConfig(justCreated.rawToken)}</pre>
                <button
                  onClick={() => window.tandem.writeText(mcpConfig(justCreated.rawToken))}
                  className="mt-1.5 text-xs rounded-lg bg-gray-700 px-3 py-1.5 hover:bg-gray-600"
                >
                  Copy config
                </button>
              </div>
            </div>
          )}

          {/* Create token form */}
          <form onSubmit={handleCreateToken} className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Label — used for @mentions"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none ring-1 ring-gray-600 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={loading || !newLabel.trim()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs hover:bg-blue-700 disabled:opacity-50"
            >
              Create
            </button>
          </form>

          {/* Token list */}
          {tokens.length === 0 ? (
            <p className="text-xs text-gray-600">No agent tokens yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
                  <div>
                    <p className="text-sm">{t.label}</p>
                    <p className="text-xs text-gray-500">
                      Created {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt && ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(t.id)}
                    className="text-xs text-red-400 hover:text-red-300 ml-4"
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
