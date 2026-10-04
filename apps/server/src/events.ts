import { EventEmitter } from 'events'
import type { WsServerEvent } from '@tandem/shared'

// Typed in-process event bus.
// Services emit events here; the WS broadcaster subscribes and fans out.
export interface SessionEvent {
  sessionId: string
  event: WsServerEvent
}

class EventBus extends EventEmitter {
  emitSession(sessionId: string, event: WsServerEvent) {
    const payload: SessionEvent = { sessionId, event }
    this.emit('session', payload)
  }

  onSession(handler: (payload: SessionEvent) => void) {
    this.on('session', handler)
  }

  offSession(handler: (payload: SessionEvent) => void) {
    this.off('session', handler)
  }
}

export const bus = new EventBus()
