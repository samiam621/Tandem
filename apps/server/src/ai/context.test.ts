import { describe, it, expect } from 'vitest'
import type { messages } from '../db/schema.js'
import {
  buildChatContext, forkTail, BRIEF_HEADER, DOCUMENT_HEADER, OTHER_DOCUMENTS_HEADER, MULTIPLAYER_PROMPT,
  BRANCH_CONTEXT_HEADER, ASK_PARENT_HINT, FORK_TAIL_HEADER, FORK_TAIL_MESSAGES, FORK_TAIL_MAX_CHARS,
} from './context.js'

type Row = typeof messages.$inferSelect

let clock = 0
function msg(id: string, parentId: string | null, fields: Partial<Row>): Row {
  clock += 1
  return {
    id, parentId, sessionId: 'sess1', branchId: 'main', authorType: 'user', authorId: 'u1',
    agentLabel: null, sharedFromBranchId: null, kind: 'text', askQuestion: null, askedBranchId: null, model: null, content: '', status: 'done',
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
    const withBrief = buildChatContext(rows, 'm2', names, { brief: 'Use Postgres.' })
    expect(withBrief[1]).toEqual({ role: 'system', content: `${BRIEF_HEADER}\n\nUse Postgres.` })
    expect(withBrief[2]).toEqual({ role: 'user', content: 'Alice: Hi' })
    expect(buildChatContext(rows, 'm2', names, { brief: '  \n' }).filter((c) => c.role === 'system')).toHaveLength(1)
  })

  it('puts documents first, then the names of the documents left out, then the brief', () => {
    const rows = [msg('m1', null, { content: 'Hi' }), msg('m2', 'm1', { authorType: 'assistant', status: 'pending' })]
    const ctx = buildChatContext(rows, 'm2', names, {
      brief: 'Frontend first.',
      documents: [{ name: 'ARCHITECTURE.md', content: '# Arch' }, { name: 'TODO.md', content: '- [ ] UI' }],
      otherDocumentNames: ['README.md'],
    })
    expect(ctx.slice(1, 5)).toEqual([
      { role: 'system', content: `${DOCUMENT_HEADER}: ARCHITECTURE.md\n\n# Arch` },
      { role: 'system', content: `${DOCUMENT_HEADER}: TODO.md\n\n- [ ] UI` },
      { role: 'system', content: `${OTHER_DOCUMENTS_HEADER} README.md` },
      { role: 'system', content: `${BRIEF_HEADER}\n\nFrontend first.` },
    ])
    expect(ctx[5]).toEqual({ role: 'user', content: 'Alice: Hi' })
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

describe('scoped branch context', () => {
  // main: m1..m8; the frontend branch forks at m8; a grandchild forks at f2.
  function tree() {
    const rows = [msg('m1', null, { content: 'Use Postgres' })]
    for (let i = 2; i <= 8; i++) rows.push(msg(`m${i}`, `m${i - 1}`, { content: `main ${i}` }))
    rows.push(
      msg('f1', 'm8', { branchId: 'front', content: 'Start the settings page' }),
      msg('f2', 'f1', { branchId: 'front', authorType: 'assistant', authorId: 'system', content: 'Done' }),
      msg('g1', 'f2', { branchId: 'grand', content: 'Style it' }),
      msg('gp', 'g1', { branchId: 'grand', authorType: 'assistant', status: 'pending' }),
      msg('fp', 'f2', { branchId: 'front', authorType: 'assistant', status: 'pending' }),
    )
    return rows
  }

  it("leaves out the parent's earlier messages and keeps the fork tail verbatim", () => {
    const ctx = buildChatContext(tree(), 'fp', names, { branchContext: '- Use Postgres [Alice in main, Oct 2]' }, 'm8')
    const contents = ctx.map((c) => c.content)
    expect(contents).not.toContain('Alice: Use Postgres')
    expect(contents.slice(-(FORK_TAIL_MESSAGES + 2))).toEqual([
      ...['main 3', 'main 4', 'main 5', 'main 6', 'main 7', 'main 8'].map((t) => `Alice: ${t}`),
      'Alice: Start the settings page',
      'Done',
    ])
  })

  it('adds the branch context with its purpose, and the ask_parent hint only when the tool is offered', () => {
    const shared = { branchContext: '- Ship dark mode first [FRONTEND.md]', purpose: 'Frontend: settings page' }
    const ctx = buildChatContext(tree(), 'fp', names, shared, 'm8')
    const branchMsg = ctx.find((c) => c.content.startsWith(BRANCH_CONTEXT_HEADER))!
    expect(branchMsg.content).toContain('This branch is for: Frontend: settings page')
    expect(branchMsg.content).toContain('- Ship dark mode first [FRONTEND.md]')
    expect(branchMsg.content).not.toContain(ASK_PARENT_HINT)
    expect(buildChatContext(tree(), 'fp', names, { ...shared, canAskParent: true }, 'm8')
      .find((c) => c.content.startsWith(BRANCH_CONTEXT_HEADER))!.content).toContain(ASK_PARENT_HINT)
    expect(ctx.findIndex((c) => c.content === FORK_TAIL_HEADER)).toBe(ctx.findIndex((c) => c.role !== 'system') - 1)
  })

  it("gives a grandchild its own fork tail from its parent branch, never main's history", () => {
    const contents = buildChatContext(tree(), 'gp', names, {}, 'f2').map((c) => c.content)
    expect(contents.slice(-4)).toEqual(['Alice: main 8', 'Alice: Start the settings page', 'Done', 'Alice: Style it'])
    expect(contents).not.toContain('Alice: main 2')
  })

  it('never sees sibling-branch messages', () => {
    const rows = [...tree(), msg('s1', 'm8', { branchId: 'sibling', content: 'Backend work' })]
    expect(buildChatContext(rows, 'fp', names, {}, 'm8').map((c) => c.content)).not.toContain('Alice: Backend work')
  })

  it('renders an ask_parent exchange as a question and its answer', () => {
    const rows = [
      ...tree().filter((m) => m.id !== 'fp'),
      msg('a1', 'f2', { branchId: 'front', kind: 'ask_parent', authorType: 'assistant', askQuestion: 'Which DB?', content: 'Postgres [Alice in main, Oct 2]' }),
      msg('fp2', 'a1', { branchId: 'front', authorType: 'assistant', status: 'pending' }),
    ]
    const last = buildChatContext(rows, 'fp2', names, {}, 'm8').at(-1)!
    expect(last).toEqual({ role: 'user', content: 'ask_parent: Which DB?\nAnswer from the parent branch: Postgres [Alice in main, Oct 2]' })
  })

  it('caps the fork tail by size but always keeps the newest message', () => {
    const big = 'x'.repeat(FORK_TAIL_MAX_CHARS)
    const path = [msg('b1', null, { content: big }), msg('b2', 'b1', { content: big })]
    expect(forkTail(path).map((m) => m.id)).toEqual(['b2'])
  })
})
