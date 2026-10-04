import { describe, it, expect } from 'vitest'
import { findMentionedLabels } from './mentions.js'

describe('findMentionedLabels', () => {
  const labels = ['Claude', 'test-agent', 'Code Bot']

  it('finds standalone mentions, case-insensitively', () => {
    expect(findMentionedLabels('@claude can you look?', labels)).toEqual(['Claude'])
    expect(findMentionedLabels('ask @Claude, then @test-agent.', labels)).toEqual(['Claude', 'test-agent'])
    expect(findMentionedLabels('hey @Code Bot', labels)).toEqual(['Code Bot'])
  })

  it('ignores longer names, emails and plain text', () => {
    expect(findMentionedLabels('@Claudette hi', labels)).toEqual([])
    expect(findMentionedLabels('mail sam@claude.dev', labels)).toEqual([])
    expect(findMentionedLabels('Claude is great', labels)).toEqual([])
    expect(findMentionedLabels('@test-agent-2', labels)).toEqual([])
  })
})
