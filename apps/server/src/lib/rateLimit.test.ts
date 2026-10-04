import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '../lib/rateLimit.js'

describe('rateLimit', () => {
  it('allows up to the limit and then rejects', () => {
    const userId = `test-${Math.random()}`
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit(userId)).toBe(true)
    }
    expect(checkRateLimit(userId)).toBe(false)
  })

  it('different users have independent counters', () => {
    const u1 = `u1-${Math.random()}`
    const u2 = `u2-${Math.random()}`
    for (let i = 0; i < 100; i++) checkRateLimit(u1)
    // u1 is at limit, u2 should still be allowed
    expect(checkRateLimit(u2)).toBe(true)
  })
})
