import { nanoid } from 'nanoid'

// One-time auth codes: code → { userId, expiresAt }
// In-memory only. One server instance assumption.
const codes = new Map<string, { userId: string; expiresAt: number }>()

export function createOneTimeCode(userId: string): string {
  const code = nanoid(32)
  codes.set(code, { userId, expiresAt: Date.now() + 60_000 })
  return code
}

export function consumeOneTimeCode(code: string): string | null {
  const entry = codes.get(code)
  if (!entry) return null
  codes.delete(code)
  if (Date.now() > entry.expiresAt) return null
  return entry.userId
}
