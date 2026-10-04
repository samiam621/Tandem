import { describe, it, expect, beforeEach, vi } from 'vitest'

// We test the presence counting logic in isolation.
// The actual module uses sockets, so we mock the shape.

interface FakeSocket { id: string }

// Replicate the presence map logic from ws/presence.ts
function makePresenceTracker() {
  const presence = new Map<string, Map<string, Set<FakeSocket>>>()

  function join(sessionId: string, userId: string, socket: FakeSocket) {
    let session = presence.get(sessionId)
    if (!session) { session = new Map(); presence.set(sessionId, session) }
    let sockets = session.get(userId)
    if (!sockets) { sockets = new Set(); session.set(userId, sockets) }
    sockets.add(socket)
  }

  function leave(sessionId: string, userId: string, socket: FakeSocket) {
    const session = presence.get(sessionId)
    if (!session) return
    const sockets = session.get(userId)
    if (!sockets) return
    sockets.delete(socket)
    if (sockets.size === 0) session.delete(userId)
  }

  function onlineCount(sessionId: string): number {
    return presence.get(sessionId)?.size ?? 0
  }

  function onlineUserIds(sessionId: string): string[] {
    return [...(presence.get(sessionId)?.keys() ?? [])]
  }

  return { join, leave, onlineCount, onlineUserIds }
}

describe('presence counting', () => {
  let tracker: ReturnType<typeof makePresenceTracker>

  beforeEach(() => { tracker = makePresenceTracker() })

  it('counts distinct users, not socket count', () => {
    const s1 = { id: 'socket-1' }
    const s2 = { id: 'socket-2' }
    tracker.join('sess', 'user-A', s1)
    tracker.join('sess', 'user-A', s2) // same user, second window
    tracker.join('sess', 'user-B', { id: 'socket-3' })
    expect(tracker.onlineCount('sess')).toBe(2)
  })

  it('removes user when last socket disconnects', () => {
    const s1 = { id: 'socket-1' }
    const s2 = { id: 'socket-2' }
    tracker.join('sess', 'user-A', s1)
    tracker.join('sess', 'user-A', s2)
    tracker.leave('sess', 'user-A', s1)
    expect(tracker.onlineCount('sess')).toBe(1) // still has s2
    tracker.leave('sess', 'user-A', s2)
    expect(tracker.onlineCount('sess')).toBe(0)
  })

  it('keeps user online if at least one socket remains', () => {
    const s1 = { id: 's1' }
    const s2 = { id: 's2' }
    tracker.join('sess', 'user-A', s1)
    tracker.join('sess', 'user-A', s2)
    tracker.leave('sess', 'user-A', s1)
    expect(tracker.onlineUserIds('sess')).toContain('user-A')
  })

  it('sessions are independent', () => {
    tracker.join('sess1', 'user-A', { id: 's1' })
    tracker.join('sess2', 'user-B', { id: 's2' })
    expect(tracker.onlineCount('sess1')).toBe(1)
    expect(tracker.onlineCount('sess2')).toBe(1)
    expect(tracker.onlineCount('sess3')).toBe(0)
  })
})
