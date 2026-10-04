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
import { resolveToken } from '../services/auth.js'
import { listMentions, waitForMentions, getBranchContext, setWorking } from '../services/agents.js'
import { bus } from '../events.js'
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
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, branch_id TEXT NOT NULL, parent_id TEXT, author_type TEXT NOT NULL, author_id TEXT NOT NULL, agent_label TEXT, shared_from_branch_id TEXT, model TEXT, content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE message_mentions (message_id TEXT NOT NULL, token_id TEXT NOT NULL, created_at TEXT NOT NULL);
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
  let claudeToken: string
  let user2Token: string
  let bugfixBranchId: string

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

  it('POST /api/sessions rejects paid model IDs', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      headers: { authorization: 'Bearer ' + token },
      payload: { title: 'Paid Model Session', defaultModel: 'openai/gpt-4o-mini' },
    })
    expect(res.statusCode).toBe(400)
    // FreeModelIdSchema is part of the Zod shape now, so the error code is invalid_request
    expect(res.json().error.code).toBe('invalid_request')
  })

  it('POST /api/sessions → 201 with session + mainBranch', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Test Session', defaultModel: 'openai/gpt-4o-mini:free' },
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
    user2Token = token2

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

  it('agent token posts carry the token label; desktop posts do not', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/tokens',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Claude' },
    })
    claudeToken = created.json().rawToken
    const res = await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${created.json().rawToken}` },
      payload: { content: 'Hi from Claude', triggerAi: false },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().userMessage.authorType).toBe('agent')
    expect(res.json().userMessage.agentLabel).toBe('Claude')

    const msgs = (await app.inject({
      method: 'GET', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${token}` },
    })).json()
    expect(msgs.find((m: any) => m.content === 'Hello integration test!').agentLabel).toBeNull()
    expect(msgs.find((m: any) => m.content === 'Hi from Claude').agentLabel).toBe('Claude')
  })

  it('GET /api/sessions/:id/agents → lists agent tokens of members', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/sessions/${sessionId}/agents`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const claude = res.json().find((a: any) => a.label === 'Claude')
    expect(claude).toMatchObject({ ownerId: userId, active: true })
  })

  it('@mentioning an agent stores the mention and skips the built-in AI reply', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: '@claude please review this', triggerAi: true },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().pendingAssistantId).toBeUndefined()
    const rows = testDb.select().from(schema.messageMentions).all()
    expect(rows.map((r) => r.messageId)).toEqual([res.json().userMessage.id])
  })

  it('listMentions returns mentions of this agent token only', async () => {
    const claude = (await resolveToken(claudeToken))!
    expect(listMentions(claude, '')).toMatchObject([
      { branchId: mainBranchId, branchName: 'main', authorDisplayName: 'TestUser', content: '@claude please review this' },
    ])
    const other = (await resolveToken(token))!
    expect(listMentions(other, '')).toEqual([])
  })

  it('waitForMentions resolves when a new mention arrives, and times out with []', async () => {
    const claude = (await resolveToken(claudeToken))!
    const cursor = listMentions(claude, '').at(-1)!.createdAt
    expect(await waitForMentions(claude, cursor, 20)).toEqual([])

    const waiting = waitForMentions(claude, cursor, 2000)
    await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: 'over to you @Claude', triggerAi: false },
    })
    expect((await waiting).map((m) => m.content)).toEqual(['over to you @Claude'])
  })

  it('getBranchContext includes history up to the fork and nothing posted to main after it', async () => {
    const auth = { authorization: `Bearer ${token}` }
    const mainMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: auth })).json()
    const forkMsg = mainMsgs.find((m: any) => m.content === 'Hello integration test!')
    const branch = (await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: auth,
      payload: { fromMessageId: forkMsg.id, model: 'test-model:free', name: 'bugfix' },
    })).json()
    bugfixBranchId = branch.id
    await app.inject({
      method: 'POST', url: `/api/branches/${branch.id}/messages`, headers: auth,
      payload: { content: 'branch work', triggerAi: false },
    })

    const claude = (await resolveToken(claudeToken))!
    const ctx = (await getBranchContext(claude, branch.id, 200))!
    expect(ctx.messages.map((m) => m.content)).toEqual(['Hello integration test!', 'branch work'])
    expect(ctx.forkedFrom).toMatchObject({ branchId: mainBranchId, branchName: 'main', messageId: forkMsg.id })
    expect(ctx.branch).toMatchObject({ name: 'bugfix', ownerDisplayName: 'TestUser' })
    expect(ctx.otherBranches.map((b) => b.name)).toContain('main')
    expect(await getBranchContext(claude, 'no-such-branch', 200)).toBeNull()
  })

  it('POST /api/branches/:id/share posts a summary into main (owner only)', async () => {
    const share = (branchId: string, tok: string) =>
      app.inject({ method: 'POST', url: `/api/branches/${branchId}/share`, headers: { authorization: `Bearer ${tok}` } })

    expect((await share(bugfixBranchId, user2Token)).statusCode).toBe(403)
    expect((await share(mainBranchId, token)).statusCode).toBe(400)
    expect((await share('no-such-branch', token)).statusCode).toBe(404)

    const res = await share(bugfixBranchId, token)
    expect(res.statusCode).toBe(201)
    const summary = res.json()
    expect(summary).toMatchObject({ branchId: mainBranchId, authorType: 'assistant', sharedFromBranchId: bugfixBranchId, status: 'done' })
    expect(summary.content).toContain('Dev mode') // no OpenRouter key in tests

    const mainMsgs = (await app.inject({
      method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: { authorization: `Bearer ${token}` },
    })).json()
    expect(mainMsgs.at(-1).id).toBe(summary.id) // summary is the new head of main
  })

  it('share refuses a branch with no messages of its own', async () => {
    const auth = { authorization: `Bearer ${token}` }
    const mainMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: auth })).json()
    const empty = (await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: auth,
      payload: { fromMessageId: mainMsgs[0].id, model: 'test-model:free', name: 'empty' },
    })).json()
    const res = await app.inject({ method: 'POST', url: `/api/branches/${empty.id}/share`, headers: auth })
    expect(res.statusCode).toBe(400)
  })

  it('setWorking announces "<label> is working" until the agent posts', async () => {
    const claude = (await resolveToken(claudeToken))!
    const seen: any[] = []
    const onEvent = ({ event }: any) => event.type === 'typing' && seen.push(event.payload)
    bus.onSession(onEvent)
    expect(setWorking(claude, 'no-such-branch', true)).toBe(false)
    expect(setWorking(claude, mainBranchId, true)).toBe(true)
    expect(seen.at(-1)).toMatchObject({ branchId: mainBranchId, agentLabel: 'Claude' })

    await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${claudeToken}` },
      payload: { content: 'done!', triggerAi: false },
    })
    const count = seen.length
    await new Promise((r) => setTimeout(r, 3500))
    expect(seen.length).toBe(count) // pings stopped after the post
    bus.offSession(onEvent)
  }, 10000)

  it('outsiders get nothing: no context, no working indicator, no share, no mentions', async () => {
    // Mallory is signed in but never joined the session, and labels her agent token "Claude" too.
    const mallory = (await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Mallory', deviceId: 'device-mallory' },
    })).json().token
    const malloryAgentToken = (await app.inject({
      method: 'POST', url: '/api/tokens', headers: { authorization: `Bearer ${mallory}` }, payload: { label: 'Claude' },
    })).json().rawToken
    const malloryAgent = (await resolveToken(malloryAgentToken))!

    // An @Claude post in the session must not create a mention for her same-named token.
    await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { content: '@Claude one more thing', triggerAi: false },
    })
    const mentionRows = () => testDb.select().from(schema.messageMentions).all().filter((r) => r.tokenId === malloryAgent.tokenId)
    expect(mentionRows()).toEqual([])

    // Even a stray mention row for her token in this session is not returned to her.
    const someMsg = testDb.select().from(schema.messages).all().find((m) => m.sessionId === sessionId)!
    testDb.insert(schema.messageMentions).values({ messageId: someMsg.id, tokenId: malloryAgent.tokenId, createdAt: '9999' }).run()
    expect(listMentions(malloryAgent, '')).toEqual([])
    expect(await waitForMentions(malloryAgent, '', 20)).toEqual([])

    expect(await getBranchContext(malloryAgent, mainBranchId, 200)).toBeNull()
    expect(setWorking(malloryAgent, mainBranchId, true)).toBe(false)
    const share = await app.inject({
      method: 'POST', url: `/api/branches/${bugfixBranchId}/share`, headers: { authorization: `Bearer ${mallory}` },
    })
    expect(share.statusCode).toBe(404)
    const agents = await app.inject({
      method: 'GET', url: `/api/sessions/${sessionId}/agents`, headers: { authorization: `Bearer ${mallory}` },
    })
    expect(agents.statusCode).toBe(404)
  })

  it('an agent mentioning its own label does not mention itself', async () => {
    const claude = (await resolveToken(claudeToken))!
    const before = listMentions(claude, '').length
    await app.inject({
      method: 'POST', url: `/api/branches/${mainBranchId}/messages`,
      headers: { authorization: `Bearer ${claudeToken}` },
      payload: { content: 'note to self @Claude', triggerAi: false },
    })
    expect(listMentions(claude, '').length).toBe(before)
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
