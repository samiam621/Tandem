// Simple in-memory per-user message rate cap.
// Exists only to protect the OpenRouter key.

const LIMIT = 100 // messages per hour per user
const WINDOW_MS = 60 * 60 * 1000

const counters = new Map<string, { count: number; windowStart: number }>()

export function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  let entry = counters.get(userId)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { count: 0, windowStart: now }
    counters.set(userId, entry)
  }
  if (entry.count >= LIMIT) return false
  entry.count++
  return true
}
