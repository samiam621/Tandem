import React, { useEffect, useState, useRef, useCallback } from 'react'
import type { Session, Branch, Message, User } from '@tandem/shared'
import { api } from './api'
import { useAuth } from './AuthContext'
import { useWebSocket } from './useWebSocket'

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
  const [members, setMembers] = useState<User[]>([])
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set())
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [branchingFromMsg, setBranchingFromMsg] = useState<Message | null>(null)
  const [branchModel, setBranchModel] = useState('')
  const [branchName, setBranchName] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
        if (event.payload.sessionId === session.id && event.payload.branchId === activeBranchId) {
          setMessages((prev) => {
            if (prev.find((m) => m.id === event.payload.id)) return prev
            return [...prev, event.payload]
          })
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
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
          setBranches((prev) => [...prev, event.payload])
        }
        break
      case 'branch_updated':
        setBranches((prev) => prev.map((b) => b.id === event.payload.id ? event.payload : b))
        break
    }
  }, [session.id, activeBranchId])

  useWebSocket(serverUrl, token, session.id, handleWsEvent)

  useEffect(() => {
    api.sessions.branches(session.id).then((data) => {
      setBranches(data)
      const main = data.find((b) => b.isMain)
      if (main) setActiveBranchId(main.id)
    })
    api.sessions.get(session.id).then((data) => setMembers(data.members))
  }, [session.id])

  useEffect(() => {
    if (!activeBranchId) return
    api.messages.list(activeBranchId).then((data) => {
      setMessages(data)
      setTimeout(() => messagesEndRef.current?.scrollIntoView(), 50)
    })
  }, [activeBranchId])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!composerText.trim() || !activeBranchId || sending) return
    const text = composerText.trim()
    setComposerText('')
    setSending(true)
    try {
      await api.messages.post(activeBranchId, text, true)
    } catch (err: any) {
      setComposerText(text)
    } finally {
      setSending(false)
    }
  }

  async function handleBranch(e: React.FormEvent) {
    e.preventDefault()
    if (!branchingFromMsg) return
    try {
      const branch = await api.branches.create(session.id, branchingFromMsg.id, branchModel, branchName || undefined)
      setBranches((prev) => [...prev, branch])
      setActiveBranchId(branch.id)
      setBranchingFromMsg(null)
      setBranchName('')
    } catch (err: any) {
      console.error('Branch creation failed', err)
    }
  }

  const canPost = activeBranch
    ? activeBranch.isMain || activeBranch.ownerId === user?.id
    : false

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-2.5 shrink-0">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-300">← Back</button>
        <span className="font-semibold">{session.title}</span>
        <span className="ml-auto text-xs text-gray-500">
          {onlineUsers.size > 0 ? `${onlineUsers.size} online` : ''}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-56 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Members</p>
            <ul className="space-y-0.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 text-xs py-0.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${onlineUsers.has(m.id) ? 'bg-green-400' : 'bg-gray-600'}`} />
                  <span className="truncate">{m.displayName}</span>
                  {m.kind === 'agent' && <span className="text-gray-500 text-[10px]">agent</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-1">Branches</p>
            <ul className="space-y-0.5">
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setActiveBranchId(b.id)}
                    className={`w-full text-left rounded-lg px-2 py-1.5 text-xs ${activeBranchId === b.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'}`}
                  >
                    <div className="font-medium">{b.name}</div>
                    <div className="text-gray-500 truncate">{b.model.split('/').pop()}</div>
                    {b.ownerId === user?.id && !b.isMain && (
                      <span className="text-blue-400 text-[10px]">yours</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Center */}
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
                onBranchFrom={() => setBranchingFromMsg(msg)}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Branch-from dialog */}
          {branchingFromMsg && (
            <form onSubmit={handleBranch} className="border-t border-gray-800 px-4 py-3 space-y-2 bg-gray-900 shrink-0">
              <p className="text-xs text-gray-400">
                Branching from: <span className="text-white">{branchingFromMsg.content.slice(0, 60)}…</span>
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Branch name (optional)"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="flex-1 rounded-lg bg-gray-800 px-3 py-1.5 text-xs outline-none ring-1 ring-gray-600 focus:ring-blue-500"
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
                <button type="button" onClick={() => setBranchingFromMsg(null)} className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600">Cancel</button>
              </div>
            </form>
          )}

          {/* Composer */}
          {!branchingFromMsg && (
            <form onSubmit={handleSend} className="border-t border-gray-800 px-4 py-3 flex gap-2 shrink-0">
              {canPost ? (
                <>
                  <input
                    type="text"
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    placeholder="Message…"
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
      </div>
    </div>
  )
}

function MessageRow({
  msg, currentUserId, members, onBranchFrom,
}: {
  msg: Message
  currentUserId?: string
  members: User[]
  onBranchFrom: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const author = members.find((m) => m.id === msg.authorId)
  const isMe = msg.authorId === currentUserId
  const isAssistant = msg.authorType === 'assistant'

  return (
    <div
      className={`group flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${isAssistant ? 'bg-purple-700' : 'bg-gray-700'}`}>
        {isAssistant ? 'AI' : (author?.displayName[0] ?? '?').toUpperCase()}
      </div>
      <div className={`max-w-[70%] flex flex-col gap-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-500">
            {isAssistant ? (msg.model?.split('/').pop() ?? 'AI') : (author?.displayName ?? 'Unknown')}
          </span>
          {msg.authorType === 'agent' && <span className="text-[10px] text-gray-600">agent</span>}
          {hovered && msg.status === 'done' && (
            <button
              onClick={onBranchFrom}
              className="text-[10px] text-blue-400 hover:text-blue-300 ml-1"
            >
              Branch from here
            </button>
          )}
        </div>
        <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isAssistant ? 'bg-gray-800 text-gray-100'
            : isMe ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-100'
        } ${msg.status === 'error' ? '!bg-red-900/40 text-red-300' : ''}`}>
          {msg.content || (msg.status === 'pending' ? '…' : '')}
          {msg.status === 'streaming' && <span className="ml-1 animate-pulse">▋</span>}
        </div>
      </div>
    </div>
  )
}
