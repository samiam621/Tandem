import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import type { Session, Branch, Message, User, SessionAgent, ProjectDocMeta } from '@tandem/shared'
import { api } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'
import { useWebSocket } from '../../lib/useWebSocket'
import { MessageTreePanel } from './MessageTreePanel'
import { MentionMenu, buildMentionItems, highlightMentions } from './MentionMenu'
import { BriefPanel, type BriefState } from './BriefPanel'
import { ProjectDocs } from './ProjectDocs'

interface Props {
  session: Session
  onBack: () => void
  onSettings: () => void
}

export function SessionView({ session, onBack, onSettings }: Props) {
  const { user } = useAuth()
  const [serverUrl, setServerUrl] = useState('http://localhost:3000')
  const [token, setToken] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  // allMessages holds every branch's fetched messages for the tree visual
  const [allMessages, setAllMessages] = useState<Map<string, Message[]>>(new Map())
  const [members, setMembers] = useState<User[]>([])
  const [agents, setAgents] = useState<SessionAgent[]>([])
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [branchingFromMsg, setBranchingFromMsg] = useState<Message | null>(null)
  const [branchError, setBranchError] = useState<string | null>(null)
  const [branchModel, setBranchModel] = useState('')
  const [branchName, setBranchName] = useState('')
  // ── Share-to-main state ──────────────────────────────────────────────────────
  const [sharingBranchId, setSharingBranchId] = useState<string | null>(null)
  const [shareConfirm, setShareConfirm] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  // ── Project docs ─────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<ProjectDocMeta[]>([])
  // ── Branch dialog: selected doc ids to pin ────────────────────────────────────
  const [branchDocIds, setBranchDocIds] = useState<string[]>([])
  // ── Pinned-docs panel: open for which branch id ───────────────────────────────
  const [pinnedPanelBranchId, setPinnedPanelBranchId] = useState<string | null>(null)
  // ── Project brief ────────────────────────────────────────────────────────────
  const [brief, setBrief] = useState<BriefState>({
    brief: session.brief ?? '',
    briefUpdatedAt: session.briefUpdatedAt ?? null,
    briefUpdatedBy: session.briefUpdatedBy ?? null,
  })
  const [briefOpen, setBriefOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)

  // ── Mention menu state ───────────────────────────────────────────────────────
  const [mentionOpen, setMentionOpen] = useState(false)
  // caret position of the triggering "@" character
  const mentionAtPosRef = useRef<number>(-1)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  // ── Typing indicators ────────────────────────────────────────────────────────
  // Map from userId → { label: display label, isAgent: true when agentLabel was set, timerId }
  const [typingUsers, setTypingUsers] = useState<Map<string, { label: string; isAgent: boolean; timerId: ReturnType<typeof setTimeout> }>>(new Map())
  // Ref for outgoing throttle: timestamp of the last typing frame we sent
  const lastTypingSentRef = useRef<number>(0)

  useEffect(() => {
    window.tandem.getToken().then(setToken)
    window.tandem.getServerUrl().then(setServerUrl)
    api.models.list().then((ms) => {
      setModels(ms)
      if (ms.length) setBranchModel(ms[0].id)
    }).catch(() => {})
  }, [])

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null

  const handleWsEvent = useCallback((event: import('@tandem/shared').WsServerEvent) => {
    switch (event.type) {
      case 'presence_update':
        if (event.payload.sessionId === session.id) {
          setOnlineUsers(new Set(event.payload.onlineUsers.map((u) => u.id)))
        }
        break
      case 'message_created':
        if (event.payload.sessionId === session.id) {
          const incoming = event.payload
          // Keep allMessages in sync for the tree
          setAllMessages((prev) => {
            const existing = prev.get(incoming.branchId) ?? []
            if (existing.find((m) => m.id === incoming.id)) return prev
            const next = new Map(prev)
            next.set(incoming.branchId, [...existing, incoming])
            return next
          })
          if (incoming.branchId === activeBranchId) {
            setMessages((prev) => {
              if (prev.find((m) => m.id === incoming.id)) return prev
              return [...prev, incoming]
            })
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
          }
        }
        break
      case 'assistant_delta':
        if (event.payload.branchId === activeBranchId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === event.payload.messageId
                ? { ...m, content: m.content + event.payload.text, status: 'streaming' as const }
                : m,
            ),
          )
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
        break
      case 'assistant_done':
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.payload.messageId
              ? { ...m, content: event.payload.content, model: event.payload.model, status: 'done' as const }
              : m,
          ),
        )
        break
      case 'assistant_error':
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.payload.messageId
              ? { ...m, content: event.payload.error, status: 'error' as const }
              : m,
          ),
        )
        break
      case 'branch_created':
        if (event.payload.sessionId === session.id) {
          setBranches((prev) => prev.find((b) => b.id === event.payload.id) ? prev : [...prev, event.payload])
          // Pre-seed an empty entry so the tree node appears immediately
          setAllMessages((prev) => {
            if (prev.has(event.payload.id)) return prev
            const next = new Map(prev)
            next.set(event.payload.id, [])
            return next
          })
        }
        break
      case 'branch_updated':
        setBranches((prev) => prev.map((b) => b.id === event.payload.id ? event.payload : b))
        break
      case 'brief_updated':
        if (event.payload.sessionId === session.id) {
          const { brief, briefUpdatedAt, briefUpdatedBy } = event.payload
          setBrief({ brief, briefUpdatedAt, briefUpdatedBy })
        }
        break
      case 'doc_created':
        if (event.payload.sessionId === session.id) {
          setDocs((prev) => prev.find((d) => d.id === event.payload.id) ? prev : [...prev, event.payload])
        }
        break
      case 'doc_deleted':
        if (event.payload.sessionId === session.id) {
          setDocs((prev) => prev.filter((d) => d.id !== event.payload.docId))
        }
        break
      case 'typing':
        if (event.payload.branchId !== activeBranchId) break
        {
          const { userId, agentLabel } = event.payload
          // Skip our own typing, but still show our own agent (e.g. Claude) working.
          if (userId === user?.id && !agentLabel) break
          const key = agentLabel ? `${userId}:${agentLabel}` : userId
          setTypingUsers((prev) => {
            // Cancel existing expiry timer for this typer if any
            const existing = prev.get(key)
            if (existing) clearTimeout(existing.timerId)
            const member = members.find((m) => m.id === userId)
            const isAgent = agentLabel != null
            const label = agentLabel ?? member?.displayName ?? 'Someone'
            const timerId = setTimeout(() => {
              setTypingUsers((cur) => {
                const next = new Map(cur)
                next.delete(key)
                return next
              })
            }, 5000)
            const next = new Map(prev)
            next.set(key, { label, isAgent, timerId })
            return next
          })
        }
        break
    }
  }, [session.id, activeBranchId, user?.id, members])

  const { send: wsSend } = useWebSocket(serverUrl, token, session.id, handleWsEvent)

  // Fetch agents (and refetch on window focus)
  const fetchAgents = useCallback(() => {
    api.sessions.agents(session.id).then(setAgents).catch(() => {})
  }, [session.id])

  useEffect(() => {
    api.sessions.branches(session.id).then((data) => {
      setBranches(data)
      const main = data.find((b) => b.isMain)
      if (main) setActiveBranchId(main.id)
    })
    api.sessions.get(session.id).then((data) => {
      setMembers(data.members)
      const { brief, briefUpdatedAt, briefUpdatedBy } = data.session
      setBrief({ brief, briefUpdatedAt, briefUpdatedBy })
    })
    api.docs.list(session.id).then(setDocs).catch(() => {})
    fetchAgents()
  }, [session.id, fetchAgents])

  useEffect(() => {
    window.addEventListener('focus', fetchAgents)
    return () => window.removeEventListener('focus', fetchAgents)
  }, [fetchAgents])

  useEffect(() => {
    if (!activeBranchId) return
    api.messages.list(activeBranchId).then((data) => {
      setMessages(data)
      setAllMessages((prev) => {
        const next = new Map(prev)
        next.set(activeBranchId, data)
        return next
      })
      setTimeout(() => messagesEndRef.current?.scrollIntoView(), 50)
    })
  }, [activeBranchId])

  // Fetch messages for all branches so the tree can render fork points accurately.
  // We do this lazily on the first time branches are loaded; WS events keep them fresh.
  const fetchedBranchIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const b of branches) {
      if (b.id === activeBranchId) continue // already fetched above
      if (fetchedBranchIds.current.has(b.id)) continue
      fetchedBranchIds.current.add(b.id)
      api.messages.list(b.id).then((data) => {
        setAllMessages((prev) => {
          const next = new Map(prev)
          next.set(b.id, data)
          return next
        })
      }).catch(() => {})
    }
  }, [branches, activeBranchId])

  // Typing indicator text derived from current typingUsers map
  const typingText = useMemo(() => {
    const entries = [...typingUsers.values()]
    if (entries.length === 0) return null
    // Single typer: use "is working…" for agents, "is typing…" for humans
    if (entries.length === 1) {
      const { label, isAgent } = entries[0]
      return isAgent ? `${label} is working…` : `${label} is typing…`
    }
    const labels = entries.map((v) => v.label)
    if (labels.length === 2) return `${labels[0]} and ${labels[1]} are typing…`
    return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more are typing…`
  }, [typingUsers])

  // ── Mention helpers ──────────────────────────────────────────────────────────
  const mentionItems = useMemo(() => buildMentionItems(members, agents), [members, agents])

  // Set of lowercase labels for highlight matching
  const mentionLabelSet = useMemo(
    () => new Set(mentionItems.map((m) => m.label.toLowerCase())),
    [mentionItems],
  )

  function insertMention(label: string) {
    const atPos = mentionAtPosRef.current
    if (atPos < 0) return
    // Replace from "@" up to (but not including) whatever follows the current query
    const before = composerText.slice(0, atPos)
    const afterQuery = composerText.slice(atPos + 1 + mentionQuery.length)
    const next = `${before}@${label} ${afterQuery}`
    setComposerText(next)
    setMentionOpen(false)
    mentionAtPosRef.current = -1
    // Restore focus and move caret to just after the inserted mention
    const newCaret = atPos + label.length + 2 // "@" + label + " "
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(newCaret, newCaret)
      }
    })
  }

  // Outgoing typing frame — throttled to at most once every 3 s
  function handleComposerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setComposerText(value)

    // Mention trigger: find the "@" the caret is currently inside
    const caret = e.target.selectionStart ?? value.length
    // Walk back from caret to find an unbroken "@word" segment
    let atPos = -1
    for (let i = caret - 1; i >= 0; i--) {
      if (value[i] === '@') { atPos = i; break }
      if (value[i] === ' ') break
    }
    if (atPos >= 0) {
      const query = value.slice(atPos + 1, caret)
      mentionAtPosRef.current = atPos
      setMentionQuery(query)
      setMentionIndex(0)
      setMentionOpen(true)
    } else {
      setMentionOpen(false)
      mentionAtPosRef.current = -1
    }

    if (!activeBranchId) return
    const now = Date.now()
    if (now - lastTypingSentRef.current >= 3000) {
      lastTypingSentRef.current = now
      wsSend({ type: 'typing', payload: { sessionId: session.id, branchId: activeBranchId } })
    }
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!mentionOpen) return
    const filtered = mentionItems.filter((item) =>
      item.label.toLowerCase().startsWith(mentionQuery.toLowerCase()),
    )
    if (filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = filtered[mentionIndex]
      if (item) insertMention(item.label)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMentionOpen(false)
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!composerText.trim() || !activeBranchId || sending) return
    const text = composerText.trim()
    setComposerText('')
    setSendError(null)
    setSending(true)
    try {
      await api.messages.post(activeBranchId, text, true)
    } catch (err: any) {
      setComposerText(text)
      setSendError(err?.message ?? 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  async function handleBranch(e: React.FormEvent) {
    e.preventDefault()
    if (!branchingFromMsg) return
    setBranchError(null)
    try {
      const docIds = branchDocIds.length > 0 ? branchDocIds : undefined
      const branch = await api.branches.create(session.id, branchingFromMsg.id, branchModel, branchName || undefined, docIds)
      // The branch_created event usually arrives before this response, so it may already be listed
      setBranches((prev) => prev.find((b) => b.id === branch.id) ? prev : [...prev, branch])
      setActiveBranchId(branch.id)
      setBranchingFromMsg(null)
      setBranchName('')
      setBranchDocIds([])
    } catch (err: any) {
      setBranchError(err?.message ?? 'Failed to create branch')
    }
  }

  // Derive the set of branch IDs that already have a share card posted in any branch
  const sharedBranchIds = useMemo(() => {
    const ids = new Set<string>()
    for (const msgs of allMessages.values()) {
      for (const m of msgs) {
        if (m.sharedFromBranchId) ids.add(m.sharedFromBranchId)
      }
    }
    return ids
  }, [allMessages])

  const canPost = activeBranch
    ? activeBranch.isMain || activeBranch.ownerId === user?.id
    : false

  // "Share to main" — only shown for non-main branches owned by the current user
  const canShare = activeBranch
    ? !activeBranch.isMain && activeBranch.ownerId === user?.id
    : false

  async function handleShare() {
    if (!activeBranchId || sharingBranchId) return
    setSharingBranchId(activeBranchId)
    setShareConfirm(false)
    setShareError(null)
    try {
      await api.branches.share(activeBranchId)
      setShareConfirm(true)
      setTimeout(() => setShareConfirm(false), 4000)
    } catch (err: any) {
      setShareError(err?.message ?? 'Share failed')
      setTimeout(() => setShareError(null), 5000)
    } finally {
      setSharingBranchId(null)
    }
  }

  return (
    <div className="flex h-screen flex-col" data-testid="session-view">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-2.5 shrink-0">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-300">← Back</button>
        <span className="font-semibold truncate">{session.title}</span>
        <span className="ml-auto flex items-center gap-3">
          {canShare && (
            <span className="flex items-center gap-2">
              {shareError && <span className="text-xs text-red-400">{shareError}</span>}
              {shareConfirm && <span className="text-xs text-green-400">Shared ✓</span>}
              <button
                onClick={handleShare}
                disabled={sharingBranchId !== null}
                className="text-xs rounded-lg bg-gray-700 px-3 py-1 hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1.5"
              >
                {sharingBranchId ? (
                  <><span className="h-3 w-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />Sharing…</>
                ) : 'Share to main'}
              </button>
            </span>
          )}
          <span className="text-xs text-gray-500">
            {onlineUsers.size > 0 ? `${onlineUsers.size} online` : ''}
          </span>
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — members + branch list */}
        <div className="w-56 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
          {/* Invite link */}
          <div className="px-3 py-1.5 border-b border-gray-800 flex items-center justify-between">
            <span className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">Invite</span>
            <button
              onClick={() => window.tandem.writeText(`${serverUrl}/api/sessions/join/${session.inviteCode}`)}
              className="text-[10px] text-gray-400 hover:text-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-800"
            >
              Copy link
            </button>
          </div>

          {/* Project brief — the spec every branch's AI reads */}
          <button
            onClick={() => setBriefOpen(true)}
            className="mx-2 mt-2 rounded-lg border border-gray-800 px-2.5 py-2 text-left hover:bg-gray-800"
          >
            <div className="text-xs font-semibold text-gray-300">Project brief</div>
            <div className="text-[10px] text-gray-500 truncate">
              {brief.brief ? brief.brief.split('\n').find((l) => l.trim()) : 'Add specs every branch sees'}
            </div>
          </button>

          {/* Project docs */}
          <ProjectDocs
            sessionId={session.id}
            sessionOwnerId={session.ownerId}
            currentUserId={user?.id}
            docs={docs}
            members={members}
            onDocCreated={(doc) => setDocs((prev) => prev.find((d) => d.id === doc.id) ? prev : [...prev, doc])}
            onDocDeleted={(id) => setDocs((prev) => prev.filter((d) => d.id !== id))}
          />

          {/* Members — capped height so long lists don't push branches off screen */}
          <div className="px-3 py-2 border-b border-gray-800 max-h-36 overflow-y-auto">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Members</p>
            <ul className="space-y-0.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 text-xs py-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${onlineUsers.has(m.id) ? 'bg-green-400' : 'bg-gray-600'}`} />
                  <span className="truncate">{m.displayName}</span>
                  {m.kind === 'agent' && <span className="text-gray-500 text-[10px] shrink-0">agent</span>}
                </li>
              ))}
            </ul>
          </div>

          {/* Branches */}
          <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-1">Branches</p>
            <ul className="space-y-0.5">
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setActiveBranchId(b.id)}
                    className={`w-full text-left rounded-lg px-2 py-1.5 text-xs ${activeBranchId === b.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                  >
                    <div className="font-medium truncate">{b.name}</div>
                    <div className="text-gray-500 truncate">{b.model.split('/').pop()}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {b.ownerId === user?.id && !b.isMain && (
                        <span className="text-blue-400 text-[10px]">yours</span>
                      )}
                      {/* Pinned docs indicator / control */}
                      {!b.isMain && docs.length > 0 && (
                        b.ownerId === user?.id ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setPinnedPanelBranchId(b.id) }}
                            className="text-[10px] text-gray-500 hover:text-gray-300"
                          >
                            Pinned docs ({b.pinnedDocIds.length})
                          </button>
                        ) : b.pinnedDocIds.length > 0 ? (
                          <span className="text-[10px] text-gray-600">Pinned docs ({b.pinnedDocIds.length})</span>
                        ) : null
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Agents empty-state nudge */}
          {agents.length === 0 && (
            <div className="px-3 py-2 border-t border-gray-800 shrink-0">
              <p className="text-[10px] text-gray-600 leading-snug">
                No agents connected.{' '}
                {/* Clicking this opens Settings directly so the user can create an agent token */}
                <button
                  onClick={onSettings}
                  className="text-gray-500 underline hover:text-gray-300"
                >
                  Connect one in Settings →
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Center — message list + composer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-center text-sm text-gray-600 mt-8">
                {activeBranch ? 'No messages yet.' : 'Select a branch.'}
              </p>
            )}
            {messages.map((msg) => (
              <MessageRow
                key={msg.id}
                msg={msg}
                currentUserId={user?.id}
                members={members}
                branches={branches}
                mentionLabelSet={mentionLabelSet}
                onBranchFrom={() => setBranchingFromMsg(msg)}
                onOpenBranch={setActiveBranchId}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Branch-from dialog */}
          {branchingFromMsg && (
            <form onSubmit={handleBranch} className="border-t border-gray-800 px-4 py-3 space-y-2 bg-gray-900 shrink-0">
              <p className="text-xs text-gray-400 truncate">
                Branching from: <span className="text-white">{branchingFromMsg.content.slice(0, 60)}{branchingFromMsg.content.length > 60 ? '…' : ''}</span>
              </p>
              {branchError && (
                <p className="text-xs text-red-400 flex items-center justify-between">
                  <span>{branchError}</span>
                  <button type="button" onClick={() => setBranchError(null)} className="ml-2 text-red-300 hover:text-red-200">✕</button>
                </p>
              )}
              {/* Pin docs to this branch */}
              {docs.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">Pin docs to this branch</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {docs.map((doc) => (
                      <label key={doc.id} className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={branchDocIds.includes(doc.id)}
                          onChange={(e) => {
                            setBranchDocIds((prev) =>
                              e.target.checked ? [...prev, doc.id] : prev.filter((id) => id !== doc.id)
                            )
                          }}
                          className="accent-blue-500"
                        />
                        <span className="truncate max-w-[120px]">{doc.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Branch name (optional)"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg bg-gray-800 px-3 py-1.5 text-xs outline-none ring-1 ring-gray-600 focus:ring-blue-500"
                />
                <select
                  value={branchModel}
                  onChange={(e) => setBranchModel(e.target.value)}
                  className="rounded-lg bg-gray-800 px-2 py-1.5 text-xs outline-none ring-1 ring-gray-600"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button type="submit" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs hover:bg-blue-700">Branch</button>
                <button type="button" onClick={() => { setBranchingFromMsg(null); setBranchError(null); setBranchDocIds([]) }} className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600">Cancel</button>
              </div>
            </form>
          )}

          {/* Typing indicator */}
          {typingText && !branchingFromMsg && (
            <div className="px-4 pb-1 text-xs text-gray-500 italic shrink-0">{typingText}</div>
          )}

          {/* Send error */}
          {sendError && !branchingFromMsg && (
            <div className="px-4 pb-1 shrink-0 flex items-center justify-between">
              <p className="text-xs text-red-400">{sendError}</p>
              <button onClick={() => setSendError(null)} className="ml-2 text-xs text-red-300 hover:text-red-200">✕</button>
            </div>
          )}

          {/* Composer */}
          {!branchingFromMsg && (
            <form onSubmit={handleSend} className="relative border-t border-gray-800 px-4 py-3 flex gap-2 shrink-0">
              {/* Mention menu — anchored above the input */}
              {mentionOpen && canPost && (
                <MentionMenu
                  items={mentionItems}
                  query={mentionQuery}
                  activeIndex={mentionIndex}
                  onSelect={insertMention}
                  onActiveIndexChange={setMentionIndex}
                  onClose={() => setMentionOpen(false)}
                />
              )}
              {canPost ? (
                <>
                  <input
                    ref={composerRef}
                    type="text"
                    value={composerText}
                    onChange={handleComposerChange}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Message… (type @ to mention)"
                    disabled={sending}
                    className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-sm outline-none ring-1 ring-gray-700 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={sending || !composerText.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-3 py-1">
                  <p className="text-sm text-gray-500">Read-only branch.</p>
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBranchingFromMsg(messages[messages.length - 1])}
                      className="text-xs rounded-lg bg-gray-700 px-3 py-1.5 hover:bg-gray-600"
                    >
                      Branch from latest
                    </button>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Right — message tree visual */}
        <div className="w-44 shrink-0 border-l border-gray-800 overflow-hidden flex flex-col">
          <MessageTreePanel
            branches={branches}
            allMessages={allMessages}
            activeBranchId={activeBranchId}
            sharedBranchIds={sharedBranchIds}
            onSelectBranch={setActiveBranchId}
          />
        </div>
      </div>

      {briefOpen && (
        <BriefPanel
          sessionId={session.id}
          current={brief}
          members={members}
          onChange={setBrief}
          onClose={() => setBriefOpen(false)}
        />
      )}

      {/* Pinned-docs panel — lets a branch owner change which docs are pinned */}
      {pinnedPanelBranchId && (() => {
        const pb = branches.find((b) => b.id === pinnedPanelBranchId)
        if (!pb) return null
        return (
          <PinnedDocsPanel
            branch={pb}
            docs={docs}
            onClose={() => setPinnedPanelBranchId(null)}
            onBranchUpdated={(updated) => setBranches((prev) => prev.map((b) => b.id === updated.id ? updated : b))}
          />
        )
      })()}
    </div>
  )
}


// ─── PinnedDocsPanel ──────────────────────────────────────────────────────────
// Controlled checklist that saves each toggle immediately. Disables all inputs
// while a PATCH is in flight so rapid clicks don't cause races.

function PinnedDocsPanel({
  branch, docs, onClose, onBranchUpdated,
}: {
  branch: Branch
  docs: import('@tandem/shared').ProjectDocMeta[]
  onClose: () => void
  onBranchUpdated: (b: Branch) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(docId: string, checked: boolean) {
    const next = checked
      ? [...branch.pinnedDocIds, docId]
      : branch.pinnedDocIds.filter((id) => id !== docId)
    setSaving(true)
    setError(null)
    try {
      const updated = await api.branches.update(branch.id, { pinnedDocIds: next })
      onBranchUpdated(updated)
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Pinned docs — {branch.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-sm px-2">✕</button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {docs.length === 0 ? (
            <p className="text-xs text-gray-500">No docs in this session yet.</p>
          ) : (
            docs.map((doc) => (
              <label key={doc.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={branch.pinnedDocIds.includes(doc.id)}
                  disabled={saving}
                  className="accent-blue-500 disabled:opacity-50"
                  onChange={(e) => toggle(doc.id, e.target.checked)}
                />
                <span className="truncate">{doc.title}</span>
                <span className="text-gray-600 shrink-0">{doc.chars.toLocaleString()} chars</span>
              </label>
            ))
          )}
          {saving && <p className="text-[10px] text-gray-500">Saving…</p>}
        </div>
      </div>
    </div>
  )
}


function MessageRow({
  msg, currentUserId, members, branches, mentionLabelSet, onBranchFrom, onOpenBranch,
}: {
  msg: Message
  currentUserId?: string
  branches: Branch[]
  members: User[]
  mentionLabelSet: Set<string>
  onBranchFrom: () => void
  onOpenBranch: (branchId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const author = members.find((m) => m.id === msg.authorId)
  const isAssistant = msg.authorType === 'assistant'
  const isAgent = msg.authorType === 'agent'
  // An agent posts as its token's owner, but its messages are not "mine".
  const isMe = msg.authorId === currentUserId && !isAgent

  // ── Summary card for shared-branch messages ──────────────────────────────────
  if (msg.sharedFromBranchId) {
    const sourceBranch = branches.find((b) => b.id === msg.sharedFromBranchId)
    return (
      <div className="rounded-xl border border-blue-900/60 bg-blue-950/30 px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-blue-400 font-medium">
          <span>↗</span>
          <span>Summary from branch: {sourceBranch?.name ?? msg.sharedFromBranchId}</span>
        </div>
        <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
          {highlightMentions(msg.content, mentionLabelSet)}
        </p>
        {sourceBranch && (
          <button
            onClick={() => onOpenBranch(sourceBranch.id)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Open branch →
          </button>
        )}
      </div>
    )
  }

  // Avatar circle style
  const avatarClass = isAssistant
    ? 'bg-purple-700'
    : isAgent
    ? 'bg-teal-800'
    : 'bg-gray-700'

  // Avatar label
  const avatarContent = isAssistant
    ? 'AI'
    : isAgent
    ? '⚙'
    : (author?.displayName[0] ?? '?').toUpperCase()

  // Author line text
  let authorLabel: React.ReactNode
  if (isAssistant) {
    authorLabel = msg.model?.split('/').pop() ?? 'AI'
  } else if (isAgent) {
    const label = msg.agentLabel?.trim()
    if (label) {
      const ownerName = author?.displayName
      authorLabel = (
        <>
          <span className="text-teal-400">{label}</span>
          {ownerName && (
            <span className="text-gray-600"> · via {ownerName}</span>
          )}
        </>
      )
    } else {
      // No agentLabel — fall back to old badge
      authorLabel = (
        <>
          {author?.displayName ?? 'Unknown'}
          <span className="text-[10px] text-gray-600 ml-1">agent</span>
        </>
      )
    }
  } else {
    authorLabel = author?.displayName ?? 'Unknown'
  }

  // Bubble style
  let bubbleClass: string
  if (isAgent) {
    bubbleClass = 'bg-gray-800 text-gray-100 border-l-2 border-teal-500 rounded-2xl'
  } else if (isAssistant) {
    bubbleClass = 'bg-gray-800 text-gray-100 rounded-2xl'
  } else if (isMe) {
    bubbleClass = 'bg-blue-600 text-white rounded-2xl'
  } else {
    bubbleClass = 'bg-gray-800 text-gray-100 rounded-2xl'
  }

  return (
    <div
      className={`group flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${avatarClass}`}>
        {avatarContent}
      </div>
      <div className={`max-w-[70%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-500">{authorLabel}</span>
          {hovered && msg.status === 'done' && (
            <button
              onClick={onBranchFrom}
              className="text-[10px] text-blue-400 hover:text-blue-300 ml-1"
            >
              Branch from here
            </button>
          )}
        </div>
        <div className={`px-3 py-2 text-sm whitespace-pre-wrap break-words ${bubbleClass}${
          msg.status === 'error' ? ' !bg-red-900/40 text-red-300' : ''
        }`}>
          {msg.content
            ? highlightMentions(msg.content, mentionLabelSet)
            : (msg.status === 'pending' ? '…' : '')}
          {msg.status === 'streaming' && <span className="ml-1 animate-pulse">▋</span>}
        </div>
      </div>
    </div>
  )
}
