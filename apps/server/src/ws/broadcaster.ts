import type { WsServerEvent } from '@tandem/shared'
import { getSocketsForSession } from './presence.js'
import { bus } from '../events.js'

// Subscribe to the event bus and broadcast events to connected sockets
bus.onSession(({ sessionId, event }) => {
  const sockets = getSocketsForSession(sessionId)
  const data = JSON.stringify(event)
  for (const stream of sockets) {
    try {
      if (stream.socket.readyState === 1 /* OPEN */) {
        stream.socket.send(data)
      }
    } catch {}
  }
})

export function broadcastToSession(sessionId: string, event: WsServerEvent) {
  bus.emitSession(sessionId, event)
}
