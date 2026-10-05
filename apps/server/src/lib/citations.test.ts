import { describe, it, expect } from 'vitest'
import { dropUnknownDocumentCitations } from './citations.js'

describe('dropUnknownDocumentCitations', () => {
  const docs = ['FRONTEND.md', 'API.md']

  it('keeps citations of existing documents, with or without a heading', () => {
    const text = '- Use tokens [FRONTEND.md § Styling]\n- REST only [api.md]'
    expect(dropUnknownDocumentCitations(text, docs)).toBe(text)
  })

  it('drops citations of documents that do not exist', () => {
    expect(dropUnknownDocumentCitations('- Use Redis [CACHE.md § Setup]', docs)).toBe('- Use Redis')
  })

  it('keeps discussion citations, links, and task boxes', () => {
    const text = '- [x] Ship it [Sam in main, Oct 2] see [the spec](https://example.com)'
    expect(dropUnknownDocumentCitations(text, docs)).toBe(text)
  })
})
