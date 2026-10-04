import type { FastifyPluginAsync } from 'fastify'
import type { SocketStream } from '@fastify/websocket'
import type { WsClientFrame } from '@tandem/shared'
import { resolveToken } from '../services/auth.js'
import { joinPresence, leavePresence, buildOnlineUserList } from './presence.js'
import { bus } from '../events.js'
import { isSessionMember } from '../services/sessions.js'

// Must import broadcaster to activate the bus subscription
import './broadcaster.js'

export const wsHandler: FastifyPluginAsync = async (app) => {
  app.get('/ws', { websocket: true }, async (socket: SocketStream, _req) => {
    let actor: { userId: string; tokenKind: 'desktop' | 'agent'; tokenId: string } | null = null
    const joinedSessions = new Set<string>()

    // Close unauthenticated sockets after 5 s
    const authTimeout = setTimeout(() => {
      if (!actor) socket.socket.close(4001, 'Authentication timeout')
    }, 5000)

    // Handle frames strictly in order: auth resolves asynchronously, and a join_session sent
    // right after it (as the desktop app does) must not be processed before auth finishes.
    let queue = Promise.resolve()
    socket.on('data', (raw: Buffer) => {
      queue = queue.then(() => handleFrame(raw)).catch((err) => app.log.error(err, 'WebSocket frame failed'))
    })

    async function handleFrame(raw: Buffer) {
      let frame: WsClientFrame
      try {
        frame = JSON.parse(raw.toString()) as WsClientFrame
      } catch {
        return
      }

      if (frame.type === 'auth') {
        const resolved = await resolveToken(frame.payload.token)
        if (!resolved) {
          socket.socket.close(4001, 'Invalid token')
          return
        }
        actor = resolved
        clearTimeout(authTimeout)
        return
      }

      if (!actor) return // Ignore frames before auth

      switch (frame.type) {
        case 'join_session': {
          const { sessionId } = frame.payload
          if (!isSessionMember(sessionId, actor.userId)) return // only members get a session's live events
          joinPresence(sessionId, actor.userId, socket)
          joinedSessions.add(sessionId)

          const onlineUsers = await buildOnlineUserList(sessionId)
          bus.emitSession(sessionId, {
            type: 'presence_update',
            payload: { sessionId, onlineUsers, onlineCount: onlineUsers.length },
          })
          break
        }

        case 'leave_session': {
          const { sessionId } = frame.payload
          handleLeaveSession(sessionId)
          break
        }

        case 'typing': {
          const { sessionId, branchId } = frame.payload
          if (!joinedSessions.has(sessionId)) return
          bus.emitSession(sessionId, {
            type: 'typing',
            payload: { userId: actor.userId, branchId },
          })
          break
        }
      }
    }

    socket.on('close', async () => {
      clearTimeout(authTimeout)
      if (!actor) return
      for (const sessionId of joinedSessions) {
        handleLeaveSession(sessionId)
      }
    })

    async function handleLeaveSession(sessionId: string) {
      if (!actor) return
      leavePresence(sessionId, actor!.userId, socket, async (sid) => {
        const onlineUsers = await buildOnlineUserList(sid)
        bus.emitSession(sid, {
          type: 'presence_update',
          payload: { sessionId: sid, onlineUsers, onlineCount: onlineUsers.length },
        })
      })
      joinedSessions.delete(sessionId)
    }
  })
}
