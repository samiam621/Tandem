// In-memory presence: sessionId → userId → Set<socket>
// A user counts once regardless of how many windows/sockets they have.

import type { SocketStream } from '@fastify/websocket'
import type { OnlineUser } from '@tandem/shared'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { users, sessionMembers } from '../db/schema.js'

type SocketSet = Set<SocketStream>
const presence = new Map<string, Map<string, SocketSet>>()

// offline timers: `${sessionId}:${userId}` → timer
const offlineTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function joinPresence(sessionId: string, userId: string, socket: SocketStream) {
  let session = presence.get(sessionId)
  if (!session) {
    session = new Map()
    presence.set(sessionId, session)
  }

  // Cancel any pending offline timer for this user
  const key = `${sessionId}:${userId}`
  const timer = offlineTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    offlineTimers.delete(key)
  }

  let sockets = session.get(userId)
  if (!sockets) {
    sockets = new Set()
    session.set(userId, sockets)
  }
  sockets.add(socket)

  // Update last_seen_at
  const db = getDb()
  const now = new Date().toISOString()
  db.update(sessionMembers)
    .set({ lastSeenAt: now })
    .where(eq(sessionMembers.userId, userId))
    .run()
}

export function leavePresence(
  sessionId: string,
  userId: string,
  socket: SocketStream,
  onOffline: (sessionId: string, userId: string) => void,
) {
  const session = presence.get(sessionId)
  if (!session) return

  const sockets = session.get(userId)
  if (sockets) {
    sockets.delete(socket)
    if (sockets.size === 0) {
      session.delete(userId)
      // Wait 10 s before marking offline, to avoid flicker on refresh
      const key = `${sessionId}:${userId}`
      const timer = setTimeout(() => {
        offlineTimers.delete(key)
        onOffline(sessionId, userId)
      }, 10_000)
      offlineTimers.set(key, timer)
    }
  }
}

export function getOnlineUsers(sessionId: string): string[] {
  return [...(presence.get(sessionId)?.keys() ?? [])]
}

export function getSocketsForSession(sessionId: string): SocketStream[] {
  const session = presence.get(sessionId)
  if (!session) return []
  const sockets: SocketStream[] = []
  for (const socketSet of session.values()) {
    for (const s of socketSet) sockets.push(s)
  }
  return sockets
}

export async function buildOnlineUserList(sessionId: string): Promise<OnlineUser[]> {
  const db = getDb()
  const ids = getOnlineUsers(sessionId)
  if (!ids.length) return []
  const rows = db.select().from(users).all()
  return rows
    .filter((u) => ids.includes(u.id))
    .map((u) => ({ id: u.id, displayName: u.displayName, kind: u.kind }))
}
