import { describe, it, expect, beforeEach } from 'vitest'
import { createOneTimeCode, consumeOneTimeCode } from '../lib/oneTimeCodes.js'

describe('oneTimeCodes', () => {
  it('returns the userId when code is consumed once', () => {
    const code = createOneTimeCode('user-123')
    const result = consumeOneTimeCode(code)
    expect(result).toBe('user-123')
  })

  it('returns null when code is consumed a second time', () => {
    const code = createOneTimeCode('user-456')
    consumeOneTimeCode(code)
    const result = consumeOneTimeCode(code)
    expect(result).toBeNull()
  })

  it('returns null for unknown code', () => {
    expect(consumeOneTimeCode('does-not-exist')).toBeNull()
  })
})
