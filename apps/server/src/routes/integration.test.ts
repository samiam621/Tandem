import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { healthRoute } from '../routes/health.js'
import { authRoutes } from '../routes/auth.js'
import { sessionRoutes } from '../routes/sessions.js'
import { branchRoutes } from '../routes/branches.js'
import { messageRoutes } from '../routes/messages.js'
import { modelsRoute } from '../routes/models.js'
import { tokenRoutes } from '../routes/tokens.js'
import { recoverStaleMessages } from '../services/messages.js'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema.js'

// Override getDb to use an in-memory database for tests
import * as dbModule from '../db/index.js'
import { vi } from 'vitest'

function buildTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, kind TEXT NOT NULL, display_name TEXT NOT NULL, github_id TEXT, device_id TEXT, avatar_url TEXT, created_at TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL, default_model TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE session_members (session_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
    CREATE TABLE branches (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT, is_main INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, model TEXT NOT NULL, fork_message_id TEXT, head_message_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, branch_id TEXT NOT NULL, parent_id TEXT, author_type TEXT NOT NULL, author_id TEXT NOT NULL, model TEXT, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT);
  `)
  return drizzle(sqlite, { schema })
}

// Patch the db module
const testDb = buildTestDb()
vi.spyOn(dbModule, 'getDb').mockReturnValue(testDb as any)

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(cors, { origin: true })
  await app.register(websocket)
  await app.register(healthRoute)
  await app.register(authRoutes)
  await app.register(sessionRoutes)
  await app.register(branchRoutes)
  await app.register(messageRoutes)
  await app.register(modelsRoute)
  await app.register(tokenRoutes)
  recoverStaleMessages()
  return app
}

describe('REST integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let token: string
  let userId: string
  let sessionId: string
  let mainBranchId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/health → 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('POST /api/auth/guest → 200, returns user + token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/guest',
      payload: { displayName: 'TestUser', deviceId: 'test-device' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.token).toMatch(/^tdm_/)
    expect(body.user.displayName).toBe('TestUser')
    token = body.token
    userId = body.user.id
  })

  it('GET /api/me → 200 with correct user', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe(userId)
  })

  it('GET /api/me without token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /api/sessions → 201 with session + mainBranch', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Test Session', defaultModel: 'openai/gpt-4o-mini' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.session.title).toBe('Test Session')
    expect(body.mainBranch.isMain).toBe(true)
    sessionId = body.session.id
    mainBranchId = body.mainBranch.id
  })

  it('GET /api/sessions → lists created session', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const sessions = res.json()
    expect(sessions.find((s: any) => s.id === sessionId)).toBeTruthy()
  })

  it('POST /api/branches/:id/messages → 201', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'Hello integration test!', triggerAi: false },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.userMessage.content).toBe('Hello integration test!')
    expect(body.userMessage.authorType).toBe('user')
  })

  it('GET /api/branches/:id/messages → returns messages', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const msgs = res.json()
    expect(msgs.length).toBeGreaterThan(0)
    expect(msgs[0].content).toBe('Hello integration test!')
  })

  it('POST /api/sessions/join → joins with invite code', async () => {
    // Create second user
    const auth2 = await app.inject({
      method: 'POST', url: '/api/auth/guest',
      payload: { displayName: 'User2', deviceId: 'device-2' },
    })
    const token2 = auth2.json().token

    // Get invite code
    const sessRes = await app.inject({
      method: 'GET', url: `/api/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    const inviteCode = sessRes.json().session.inviteCode

    const joinRes = await app.inject({
      method: 'POST', url: '/api/sessions/join',
      headers: { authorization: `Bearer ${token2}` },
      payload: { inviteCode },
    })
    expect(joinRes.statusCode).toBe(200)
    expect(joinRes.json().session.id).toBe(sessionId)
  })

  it('POST /api/tokens → creates agent token', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/tokens',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'test-agent' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.rawToken).toMatch(/^tdm_/)
    expect(body.token.kind).toBe('agent')
  })

  it('POST /api/auth/exchange with invalid code → 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/exchange',
      payload: { code: 'invalid-code-xyz' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /api/auth/guest with missing fields → 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/guest',
      payload: { displayName: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('invalid_request')
  })
})
