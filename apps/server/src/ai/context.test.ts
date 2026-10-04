import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema.js'
import { eq } from 'drizzle-orm'

// We test the context builder logic in isolation by creating an in-memory DB
// and calling the same path-walking code used in the AI module.

function buildTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  // Create tables
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, display_name TEXT NOT NULL,
      github_id TEXT, device_id TEXT, avatar_url TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL,
      default_model TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE session_members (
      session_id TEXT NOT NULL, user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
    );
    CREATE TABLE branches (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT,
      is_main INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, model TEXT NOT NULL,
      fork_message_id TEXT, head_message_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      parent_id TEXT, author_type TEXT NOT NULL, author_id TEXT NOT NULL, agent_label TEXT, shared_from_branch_id TEXT,
      model TEXT, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE TABLE api_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      created_at TEXT NOT NULL, last_used_at TEXT
    );
  `)
  return drizzle(sqlite, { schema })
}

// Context builder extracted from openrouter.ts (pure function over rows)
function buildContext(
  db: ReturnType<typeof buildTestDb>,
  sessionId: string,
  headMessageId: string,
) {
  const { messages } = schema
  const allMessages = db.select().from(messages)
    .where(eq(messages.sessionId, sessionId))
    .all()
  const msgById = new Map(allMessages.map((m) => [m.id, m]))

  const path: typeof allMessages[0][] = []
  let cur: typeof allMessages[0] | undefined = msgById.get(headMessageId)
  while (cur) {
    path.push(cur)
    cur = cur.parentId ? msgById.get(cur.parentId) : undefined
  }
  path.reverse()

  // Exclude the pending assistant message itself
  const context = path.filter(
    (m) => !(m.id === headMessageId) && m.status === 'done',
  )

  type ChatMsg = { role: 'user' | 'assistant'; content: string }
  return context.map((m): ChatMsg => {
    if (m.authorType === 'assistant') return { role: 'assistant', content: m.content }
    return { role: 'user', content: m.content }
  })
}

describe('AI context builder', () => {
  let db: ReturnType<typeof buildTestDb>

  beforeEach(() => {
    db = buildTestDb()
    // Insert shared session
    db.insert(schema.sessions).values({
      id: 'sess1', title: 'Test', ownerId: 'u1', defaultModel: 'gpt-4o',
      inviteCode: 'abc', createdAt: '2024-01-01T00:00:00.000Z',
    }).run()
  })

  it('builds context from root to head, excluding the pending assistant message', () => {
    const msgs = [
      { id: 'm1', sessionId: 'sess1', branchId: 'b1', parentId: null, authorType: 'user', authorId: 'u1', model: null, content: 'Hello', status: 'done', createdAt: '2024-01-01T00:00:01.000Z' },
      { id: 'm2', sessionId: 'sess1', branchId: 'b1', parentId: 'm1', authorType: 'assistant', authorId: 'system', model: 'gpt-4o', content: 'Hi there!', status: 'done', createdAt: '2024-01-01T00:00:02.000Z' },
      { id: 'm3', sessionId: 'sess1', branchId: 'b1', parentId: 'm2', authorType: 'user', authorId: 'u1', model: null, content: 'How are you?', status: 'done', createdAt: '2024-01-01T00:00:03.000Z' },
      { id: 'm4', sessionId: 'sess1', branchId: 'b1', parentId: 'm3', authorType: 'assistant', authorId: 'system', model: 'gpt-4o', content: '', status: 'pending', createdAt: '2024-01-01T00:00:04.000Z' },
    ] as typeof schema.messages.$inferInsert[]
    for (const m of msgs) db.insert(schema.messages).values(m).run()

    const context = buildContext(db, 'sess1', 'm4')
    expect(context).toHaveLength(3)
    expect(context[0]).toEqual({ role: 'user', content: 'Hello' })
    expect(context[1]).toEqual({ role: 'assistant', content: 'Hi there!' })
    expect(context[2]).toEqual({ role: 'user', content: 'How are you?' })
  })

  it('does not include messages from sibling branches', () => {
    // Main: root → m1 → (fork point)
    // Branch A: m1 → mA1 → mA2(pending)
    // Branch B: m1 → mB1
    // When building context for mA2, mB1 should NOT appear
    const msgs = [
      { id: 'm1', sessionId: 'sess1', branchId: 'main', parentId: null, authorType: 'user', authorId: 'u1', model: null, content: 'Root', status: 'done', createdAt: '2024-01-01T00:00:01.000Z' },
      { id: 'mA1', sessionId: 'sess1', branchId: 'brA', parentId: 'm1', authorType: 'user', authorId: 'u1', model: null, content: 'Branch A msg', status: 'done', createdAt: '2024-01-01T00:00:02.000Z' },
      { id: 'mA2', sessionId: 'sess1', branchId: 'brA', parentId: 'mA1', authorType: 'assistant', authorId: 'system', model: 'gpt-4o', content: '', status: 'pending', createdAt: '2024-01-01T00:00:03.000Z' },
      { id: 'mB1', sessionId: 'sess1', branchId: 'brB', parentId: 'm1', authorType: 'user', authorId: 'u1', model: null, content: 'Branch B msg', status: 'done', createdAt: '2024-01-01T00:00:02.000Z' },
    ] as typeof schema.messages.$inferInsert[]
    for (const m of msgs) db.insert(schema.messages).values(m).run()

    const context = buildContext(db, 'sess1', 'mA2')
    expect(context).toHaveLength(2)
    expect(context.map((c) => c.content)).toEqual(['Root', 'Branch A msg'])
    // mB1 must not appear
    expect(context.find((c) => c.content === 'Branch B msg')).toBeUndefined()
  })

  it('skips error and pending messages in context', () => {
    const msgs = [
      { id: 'm1', sessionId: 'sess1', branchId: 'b1', parentId: null, authorType: 'user', authorId: 'u1', model: null, content: 'Hello', status: 'done', createdAt: '2024-01-01T00:00:01.000Z' },
      { id: 'm2', sessionId: 'sess1', branchId: 'b1', parentId: 'm1', authorType: 'assistant', authorId: 'system', model: 'gpt-4o', content: 'Error reply', status: 'error', createdAt: '2024-01-01T00:00:02.000Z' },
      { id: 'm3', sessionId: 'sess1', branchId: 'b1', parentId: 'm2', authorType: 'user', authorId: 'u1', model: null, content: 'Second question', status: 'done', createdAt: '2024-01-01T00:00:03.000Z' },
      { id: 'm4', sessionId: 'sess1', branchId: 'b1', parentId: 'm3', authorType: 'assistant', authorId: 'system', model: 'gpt-4o', content: '', status: 'pending', createdAt: '2024-01-01T00:00:04.000Z' },
    ] as typeof schema.messages.$inferInsert[]
    for (const m of msgs) db.insert(schema.messages).values(m).run()

    const context = buildContext(db, 'sess1', 'm4')
    // m2 is error → skipped; m4 is the pending message itself → excluded
    expect(context.map((c) => c.content)).toEqual(['Hello', 'Second question'])
  })
})
