import { describe, it, expect } from 'vitest'
import type { messages } from '../db/schema.js'
import { PINNED_DOCS_MAX_CHARS } from '@tandem/shared'
import { buildChatContext, BRIEF_HEADER, MULTIPLAYER_PROMPT, PINNED_HEADER, EXCERPTS_HEADER } from './context.js'

type Row = typeof messages.$inferSelect

let clock = 0
function msg(id: string, parentId: string | null, fields: Partial<Row>): Row {
  clock += 1
  return {
    id, parentId, sessionId: 'sess1', branchId: 'main', authorType: 'user', authorId: 'u1',
    agentLabel: null, sharedFromBranchId: null, model: null, content: '', status: 'done',
    createdAt: new Date(clock * 1000).toISOString(), ...fields,
  }
}

const names = new Map([['u1', 'Alice'], ['u2', 'Bob']])
const turns = (rows: Row[], pendingId: string) => buildChatContext(rows, pendingId, names).slice(1)

describe('AI context builder', () => {
  it('starts with the multiplayer system prompt', () => {
    const rows = [msg('m1', null, { content: 'Hi' }), msg('m2', 'm1', { authorType: 'assistant', status: 'pending' })]
    expect(buildChatContext(rows, 'm2', names)[0]).toEqual({ role: 'system', content: MULTIPLAYER_PROMPT })
  })

  it('adds the brief as a second system message, and nothing when it is empty', () => {
    const rows = [msg('m1', null, { content: 'Hi' }), msg('m2', 'm1', { authorType: 'assistant', status: 'pending' })]
    const withBrief = buildChatContext(rows, 'm2', names, 'Use Postgres.')
    expect(withBrief[1]).toEqual({ role: 'system', content: `${BRIEF_HEADER}\n\nUse Postgres.` })
    expect(withBrief[2]).toEqual({ role: 'user', content: 'Alice: Hi' })
    expect(buildChatContext(rows, 'm2', names, '  \n').filter((c) => c.role === 'system')).toHaveLength(1)
  })

  it('adds pinned docs in full, an index of all docs, and excerpts of unpinned docs that match the last message', () => {
    const rows = [
      msg('m1', null, { content: 'How do we hash tokens?' }),
      msg('m2', 'm1', { authorType: 'assistant', status: 'pending' }),
    ]
    const ui = { id: 'd1', title: 'UI spec', content: 'Buttons are blue.' }
    const auth = { id: 'd2', title: 'Auth spec', content: 'Tokens are hashed with HMAC.' }
    const billing = { id: 'd3', title: 'Billing', content: 'Invoices go out monthly.' }
    const system = buildChatContext(rows, 'm2', names, '', { pinned: [ui], others: [auth, billing] })
      .filter((c) => c.role === 'system').map((c) => c.content)
    expect(system[1]).toBe(`${PINNED_HEADER}\n\n### UI spec\n\nButtons are blue.`)
    expect(system[2]).toBe('Project docs index:\n- UI spec (pinned)\n- Auth spec\n- Billing')
    expect(system[3]).toBe(`${EXCERPTS_HEADER}\n\n[Auth spec]\nTokens are hashed with HMAC.`)
    expect(system.join()).not.toContain('Invoices')

    // No match: no excerpts. No docs: nothing at all.
    const off = [msg('o1', null, { content: 'Lunch?' }), msg('o2', 'o1', { authorType: 'assistant', status: 'pending' })]
    expect(buildChatContext(off, 'o2', names, '', { pinned: [], others: [auth] }).filter((c) => c.role === 'system')).toHaveLength(2)
    expect(buildChatContext(off, 'o2', names).filter((c) => c.role === 'system')).toHaveLength(1)
  })

  it('truncates pinned docs at the context budget', () => {
    const rows = [msg('m1', null, { content: 'Hi' }), msg('m2', 'm1', { authorType: 'assistant', status: 'pending' })]
    const big = { id: 'd1', title: 'Big', content: 'x'.repeat(PINNED_DOCS_MAX_CHARS * 2) }
    const pinned = buildChatContext(rows, 'm2', names, '', { pinned: [big], others: [] })[1].content
    expect(pinned.length).toBeLessThan(PINNED_DOCS_MAX_CHARS + 200)
    expect(pinned).toContain('[Truncated: pinned docs exceed')
  })

  it('builds context from root to head, excluding the pending assistant message', () => {
    const rows = [
      msg('m1', null, { content: 'Hello' }),
      msg('m2', 'm1', { authorType: 'assistant', authorId: 'system', content: 'Hi there!' }),
      msg('m3', 'm2', { authorId: 'u2', content: 'How are you?' }),
      msg('m4', 'm3', { authorType: 'assistant', authorId: 'system', status: 'pending' }),
    ]
    expect(turns(rows, 'm4')).toEqual([
      { role: 'user', content: 'Alice: Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'Bob: How are you?' },
    ])
  })

  it('prefixes agent messages with their token label', () => {
    const rows = [
      msg('m1', null, { authorType: 'agent', agentLabel: 'Claude', content: 'Tests pass' }),
      msg('m2', 'm1', { authorType: 'assistant', status: 'pending' }),
    ]
    expect(turns(rows, 'm2')).toEqual([{ role: 'user', content: 'Claude: Tests pass' }])
  })

  it('does not include messages from sibling branches', () => {
    // m1 is the fork point; brA and brB both branch from it.
    const rows = [
      msg('m1', null, { content: 'Root' }),
      msg('mA1', 'm1', { branchId: 'brA', content: 'Branch A msg' }),
      msg('mB1', 'm1', { branchId: 'brB', content: 'Branch B msg' }),
      msg('mA2', 'mA1', { branchId: 'brA', authorType: 'assistant', status: 'pending' }),
    ]
    expect(turns(rows, 'mA2').map((c) => c.content)).toEqual(['Alice: Root', 'Alice: Branch A msg'])
  })

  it('skips error and pending messages in context', () => {
    const rows = [
      msg('m1', null, { content: 'Hello' }),
      msg('m2', 'm1', { authorType: 'assistant', content: 'Error reply', status: 'error' }),
      msg('m3', 'm2', { content: 'Second question' }),
      msg('m4', 'm3', { authorType: 'assistant', status: 'pending' }),
    ]
    expect(turns(rows, 'm4').map((c) => c.content)).toEqual(['Alice: Hello', 'Alice: Second question'])
  })
})
