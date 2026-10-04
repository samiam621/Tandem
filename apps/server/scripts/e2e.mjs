// End-to-end check against a running Tandem server: REST, live WebSocket events, and the MCP
// tools Claude uses. Creates two guests and a session on the target server. Needs Node 22+.
// Usage: node apps/server/scripts/e2e.mjs [server URL, default http://localhost:3000]

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')
const json = { 'content-type': 'application/json' }
const call = async (path, token, body) => {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}
const mcp = async (token, name, args) => {
  const res = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { ...json, accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))
  return JSON.parse(JSON.parse(line.slice(6)).result.content[0].text)
}
const ok = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1 }

console.log(`Checking ${base}`)
const sam = (await call('/api/auth/guest', null, { displayName: 'Sam', deviceId: 'e2e-sam-' + Date.now() })).body.token
const alex = (await call('/api/auth/guest', null, { displayName: 'Alex', deviceId: 'e2e-alex-' + Date.now() })).body.token
const created = (await call('/api/sessions', sam, { title: 'Public E2E', defaultModel: 'anthropic/claude-sonnet-4' })).body
const sessionId = created.session.id, main = created.mainBranch.id
ok('Alex joins with the invite code', (await call('/api/sessions/join', alex, { inviteCode: created.session.inviteCode })).status === 200)

// Alex listens on the WebSocket like the desktop app does.
// Auth and join_session are sent back to back, exactly as the desktop app does.
const listen = async (token) => {
  const socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws')
  const received = []
  socket.addEventListener('message', (e) => received.push(JSON.parse(e.data)))
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', payload: { token } }))
      socket.send(JSON.stringify({ type: 'join_session', payload: { sessionId } }))
      setTimeout(resolve, 1500)
    })
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to connect')))
  })
  return { socket, received }
}
const { socket: ws, received: events } = await listen(alex)
// Mallory is signed in but not a member; she must not receive this session's live events.
const mallory = (await call('/api/auth/guest', null, { displayName: 'Mallory', deviceId: 'e2e-mallory-' + Date.now() })).body.token
const { socket: malloryWs, received: malloryEvents } = await listen(mallory)

const claude = (await call('/api/tokens', sam, { label: 'Claude' })).body.rawToken
const waiting = mcp(claude, 'wait_for_mentions', { timeoutSeconds: 20 })
await new Promise((r) => setTimeout(r, 1500))
await call(`/api/branches/${main}/messages`, sam, { content: '@Claude what is the plan?', triggerAi: true })
const { mentions } = await waiting
ok('Claude (MCP) receives the @mention', mentions.length === 1 && mentions[0].content === '@Claude what is the plan?')

const ctx = await mcp(claude, 'get_branch_context', { branchId: main })
ok('Claude reads the branch context', ctx.messages.at(-1).content === '@Claude what is the plan?')
await mcp(claude, 'set_working', { branchId: main })
const reply = await mcp(claude, 'post_message', { branchId: main, content: 'Plan: ship it.' })
ok('Claude replies, labelled "Claude"', reply.agentLabel === 'Claude')

// Sam branches off from Claude's reply, works there, and shares the result back to main.
const branch = (await call(`/api/sessions/${sessionId}/branches`, sam, { fromMessageId: reply.id, model: 'anthropic/claude-sonnet-4', name: 'e2e-branch' })).body
await call(`/api/branches/${branch.id}/messages`, sam, { content: 'Tried it on the branch: works.', triggerAi: false })
const shared = await call(`/api/branches/${branch.id}/share`, sam, {})
ok('Share to main posts a summary into main', shared.status === 201 && shared.body.branchId === main && shared.body.sharedFromBranchId === branch.id)

await new Promise((r) => setTimeout(r, 1500))
ws.close()
malloryWs.close()
const seen = events.filter((e) => e.type === 'message_created').map((e) => e.payload.content)
ok('Alex sees the mention live over WebSocket', seen.includes('@Claude what is the plan?'))
ok('Alex sees Claude\'s reply live over WebSocket', seen.includes('Plan: ship it.'))
ok('Alex sees "Claude is working…"', events.some((e) => e.type === 'typing' && e.payload.agentLabel === 'Claude'))
ok('No built-in AI reply to the @mention', !events.some((e) => e.type === 'message_created' && e.payload.authorType === 'assistant' && !e.payload.sharedFromBranchId))
ok('Alex sees the shared summary live in main', events.some((e) => e.type === 'message_created' && e.payload.sharedFromBranchId === branch.id))
ok('A non-member gets none of the session\'s live events', malloryEvents.length === 0)
