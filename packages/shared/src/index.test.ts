import { describe, expect, it } from 'vitest'
// isFreeModelId now lives in packages/shared so both client and server can use it
import { isFreeModelId } from './index.js'

describe('OpenRouter free model IDs', () => {
  it('accepts only IDs with the :free variant suffix', () => {
    // A proper free model ID ends in :free
    expect(isFreeModelId('qwen/qwen3.8-27b:free')).toBe(true)
    // A paid model ID does not — should be rejected
    expect(isFreeModelId('openai/gpt-4o-mini')).toBe(false)
  })
})
