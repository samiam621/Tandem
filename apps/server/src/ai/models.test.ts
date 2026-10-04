import { describe, expect, it } from 'vitest'
import { isFreeModelId } from './models.js'

describe('OpenRouter free model IDs', () => {
  it('accepts only IDs with the :free variant suffix', () => {
    expect(isFreeModelId('meta-llama/llama-3.3-70b-instruct:free')).toBe(true)
    expect(isFreeModelId('openai/gpt-4o-mini')).toBe(false)
  })
})
