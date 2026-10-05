import { describe, it, expect } from 'vitest'
import { chunkDoc, searchDocs } from './docs.js'

const auth = { id: 'd1', title: 'Auth spec', content: 'Sign-in uses GitHub OAuth.\n\nTokens are hashed with HMAC.' }
const billing = { id: 'd2', title: 'Billing', content: 'Invoices are sent monthly through Stripe.' }

describe('chunkDoc', () => {
  it('keeps short paragraphs together and splits long text near the chunk size', () => {
    expect(chunkDoc(auth)).toHaveLength(1)
    const long = chunkDoc({ id: 'x', title: 'x', content: Array(10).fill('a'.repeat(400)).join('\n\n') })
    expect(long.length).toBeGreaterThan(2)
    expect(long.every((c) => c.text.length <= 1500)).toBe(true)
    expect(chunkDoc({ id: 'y', title: 'y', content: 'b'.repeat(4000) })).toHaveLength(3)
  })
})

describe('searchDocs', () => {
  it('ranks the matching doc first and ignores unrelated queries', () => {
    expect(searchDocs([billing, auth], 'how are tokens hashed?', 2).map((c) => c.docId)).toEqual(['d1'])
    expect(searchDocs([billing, auth], 'stripe invoices', 1)[0].docId).toBe('d2')
    expect(searchDocs([billing, auth], 'kubernetes deployment', 3)).toEqual([])
    expect(searchDocs([billing, auth], 'the and', 3)).toEqual([])
  })
})
