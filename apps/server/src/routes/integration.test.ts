import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { healthRoute } from '../routes/health.js'
import { authRoutes } from '../routes/auth.js'
import { sessionRoutes } from '../routes/sessions.js'
import { branchRoutes } from '../routes/branches.js'
import { messageRoutes } from '../routes/messages.js'
import { docRoutes } from '../routes/docs.js'
import { buildChatContext } from '../ai/context.js'
import { searchDocs, sessionDocs } from '../services/docs.js'
import { modelsRoute } from '../routes/models.js'
import { tokenRoutes } from '../routes/tokens.js'
import { recoverStaleMessages } from '../services/messages.js'
import { resolveToken } from '../services/auth.js'
import { listMentions, waitForMentions, getBranchContext, setWorking } from '../services/agents.js'
import { bus } from '../events.js'
import { BRIEF_REFRESH_EVERY } from '../services/brief.js'
import * as openrouter from '../ai/openrouter.js'
import * as keys from '../ai/keys.js'
import { askParent } from '../services/askParent.js'
import { BRIEF_AUTO_REFRESH_AUTHOR } from '@tandem/shared'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import * as schema from '../db/schema.js'

// Override getDb to use an in-memory database for tests
import * as dbModule from '../db/index.js'
import { vi } from 'vitest'

function buildTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  // The real migrations, so a migration missing from the journal fails here
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  return db
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
  await app.register(docRoutes)
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
    // A new session has no key of its own, so its default model must be :free
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

  it('PUT /api/sessions/:id/brief: any member edits, stale saves conflict, branches see the latest brief', async () => {
    const put = (tok: string, payload: object) =>
      app.inject({ method: 'PUT', url: `/api/sessions/${sessionId}/brief`, headers: { authorization: `Bearer ${tok}` }, payload })
    const seen: any[] = []
    const onEvent = ({ event }: any) => event.type === 'brief_updated' && seen.push(event.payload)
    bus.onSession(onEvent)

    // First save starts from null; it was made after the bugfix branch forked.
    const first = await put(token, { content: 'Use Postgres.', baseUpdatedAt: null })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ brief: 'Use Postgres.', briefUpdatedBy: userId })
    const v1 = first.json().briefUpdatedAt
    expect(seen.at(-1)).toEqual({ sessionId, brief: 'Use Postgres.', briefUpdatedAt: v1, briefUpdatedBy: userId })

    // Another member edits from v1; a save still based on null (or v1 afterwards) is refused.
    expect((await put(user2Token, { content: 'Use Postgres 16.', baseUpdatedAt: v1 })).statusCode).toBe(200)
    const stale = await put(token, { content: 'Use SQLite.', baseUpdatedAt: v1 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('conflict')
    expect((await put(token, { content: 'x', baseUpdatedAt: null })).statusCode).toBe(409)

    expect((await put(token, { content: 'x'.repeat(20001), baseUpdatedAt: null })).statusCode).toBe(400)
    const mallory = (await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Mallory', deviceId: 'device-mallory-brief' },
    })).json().token
    expect((await put(mallory, { content: 'pwned', baseUpdatedAt: null })).statusCode).toBe(404)

    // A branch forked before the edits still gets the latest brief.
    const claude = (await resolveToken(claudeToken))!
    const ctx = (await getBranchContext(claude, bugfixBranchId, 200))!
    expect(ctx.brief).toBe('Use Postgres 16.')
    expect(ctx.briefUpdatedAt).not.toBe(v1)
    bus.offSession(onEvent)
  })

  it('project docs: members upload text and PDF, branches pin them, deletes unpin', async () => {
    const as = (tok: string) => ({ authorization: `Bearer ${tok}` })
    const upload = (tok: string, payload: object, sess = sessionId) =>
      app.inject({ method: 'POST', url: `/api/sessions/${sess}/docs`, headers: as(tok), payload })
    const seen: string[] = []
    const onEvent = ({ event }: any) => seen.push(event.type)
    bus.onSession(onEvent)

    const auth = await upload(token, { title: 'Auth spec', text: 'Tokens are hashed with HMAC-SHA256.' })
    expect(auth.statusCode).toBe(201)
    expect(auth.json()).toMatchObject({ title: 'Auth spec', kind: 'text', chars: 35, uploadedBy: userId })
    expect(auth.json().content).toBeUndefined()
    const pdfBase64 = readFileSync(new URL('./fixtures/deploy-spec.pdf', import.meta.url)).toString('base64')
    const pdf = await upload(user2Token, { title: 'Deploy spec', pdfBase64 })
    expect(pdf.statusCode).toBe(201)
    expect(pdf.json().kind).toBe('pdf')
    expect(seen.filter((t) => t === 'doc_created')).toHaveLength(2)

    const full = await app.inject({ method: 'GET', url: `/api/docs/${pdf.json().id}`, headers: as(token) })
    expect(full.json().content).toBe('Deploy spec: the server runs on Render with one instance.')
    const list = await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/docs`, headers: as(user2Token) })
    expect(list.json().map((d: any) => d.title)).toEqual(['Auth spec', 'Deploy spec'])

    // Bad input and outsiders
    expect((await upload(token, { title: 'Junk', pdfBase64: 'bm90IGEgcGRm' })).statusCode).toBe(400)
    expect((await upload(token, { title: 'Empty', text: '   ' })).statusCode).toBe(400)
    expect((await upload(token, { title: 'No body' })).statusCode).toBe(400)
    const mallory = (await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Mallory', deviceId: 'device-mallory-docs' },
    })).json().token
    expect((await upload(mallory, { title: 'x', text: 'x' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/api/docs/${auth.json().id}`, headers: as(mallory) })).statusCode).toBe(404)

    // Pin at creation; a doc from another session is refused
    const mainMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: as(token) })).json()
    const branch = (await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: as(token),
      payload: { fromMessageId: mainMsgs[0].id, model: 'test-model:free', name: 'auth work', docIds: [auth.json().id] },
    })).json()
    expect(branch.pinnedDocIds).toEqual([auth.json().id])
    const otherSession = (await app.inject({
      method: 'POST', url: '/api/sessions', headers: as(mallory), payload: { title: 'Other', defaultModel: 'x:free' },
    })).json().session.id
    const foreign = (await upload(mallory, { title: 'Secret', text: 'secret' }, otherSession)).json().id
    const badPin = await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: as(token),
      payload: { fromMessageId: mainMsgs[0].id, model: 'test-model:free', docIds: [foreign] },
    })
    expect(badPin.statusCode).toBe(400)

    // The owner re-pins; another member may not
    const patch = (tok: string, pinnedDocIds: string[]) =>
      app.inject({ method: 'PATCH', url: `/api/branches/${branch.id}`, headers: as(tok), payload: { pinnedDocIds } })
    expect((await patch(user2Token, [])).statusCode).toBe(403)
    const repinned = await patch(token, [auth.json().id, pdf.json().id])
    expect(repinned.json().pinnedDocIds).toEqual([auth.json().id, pdf.json().id])
    expect((await patch(token, [foreign])).statusCode).toBe(400)

    // Agents see the docs list and can search them
    const claude = (await resolveToken(claudeToken))!
    const ctx = (await getBranchContext(claude, branch.id, 200))!
    expect(ctx.docs.map((d) => d.title)).toEqual(['Auth spec', 'Deploy spec']) // both pinned, so read in full
    expect(ctx.otherDocs).toEqual([])
    expect(ctx.branch.pinnedDocIds).toHaveLength(2)
    expect(searchDocs(claude, sessionId, 'render instance', 3)[0].docId).toBe(pdf.json().id)

    // Only the uploader or the session owner deletes; deleting unpins it everywhere
    const del = (tok: string, id: string) => app.inject({ method: 'DELETE', url: `/api/docs/${id}`, headers: as(tok) })
    expect((await del(user2Token, auth.json().id)).statusCode).toBe(403)
    expect((await del(token, pdf.json().id)).statusCode).toBe(204) // owner deletes User2's doc
    const after = (await app.inject({ method: 'GET', url: `/api/sessions/${sessionId}/branches`, headers: as(token) })).json()
    expect(after.find((b: any) => b.id === branch.id).pinnedDocIds).toEqual([auth.json().id])
    expect(seen).toContain('doc_deleted')
    expect(sessionDocs(sessionId).map((d) => d.title)).toEqual(['Auth spec'])
    bus.offSession(onEvent)
  })

  it('POST /api/sessions/:id/brief/refresh rewrites the brief from main (members only)', async () => {
    const refresh = (tok: string) =>
      app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/brief/refresh`, headers: { authorization: `Bearer ${tok}` } })
    const res = await refresh(user2Token)
    expect(res.statusCode).toBe(200)
    expect(res.json().brief).toMatch(/Dev mode/) // no OPENROUTER_API_KEY in tests: the summarizer's stub
    expect(res.json().briefUpdatedBy).not.toBe(userId)
    const outsider = (await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Eve', deviceId: 'device-eve-refresh' },
    })).json().token
    expect((await refresh(outsider)).statusCode).toBe(404)
  })

  it('the brief refreshes itself every BRIEF_REFRESH_EVERY main messages; a failed attempt waits for the next batch', async () => {
    // A fresh user and session: the rate limit counts per user, and main must start with no messages.
    const guest = (await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Brief Bot Tester', deviceId: 'device-brief-auto' },
    })).json().token
    const created = (await app.inject({
      method: 'POST', url: '/api/sessions', headers: { authorization: `Bearer ${guest}` },
      payload: { title: 'Auto brief', defaultModel: 'openai/gpt-4o-mini:free' },
    })).json()
    const postToMain = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await app.inject({
          method: 'POST', url: `/api/branches/${created.mainBranch.id}/messages`,
          headers: { authorization: `Bearer ${guest}` }, payload: { content: `update ${i}`, triggerAi: false },
        })
      }
    }
    const getBrief = async () => (await app.inject({
      method: 'GET', url: `/api/sessions/${created.session.id}`, headers: { authorization: `Bearer ${guest}` },
    })).json().session

    // Without a model it never runs, so the dev stub cannot overwrite a hand-written brief.
    const summarize = vi.spyOn(openrouter, 'summarize').mockRejectedValue(new Error('model down'))
    await postToMain(BRIEF_REFRESH_EVERY)
    expect(summarize).not.toHaveBeenCalled()

    // With a model: the threshold was already reached, so the next main message starts a refresh.
    const configured = vi.spyOn(openrouter, 'aiConfigured').mockReturnValue(true)
    try {
      await postToMain(1)
      expect(summarize).toHaveBeenCalledTimes(1)
      // It failed. The next messages do not call the model again until another full batch lands.
      await postToMain(BRIEF_REFRESH_EVERY - 1)
      expect(summarize).toHaveBeenCalledTimes(1)
      summarize.mockResolvedValue('Team is shipping the auto brief.')
      await postToMain(1)
      expect(summarize).toHaveBeenCalledTimes(2)
      await vi.waitFor(async () => expect((await getBrief()).brief).toBe('Team is shipping the auto brief.'))
      expect((await getBrief()).briefUpdatedBy).toBe(BRIEF_AUTO_REFRESH_AUTHOR)
      // A successful refresh resets the count.
      await postToMain(BRIEF_REFRESH_EVERY - 1)
      expect(summarize).toHaveBeenCalledTimes(2)
    } finally {
      configured.mockRestore()
      summarize.mockRestore()
    }
  })

  it('project docs: members write and edit with conflict checks; main reads every doc, branches copy their parent\'s pins', async () => {
    const auth = (tok: string) => ({ authorization: `Bearer ${tok}` })
    const create = (tok: string, title: string, text: string) =>
      app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/docs`, headers: auth(tok), payload: { title, text } })
    const edit = (tok: string, id: string, payload: object) =>
      app.inject({ method: 'PUT', url: `/api/docs/${id}`, headers: auth(tok), payload })
    const user2Id = (await resolveToken(user2Token))!.userId
    const seen: any[] = []
    const onEvent = ({ event }: any) => event.type.startsWith('doc_') && seen.push(event)
    bus.onSession(onEvent)

    const arch = (await create(token, 'ARCHITECTURE.md', '# Arch v1')).json()
    const todo = (await create(user2Token, 'TODO.md', '- [ ] UI')).json()
    expect(arch).toMatchObject({ title: 'ARCHITECTURE.md', kind: 'text', updatedBy: userId })
    expect(arch.updatedAt).toBe(arch.createdAt)

    // Saving from an outdated version is refused; any member may edit.
    const v2 = await edit(user2Token, arch.id, { content: '# Arch v2', baseUpdatedAt: arch.updatedAt })
    expect(v2.statusCode).toBe(200)
    expect(v2.json()).toMatchObject({ content: '# Arch v2', updatedBy: user2Id })
    expect(seen.at(-1)).toMatchObject({ type: 'doc_updated', payload: { id: arch.id, chars: 9 } })
    expect(seen.at(-1).payload.content).toBeUndefined()
    expect((await edit(token, arch.id, { content: 'stale', baseUpdatedAt: arch.updatedAt })).statusCode).toBe(409)
    const renamed = await edit(token, arch.id, { title: 'ARCH.md', content: '# Arch v3', baseUpdatedAt: v2.json().updatedAt })
    expect(renamed.json().title).toBe('ARCH.md')

    // A branch from main pins every doc by default; a sub-branch copies its parent's pins.
    const mainMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: auth(token) })).json()
    const fromMessageId = mainMsgs.at(-1).id
    const branch = (body: object) => app.inject({ method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: auth(token), payload: body })
    const everything = (await branch({ fromMessageId, model: 'test-model:free', name: 'backend' })).json()
    expect(everything.pinnedDocIds).toEqual(expect.arrayContaining([arch.id, todo.id]))
    const frontend = (await branch({ fromMessageId, model: 'test-model:free', name: 'frontend', docIds: [todo.id] })).json()
    await app.inject({
      method: 'POST', url: `/api/branches/${frontend.id}/messages`, headers: auth(token), payload: { content: 'login form next', triggerAi: false },
    })
    const frontMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${frontend.id}/messages`, headers: auth(token) })).json()
    const login = (await branch({ fromMessageId: frontMsgs.at(-1).id, model: 'test-model:free', name: 'login' })).json()
    expect(login.pinnedDocIds).toEqual([todo.id])

    // Agents get pinned docs in full and the rest listed; main reads every doc, always the latest text.
    const claude = (await resolveToken(claudeToken))!
    const ctx = (await getBranchContext(claude, frontend.id, 200))!
    expect(ctx.docs.map((d) => d.title)).toEqual(['TODO.md'])
    expect(ctx.otherDocs.map((d) => d.title)).toContain('ARCH.md')
    const mainCtx = (await getBranchContext(claude, mainBranchId, 200))!
    expect(mainCtx.docs.find((d) => d.id === arch.id)!.content).toBe('# Arch v3')
    expect(mainCtx.otherDocs).toEqual([])

    // Outsiders can neither read nor edit.
    const outsider = (await app.inject({
      method: 'POST', url: '/api/auth/guest', payload: { displayName: 'Eve', deviceId: 'device-eve-docs' },
    })).json().token
    expect((await edit(outsider, todo.id, { content: 'x', baseUpdatedAt: todo.updatedAt })).statusCode).toBe(404)
    bus.offSession(onEvent)
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

  it('session key: only the owner sets or removes it, and only its last four characters leave the server', async () => {
    const url = `/api/sessions/${sessionId}/key`
    const call = (method: 'GET' | 'PUT' | 'DELETE', tok: string, payload?: object) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${tok}` }, payload })
    const rawKey = 'sk-or-v1-secretsecretsecret9xyz'
    const verify = vi.spyOn(keys, 'verifyOpenRouterKey').mockResolvedValue(true)
    const seen: any[] = []
    const onEvent = ({ event }: any) => event.type === 'session_key_updated' && seen.push(event.payload)
    bus.onSession(onEvent)
    try {
      expect((await call('GET', user2Token)).json()).toMatchObject({ hasKey: false, keyLast4: null })
      expect((await call('PUT', token, { key: 'not-a-key' })).statusCode).toBe(400)
      expect((await call('PUT', user2Token, { key: rawKey })).statusCode).toBe(403)

      const set = await call('PUT', token, { key: rawKey })
      expect(set.statusCode).toBe(200)
      expect(set.json()).toMatchObject({ hasKey: true, keyLast4: '9xyz', setBy: userId })
      expect(set.body).not.toContain(rawKey)
      expect((await call('GET', user2Token)).json()).toMatchObject({ hasKey: true, keyLast4: '9xyz' })
      expect(JSON.stringify(seen)).not.toContain(rawKey)
      const stored = testDb.select().from(schema.sessionKeys).all()
      expect(JSON.stringify(stored)).not.toContain(rawKey)
      expect(keys.apiKeyFor(sessionId)).toEqual({ apiKey: rawKey, byok: true })

      // With its own key the session may use paid models; without one, only :free.
      const mainMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: { authorization: `Bearer ${token}` } })).json()
      const paidBranch = () => app.inject({
        method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: { authorization: `Bearer ${token}` },
        payload: { fromMessageId: mainMsgs[0].id, model: 'openai/gpt-4o-mini', name: 'paid' },
      })
      const paid = await paidBranch()
      expect(paid.statusCode).toBe(201)
      const patchModel = (model: string) => app.inject({
        method: 'PATCH', url: `/api/branches/${paid.json().id}`, headers: { authorization: `Bearer ${token}` }, payload: { model },
      })
      expect((await patchModel('anthropic/claude-sonnet-4')).statusCode).toBe(200)

      verify.mockResolvedValue(false)
      expect((await call('PUT', token, { key: 'sk-or-v1-wrong' })).json().error.code).toBe('invalid_key')

      expect((await call('DELETE', user2Token)).statusCode).toBe(403)
      expect((await call('DELETE', token)).json()).toMatchObject({ hasKey: false })
      expect(keys.apiKeyFor(sessionId).byok).toBe(false)
      expect((await paidBranch()).statusCode).toBe(400)
      expect((await patchModel('openai/gpt-4o')).statusCode).toBe(400)
      expect((await patchModel('test-model:free')).statusCode).toBe(200)
      expect(seen.map((e) => e.hasKey)).toEqual([true, false])
    } finally {
      bus.offSession(onEvent)
      verify.mockRestore()
      keys.deleteSessionKey(sessionId) // later tests must not run on a key
    }
  })

  it('a branch forked late does not inherit main\'s earlier history, and keeps its purpose', async () => {
    const auth = { authorization: `Bearer ${token}` }
    for (let i = 1; i <= 8; i++) {
      await app.inject({ method: 'POST', url: `/api/branches/${mainBranchId}/messages`, headers: auth, payload: { content: `plan ${i}`, triggerAi: false } })
    }
    const mainMsgs = (await app.inject({ method: 'GET', url: `/api/branches/${mainBranchId}/messages`, headers: auth })).json()
    const res = await app.inject({
      method: 'POST', url: `/api/sessions/${sessionId}/branches`, headers: auth,
      payload: { fromMessageId: mainMsgs.at(-1).id, model: 'test-model:free', name: 'frontend', purpose: 'Frontend: settings page' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ purpose: 'Frontend: settings page', branchContext: null })

    const ctx = (await getBranchContext((await resolveToken(claudeToken))!, res.json().id, 200))!
    expect(ctx.purpose).toBe('Frontend: settings page')
    expect(ctx.messages.map((m) => m.content)).toEqual(['plan 3', 'plan 4', 'plan 5', 'plan 6', 'plan 7', 'plan 8'])
    expect(ctx.messages.map((m) => m.content)).not.toContain('Hello integration test!')
  })

  it('PUT /api/branches/:id/context: owner only, stale saves conflict, main has none', async () => {
    const put = (branchId: string, tok: string, payload: object) =>
      app.inject({ method: 'PUT', url: `/api/branches/${branchId}/context`, headers: { authorization: `Bearer ${tok}` }, payload })
    expect((await put(bugfixBranchId, user2Token, { content: 'x', baseUpdatedAt: null })).statusCode).toBe(403)
    expect((await put(mainBranchId, token, { content: 'x', baseUpdatedAt: null })).statusCode).toBe(400)

    const first = await put(bugfixBranchId, token, { content: '- Fix the login bug [Alice in main, Oct 2]', baseUpdatedAt: null })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ branchContext: '- Fix the login bug [Alice in main, Oct 2]', branchContextUpdatedBy: userId })
    expect((await put(bugfixBranchId, token, { content: 'stale', baseUpdatedAt: null })).statusCode).toBe(409)
    expect((await put(bugfixBranchId, token, { content: 'next', baseUpdatedAt: first.json().branchContextUpdatedAt })).statusCode).toBe(200)

    const regen = await app.inject({ method: 'POST', url: `/api/branches/${bugfixBranchId}/context/regenerate`, headers: { authorization: `Bearer ${token}` } })
    expect(regen.json().error.code).toBe('no_model') // no OpenRouter key in tests
  })

  it('askParent records the question and answer in the asking branch (owner only, never main)', async () => {
    const claude = (await resolveToken(claudeToken))!
    const result = await askParent(claude, bugfixBranchId, 'Which database did we pick?')
    expect(result.answeredBy).toEqual({ branchId: mainBranchId, branchName: 'main' })
    expect(result.answer).toContain('Dev mode') // no OpenRouter key in tests
    expect(result.message).toMatchObject({ branchId: bugfixBranchId, kind: 'ask_parent', askQuestion: 'Which database did we pick?', askedBranchId: mainBranchId })

    const msgs = (await app.inject({ method: 'GET', url: `/api/branches/${bugfixBranchId}/messages`, headers: { authorization: `Bearer ${token}` } })).json()
    expect(msgs.at(-1).id).toBe(result.message.id) // the new head of the branch
    await expect(askParent(claude, mainBranchId, 'q')).rejects.toMatchObject({ status: 400 })
    await expect(askParent((await resolveToken(user2Token))!, bugfixBranchId, 'q')).rejects.toMatchObject({ status: 403 })
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
