import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import type { Session, Branch, Message, User, SessionAgent, SessionDocument } from '@tandem/shared'
import { api } from '../../lib/api'
import { useAuth } from '../../app/AuthContext'
import { useWebSocket } from '../../lib/useWebSocket'
import { MessageTreePanel } from './MessageTreePanel'
import { MentionMenu, buildMentionItems, highlightMentions } from './MentionMenu'
import { BriefPanel, type BriefState } from './BriefPanel'
import { DocumentPanel } from './DocumentPanel'
import { Icon, TandemMark } from '../../components/Icon'

// openDocId while the document panel is open on a new, unsaved document.
const CREATING_DOCUMENT = 'new'

interface Props {
  session: Session
  onBack: () => void
}

export function SessionView({ session, onBack }: Props) {
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
  // ── Project brief ────────────────────────────────────────────────────────────
  const [brief, setBrief] = useState<BriefState>({
    brief: session.brief ?? '',
    briefUpdatedAt: session.briefUpdatedAt ?? null,
    briefUpdatedBy: session.briefUpdatedBy ?? null,
  })
  const [briefOpen, setBriefOpen] = useState(false)
  // ── Documents (specs in main; each branch reads its selection) ──────────────
  const [documents, setDocuments] = useState<SessionDocument[]>([])
  const [openDocId, setOpenDocId] = useState<string | null>(null) // a document id, or CREATING_DOCUMENT
  const [docsError, setDocsError] = useState<string | null>(null)
  const [branchDocIds, setBranchDocIds] = useState<string[]>([]) // selection in the branch dialog
  const uploadRef = useRef<HTMLInputElement>(null)
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
          // A teammate who joined after we loaded the session first shows up here; refetch members.
          if (event.payload.onlineUsers.some((u) => !members.some((m) => m.id === u.id))) {
            api.sessions.get(session.id).then((data) => setMembers(data.members)).catch(() => {})
          }
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
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 50)
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
          messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
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
          // Our own new branch also arrives in the REST response; keep one copy.
          setBranches((prev) => (prev.some((b) => b.id === event.payload.id) ? prev : [...prev, event.payload]))
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
      case 'document_updated':
        if (event.payload.sessionId === session.id) {
          const doc = event.payload
          setDocuments((prev) => upsertDocument(prev, doc))
        }
        break
      case 'document_deleted':
        if (event.payload.sessionId === session.id) {
          const { documentId } = event.payload
          setDocuments((prev) => prev.filter((d) => d.id !== documentId))
          setOpenDocId((cur) => (cur === documentId ? null : cur))
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
    api.documents.list(session.id).then(setDocuments).catch(() => {})
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
      const branch = await api.branches.create(session.id, branchingFromMsg.id, branchModel, branchName || undefined, branchDocIds)
      setBranches((prev) => (prev.some((b) => b.id === branch.id) ? prev : [...prev, branch]))
      setActiveBranchId(branch.id)
      setBranchingFromMsg(null)
      setBranchName('')
    } catch (err: any) {
      setBranchError(err?.message ?? 'Failed to create branch')
    }
  }

  // The documents a branch's AI reads: all of them in main (or a branch from before documents existed).
  const readsDocument = (b: Branch | null, docId: string) => !b || b.isMain || b.documentIds === null || b.documentIds.includes(docId)

  // A new branch starts with what its parent branch (the one holding the fork message) reads.
  useEffect(() => {
    if (!branchingFromMsg) return
    const parent = branches.find((b) => b.id === branchingFromMsg.branchId) ?? null
    setBranchDocIds(documents.filter((d) => readsDocument(parent, d.id)).map((d) => d.id))
    // Only when the dialog opens; later document changes should not reset the user's ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchingFromMsg])

  async function toggleBranchDocument(docId: string) {
    if (!activeBranch || activeBranch.isMain || activeBranch.ownerId !== user?.id) return
    const current = documents.filter((d) => readsDocument(activeBranch, d.id)).map((d) => d.id)
    const next = current.includes(docId) ? current.filter((id) => id !== docId) : [...current, docId]
    setDocsError(null)
    try {
      const updated = await api.branches.setDocuments(activeBranch.id, next)
      setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
    } catch (err: any) {
      setDocsError(err?.message ?? 'Failed to update this branch’s documents')
    }
  }

  // Each file becomes a document named after it; a file with an existing document's name replaces it.
  async function handleUpload(files: FileList | null) {
    if (!files?.length) return
    setDocsError(null)
    for (const file of Array.from(files)) {
      try {
        const existing = documents.find((d) => d.name === file.name)
        const doc = await api.documents.save(session.id, file.name, await file.text(), existing?.updatedAt ?? null)
        setDocuments((prev) => upsertDocument(prev, doc))
      } catch (err: any) {
        setDocsError(`${file.name}: ${err?.message ?? 'upload failed'}`)
      }
    }
    if (uploadRef.current) uploadRef.current.value = ''
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
      <div className="app-header">
        <button onClick={onBack} className="icon-button" aria-label="Back to sessions" title="Back to sessions"><Icon name="back" /></button>
        <span className="font-medium truncate">{session.title}</span>
        <span className="text-muted">/</span>
        <span className="truncate text-secondary">{activeBranch?.name ?? 'Loading…'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {canShare && (
            <span className="flex items-center gap-2">
              {shareError && <span className="text-xs text-danger">{shareError}</span>}
              {shareConfirm && <span className="text-xs text-success">Shared ✓</span>}
              <button
                onClick={handleShare}
                disabled={sharingBranchId !== null}
                className="text-xs rounded-lg bg-selected px-3 py-1 hover:bg-hover disabled:opacity-50 flex items-center gap-1.5"
              >
                {sharingBranchId ? (
                  <><span className="h-3 w-3 rounded-full border-2 border-secondary border-t-transparent animate-spin" />Sharing…</>
                ) : 'Share to main'}
              </button>
            </span>
          )}
          <span className="text-xs text-muted">
            {onlineUsers.size > 0 ? `${onlineUsers.size} online` : ''}
          </span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left sidebar — members + branch list */}
        <div className="w-56 shrink-0 border-r border-line bg-sidebar flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-4 font-medium"><TandemMark className="h-6 w-6" />Tandem<span className="ml-auto text-xs font-normal text-muted">Workspace</span></div>
          {/* Invite link */}
          <div className="px-3 py-1.5 border-b border-line flex items-center justify-between">
            <span className="text-xs text-muted  font-semibold">Invite</span>
            <button
              onClick={() => window.tandem.writeText(`tandem://join/${session.inviteCode}`)}
              className="text-xs text-secondary hover:text-primary rounded px-1.5 py-0.5 hover:bg-hover"
            >
              Copy link
            </button>
          </div>

          {/* Brief — the summary of main every branch's AI reads */}
          <button
            onClick={() => setBriefOpen(true)}
            className="mx-2 mt-2 rounded-lg px-2.5 py-2 text-left hover:bg-hover"
          >
            <div className="flex items-center gap-2 text-ui font-medium text-primary"><Icon name="document" />Brief</div>
            <div className="text-xs text-muted truncate">
              {brief.brief ? brief.brief.split('\n').find((l) => l.trim()) : 'Summary of main every branch reads'}
            </div>
          </button>

          {/* Documents — specs in main; a branch's AI reads the ticked ones */}
          <div className="px-3 py-2 border-b border-line max-h-44 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-muted ">Documents</p>
              <span className="flex gap-1">
                <button onClick={() => setOpenDocId(CREATING_DOCUMENT)} className="text-xs text-secondary hover:text-primary rounded px-1 hover:bg-hover">New</button>
                <button onClick={() => uploadRef.current?.click()} className="text-xs text-secondary hover:text-primary rounded px-1 hover:bg-hover">Upload</button>
                <input
                  ref={uploadRef}
                  type="file"
                  multiple
                  accept=".md,.markdown,.txt,.json,.yaml,.yml"
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files)}
                />
              </span>
            </div>
            {documents.length === 0 ? (
              <p className="text-xs text-muted leading-snug">Add specs like ARCHITECTURE.md or TODO.md. Branches choose which ones their AI reads.</p>
            ) : (
              <>
                {activeBranch && !activeBranch.isMain && (
                  <p className="text-xs text-muted mb-0.5">Ticked: read in {activeBranch.name}</p>
                )}
                <ul className="space-y-0.5">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center gap-1.5 text-xs">
                      {activeBranch && !activeBranch.isMain && (
                        <input
                          type="checkbox"
                          checked={readsDocument(activeBranch, d.id)}
                          disabled={activeBranch.ownerId !== user?.id}
                          onChange={() => toggleBranchDocument(d.id)}
                          title={activeBranch.ownerId === user?.id ? 'Include in this branch’s AI context' : 'Only the branch owner can change this'}
                          className="shrink-0 accent-accent"
                        />
                      )}
                      <button onClick={() => setOpenDocId(d.id)} className="flex min-w-0 items-center gap-2 py-1 text-left text-secondary hover:text-primary">
                        <Icon name="document" className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{d.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {docsError && <p className="mt-1 text-xs text-danger break-words">{docsError}</p>}
          </div>

          {/* Members — capped height so long lists don't push branches off screen */}
          <div className="px-3 py-2 border-b border-line max-h-36 overflow-y-auto">
            <p className="text-xs font-medium text-muted mb-1">Members</p>
            <ul className="space-y-0.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 text-xs py-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${onlineUsers.has(m.id) ? 'bg-success' : 'bg-hover'}`} />
                  <span className="truncate">{m.displayName}</span>
                  {m.kind === 'agent' && <span className="text-muted text-xs shrink-0">agent</span>}
                </li>
              ))}
            </ul>
          </div>

          {/* Branches */}
          <div className="flex-1 overflow-y-auto px-2 py-2 min-h-0">
            <p className="text-xs font-medium text-muted mb-1 px-1">Branches</p>
            <ul className="space-y-0.5">
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setActiveBranchId(b.id)}
                    aria-current={activeBranchId === b.id ? 'page' : undefined}
                    className={`w-full text-left rounded-lg px-2.5 py-2 text-ui ${activeBranchId === b.id ? 'bg-selected text-primary' : 'text-secondary hover:bg-hover'}`}
                  >
                    <div className="flex items-center gap-2 font-medium"><Icon name={b.isMain ? 'chat' : 'branch'} className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{b.name}</span></div>
                    <div className="pl-6 text-xs text-muted truncate">{b.model.split('/').pop()}</div>
                    {b.ownerId === user?.id && !b.isMain && (
                      <span className="text-accent text-xs">yours</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Agents empty-state nudge */}
          {agents.length === 0 && (
            <div className="px-3 py-2 border-t border-line shrink-0">
              <p className="text-xs text-muted leading-snug">
                No agents connected.{' '}
                <button
                  onClick={onBack}
                  className="text-muted underline hover:text-secondary"
                  title="Go back to Home then open Settings"
                >
                  Connect one in Settings →
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Center — message list + composer */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto"
            aria-label="Conversation">
            <div className="reading-column space-y-8 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center py-16 text-center">
                <TandemMark className="mb-5 h-10 w-10 text-secondary" />
                <h2 className="font-prose text-2xl">{activeBranch ? 'A shared space to think.' : 'Choose a branch.'}</h2>
                <p className="mt-3 max-w-sm text-ui text-muted">{activeBranch ? 'Start a conversation with your team. Branch off when an idea needs room of its own.' : 'Your conversation will appear here.'}</p>
              </div>
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
          </div>

          {/* Branch-from dialog */}
          {branchingFromMsg && (
            <form onSubmit={handleBranch} className="reading-column shrink-0 border-t border-line py-4 space-y-3">
              <p className="text-xs text-secondary truncate">
                Branching from: <span className="text-primary">{branchingFromMsg.content.slice(0, 60)}{branchingFromMsg.content.length > 60 ? '…' : ''}</span>
              </p>
              {branchError && (
                <p className="text-xs text-danger flex items-center justify-between">
                  <span>{branchError}</span>
                  <button type="button" onClick={() => setBranchError(null)} className="ml-2 text-danger hover:text-primary">✕</button>
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Branch name (optional)"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="flex-1 min-w-0 rounded-lg bg-raised px-3 py-1.5 text-xs outline-none ring-1 ring-control focus:ring-accent"
                />
                <select
                  value={branchModel}
                  onChange={(e) => setBranchModel(e.target.value)}
                  aria-label="Branch model" className="min-w-0 max-w-full flex-1 rounded-lg bg-raised px-2 py-1.5 text-xs outline-none ring-1 ring-control"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button type="submit" className="button-primary px-3 py-1.5 text-xs">Branch</button>
                <button type="button" onClick={() => { setBranchingFromMsg(null); setBranchError(null) }} className="rounded-lg bg-selected px-3 py-1.5 text-xs hover:bg-hover">Cancel</button>
              </div>
              {documents.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
                  <span className="text-muted">This branch's AI reads:</span>
                  {documents.map((d) => (
                    <label key={d.id} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={branchDocIds.includes(d.id)}
                        onChange={() => setBranchDocIds((prev) => (prev.includes(d.id) ? prev.filter((id) => id !== d.id) : [...prev, d.id]))}
                        className="accent-accent"
                      />
                      {d.name}
                    </label>
                  ))}
                </div>
              )}
            </form>
          )}

          {/* Typing indicator */}
          {typingText && !branchingFromMsg && (
            <div className="reading-column pb-2 text-xs text-muted shrink-0" role="status">{typingText}</div>
          )}

          {/* Send error */}
          {sendError && !branchingFromMsg && (
            <div className="reading-column pb-2 shrink-0 flex items-center justify-between" role="alert">
              <p className="text-xs text-danger">{sendError}</p>
              <button onClick={() => setSendError(null)} className="ml-2 text-xs text-danger hover:text-primary">✕</button>
            </div>
          )}

          {/* Composer */}
          {!branchingFromMsg && (
            <div className="reading-column shrink-0 pb-5 pt-2">
            <form onSubmit={handleSend} className="composer">
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
                    aria-label="Message"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={mentionOpen && mentionItems.some((item) => item.label.toLowerCase().startsWith(mentionQuery.toLowerCase()))}
                    aria-controls={mentionOpen ? 'mention-list' : undefined}
                    aria-activedescendant={mentionOpen && mentionItems.some((item) => item.label.toLowerCase().startsWith(mentionQuery.toLowerCase())) ? `mention-${mentionIndex}` : undefined}
                    placeholder="Message your team…"
                    disabled={sending}
                    className="min-w-0 flex-1 bg-transparent px-1 py-2 text-message outline-none focus-visible:outline-none disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={sending || !composerText.trim()}
                    className="button-primary h-9 w-9 shrink-0 p-0"
                    aria-label="Send message" title="Send message"
                  >
                    <Icon name="send" />
                  </button>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3 py-1">
                  <p className="text-sm text-muted">Read-only branch.</p>
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBranchingFromMsg(messages[messages.length - 1])}
                      className="text-xs rounded-lg bg-selected px-3 py-1.5 hover:bg-hover"
                    >
                      Branch from latest
                    </button>
                  )}
                </div>
              )}
            </form>
            {canPost && <div className="mt-2 flex items-center justify-between text-xs text-muted"><span>@ to mention a teammate</span><span>Enter to send</span></div>}
            </div>
          )}
        </div>

        {/* Right — message tree visual */}
        <div className="w-44 shrink-0 border-l border-line bg-sidebar overflow-hidden flex flex-col">
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

      {openDocId && (
        <DocumentPanel
          key={openDocId}
          sessionId={session.id}
          doc={documents.find((d) => d.id === openDocId) ?? null}
          members={members}
          onSaved={(doc) => {
            setDocuments((prev) => upsertDocument(prev, doc))
            setOpenDocId(doc.id)
          }}
          onDeleted={(id) => {
            setDocuments((prev) => prev.filter((d) => d.id !== id))
            setOpenDocId(null)
          }}
          onClose={() => setOpenDocId(null)}
        />
      )}
    </div>
  )
}

function upsertDocument(docs: SessionDocument[], doc: SessionDocument): SessionDocument[] {
  const rest = docs.filter((d) => d.id !== doc.id)
  return [...rest, doc].sort((a, b) => (a.name < b.name ? -1 : 1)) // same order as the server (by name)
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
  const author = members.find((m) => m.id === msg.authorId)
  const isAssistant = msg.authorType === 'assistant'
  const isAgent = msg.authorType === 'agent'
  const isProse = isAssistant || isAgent
  const isMe = msg.authorId === currentUserId && !isProse
  const authorName = isAssistant
    ? msg.model?.split('/').pop() ?? 'AI'
    : isAgent ? msg.agentLabel?.trim() || author?.displayName || 'Agent'
    : author?.displayName ?? 'Unknown'

  if (msg.sharedFromBranchId) {
    const sourceBranch = branches.find((b) => b.id === msg.sharedFromBranchId)
    return (
      <article className="rounded-xl border border-line bg-raised p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-secondary">
          <Icon name="branch" />
          <span className="min-w-0 break-words">Summary from {sourceBranch?.name ?? 'a branch'}</span>
        </div>
        <p className="message-prose whitespace-pre-wrap">{highlightMentions(msg.content, mentionLabelSet)}</p>
        {sourceBranch && <button onClick={() => onOpenBranch(sourceBranch.id)} className="inline-flex items-center gap-2 text-xs text-accent hover:text-primary">Open branch <span aria-hidden="true">→</span></button>}
      </article>
    )
  }

  return (
    <article className={`group flex flex-col gap-2 ${isMe ? 'items-end' : 'items-start'}`}>
      <div className="flex max-w-full flex-wrap items-center gap-2 text-xs text-muted">
        {isProse && <Icon name="sparkle" className="h-3.5 w-3.5" />}
        <span className="break-all font-medium text-secondary">{authorName}</span>
        {isAgent && <span>agent{author ? ` · via ${author.displayName}` : ''}</span>}
        {isAssistant && <span>AI</span>}
        {msg.status === 'done' && (
          <button onClick={onBranchFrom} className="branch-action"><Icon name="branch" className="h-3 w-3" />Branch from here</button>
        )}
      </div>
      <div className={`max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] ${isProse ? 'message-prose w-full' : 'text-message'} ${isMe ? 'rounded-xl bg-raised px-4 py-3' : ''} ${msg.status === 'error' ? 'rounded-lg bg-danger/10 p-3 text-danger' : ''}`}>
        {msg.content ? highlightMentions(msg.content, mentionLabelSet) : msg.status === 'pending' ? <span className="font-sans text-ui text-muted" role="status">Thinking…</span> : ''}
        {msg.status === 'streaming' && <span className="ml-1 animate-pulse text-secondary" aria-label="Streaming">▍</span>}
      </div>
    </article>
  )
}
