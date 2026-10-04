import { useEffect, useRef, useCallback } from 'react'
import type { WsClientFrame, WsServerEvent } from '@tandem/shared'

type Handler = (event: WsServerEvent) => void

export function useWebSocket(
  serverUrl: string,
  token: string | null,
  sessionId: string | null,
  onEvent: Handler,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay = useRef(1000)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const send = useCallback((frame: WsClientFrame) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(frame))
    }
  }, [])

  useEffect(() => {
    if (!token) return

    let destroyed = false

    function connect() {
      if (destroyed) return
      const wsUrl = serverUrl.replace(/^http/, 'ws') + '/ws'
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retryDelay.current = 1000
        // Authenticate
        ws.send(JSON.stringify({ type: 'auth', payload: { token } }))
        // Join session if active
        if (sessionId) {
          ws.send(JSON.stringify({ type: 'join_session', payload: { sessionId } }))
        }
      }

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as WsServerEvent
          onEventRef.current(event)
        } catch {}
      }

      ws.onclose = () => {
        if (destroyed) return
        retryTimerRef.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 2, 30_000)
          connect()
        }, retryDelay.current)
      }
    }

    connect()

    return () => {
      destroyed = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [token, serverUrl, sessionId])

  return { send }
}
