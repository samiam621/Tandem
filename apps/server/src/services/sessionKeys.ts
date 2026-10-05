import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { sessions, sessionKeys } from '../db/schema.js'
import { bus } from '../events.js'
import { storeSessionKey, deleteSessionKey, verifyOpenRouterKey } from '../ai/keys.js'
import { isSessionMember } from './sessions.js'
import { fail } from './errors.js'
import type { SessionKeyInfo } from '@tandem/shared'

// A session's own OpenRouter key (BYOK). Only the session owner sets, replaces, or removes it; every
// member's model calls in the session then use it. Members only ever see its last four characters.

function assertOwner(sessionId: string, userId: string) {
  const session = getDb().select({ ownerId: sessions.ownerId }).from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session || !isSessionMember(sessionId, userId)) fail(404, 'not_found', 'Session not found')
  if (session.ownerId !== userId) fail(403, 'forbidden', 'Only the session owner can manage its OpenRouter key')
}

function keyInfo(sessionId: string): SessionKeyInfo {
  const row = getDb().select().from(sessionKeys).where(eq(sessionKeys.sessionId, sessionId)).get()
  return row
    ? { sessionId, hasKey: true, keyLast4: row.keyLast4, setBy: row.setBy, setAt: row.setAt }
    : { sessionId, hasKey: false, keyLast4: null, setBy: null, setAt: null }
}

export function getSessionKeyInfo(actor: { userId: string }, sessionId: string): SessionKeyInfo {
  if (!isSessionMember(sessionId, actor.userId)) fail(404, 'not_found', 'Session not found')
  return keyInfo(sessionId)
}

export async function setSessionKey(actor: { userId: string }, sessionId: string, key: string): Promise<SessionKeyInfo> {
  assertOwner(sessionId, actor.userId)
  const valid = await verifyOpenRouterKey(key).catch((err: unknown) =>
    fail(502, 'upstream_error', `Could not check the key with OpenRouter: ${err instanceof Error ? err.message : String(err)}`))
  if (!valid) fail(400, 'invalid_key', 'OpenRouter rejected this key')
  storeSessionKey(sessionId, key, actor.userId, new Date().toISOString())
  const info = keyInfo(sessionId)
  bus.emitSession(sessionId, { type: 'session_key_updated', payload: info })
  return info
}

export function removeSessionKey(actor: { userId: string }, sessionId: string): SessionKeyInfo {
  assertOwner(sessionId, actor.userId)
  deleteSessionKey(sessionId)
  const info = keyInfo(sessionId)
  bus.emitSession(sessionId, { type: 'session_key_updated', payload: info })
  return info
}
