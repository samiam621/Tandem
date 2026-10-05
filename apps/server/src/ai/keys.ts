import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { sessionKeys } from '../db/schema.js'

// OpenRouter keys: the server's OPENROUTER_API_KEY and each session's own key (BYOK). This module
// and the rest of src/ai/ are the only places that read them. A session key is stored encrypted
// with AES-256-GCM under KEY_ENCRYPTION_SECRET and decrypted only when a model call needs it.

const VERSION = 'v1'

function encryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET ?? 'dev-key-secret'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':')
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, body] = stored.split(':')
  if (version !== VERSION || !iv || !tag || !body) throw new Error('Unreadable stored key')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')
}

export function hasSessionKey(sessionId: string): boolean {
  return Boolean(getDb().select({ id: sessionKeys.sessionId }).from(sessionKeys).where(eq(sessionKeys.sessionId, sessionId)).get())
}

// The key a session's model calls use: its own key when set, otherwise the server's.
// `byok` tells callers whether the session pays (paid models are then allowed).
export function apiKeyFor(sessionId: string): { apiKey: string | undefined; byok: boolean } {
  const row = getDb().select().from(sessionKeys).where(eq(sessionKeys.sessionId, sessionId)).get()
  if (row) return { apiKey: decryptSecret(row.keyCiphertext), byok: true }
  return { apiKey: process.env.OPENROUTER_API_KEY || undefined, byok: false }
}

export function storeSessionKey(sessionId: string, key: string, setBy: string, setAt: string) {
  const values = { keyCiphertext: encryptSecret(key), keyLast4: key.slice(-4), setBy, setAt }
  getDb().insert(sessionKeys).values({ sessionId, ...values })
    .onConflictDoUpdate({ target: sessionKeys.sessionId, set: values })
    .run()
}

export function deleteSessionKey(sessionId: string) {
  getDb().delete(sessionKeys).where(eq(sessionKeys.sessionId, sessionId)).run()
}

// Asks OpenRouter whether the key is valid, so a typo fails when it is set rather than on the
// next reply. Throws on a network or server error; returns false only for a rejected key.
export async function verifyOpenRouterKey(key: string): Promise<boolean> {
  const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } })
  if (res.status === 401 || res.status === 403) return false
  if (!res.ok) throw new Error(`OpenRouter key check failed: ${res.status}`)
  return true
}
