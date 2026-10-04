import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { resolveToken } from '../services/auth.js'
import type { Actor } from '../services/auth.js'
import { listSessions, getSession, getSessionBranches } from '../services/sessions.js'
import { getBranchMessages, postMessage, shareBranch } from '../services/messages.js'
import { createBranch } from '../services/branches.js'
import { waitForMentions, getBranchContext, setWorking } from '../services/agents.js'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { messages, users } from '../db/schema.js'
import { fetchFreeModels, isFreeModelId } from '../ai/models.js'

// Build a new McpServer per request with the actor closed over.
// This is stateless mode — no session persistence across requests.
function buildMcpServer(actor: Actor) {
  const server = new McpServer({ name: 'tandem', version: '0.1.0' })

  // ─── list_sessions ────────────────────────────────────────────────────────
  server.tool(
    'list_sessions',
    'List all sessions you are a member of. Returns id, title, defaultModel.',
    {},
    async () => {
      const sess = await listSessions(actor.userId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(sess) }] }
    },
  )

  // ─── get_session ──────────────────────────────────────────────────────────
  server.tool(
    'get_session',
    'Get details about a session: members with online status, and branches with owner and model.',
    { sessionId: z.string().describe('The session ID') },
    async ({ sessionId }) => {
      const data = await getSession(actor, sessionId)
      if (!data) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }] }
      const branchList = await getSessionBranches(actor, sessionId) ?? []
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...data, branches: branchList }) }] }
    },
  )

  // ─── read_branch ──────────────────────────────────────────────────────────
  server.tool(
    'read_branch',
    'Read the conversation in a branch of a multiplayer chat session. Use this to catch up on what your team discussed before acting. Returns messages oldest-first.',
    {
      branchId: z.string().describe('The branch ID'),
      limit: z.number().int().positive().default(50).describe('Max messages to return (newest)'),
    },
    async ({ branchId, limit }) => {
      const msgs = await getBranchMessages(actor, branchId)
      if (!msgs) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }] }

      const db = getDb()
      const userRows = db.select().from(users).all()
      const userById = new Map(userRows.map((u) => [u.id, u]))

      const sliced = msgs.slice(-limit)
      const result = sliced.map((m) => ({
        id: m.id,
        authorType: m.authorType,
        authorDisplayName: userById.get(m.authorId)?.displayName ?? m.authorId,
        model: m.model,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt,
      }))
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    },
  )

  // ─── post_message ─────────────────────────────────────────────────────────
  server.tool(
    'post_message',
    'Post a message to a branch. Messages from agent tokens appear with an agent label. Set triggerAi=true to request an AI reply and wait for it.',
    {
      branchId: z.string().describe('The branch ID'),
      content: z.string().describe('The message text'),
      triggerAi: z.boolean().default(false).describe('Whether to trigger an AI reply'),
    },
    async ({ branchId, content, triggerAi }) => {
      try {
        const result = await postMessage(actor, branchId, content, triggerAi)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.userMessage) }] }
      } catch (err: unknown) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] }
      }
    },
  )

  // ─── wait_for_mentions ────────────────────────────────────────────────────
  server.tool(
    'wait_for_mentions',
    'Wait until a teammate @mentions you (your agent token label) in a Tandem session. Call this in a loop: pass the returned cursor back as `since` so no mention is missed. Returns as soon as there is a mention, or an empty list after the timeout; then call it again. For each mention, call get_branch_context, then set_working, then reply with post_message on that branch.',
    {
      since: z.string().optional().describe('Cursor from the previous call. Omit on the first call to wait for new mentions only.'),
      timeoutSeconds: z.number().int().min(1).max(50).default(25).describe('How long to wait before returning an empty list'),
    },
    async ({ since, timeoutSeconds }) => {
      const from = since ?? new Date().toISOString()
      const mentions = await waitForMentions(actor, from, timeoutSeconds * 1000)
      const cursor = mentions.length ? mentions[mentions.length - 1].createdAt : from
      return { content: [{ type: 'text' as const, text: JSON.stringify({ mentions, cursor }) }] }
    },
  )

  // ─── get_branch_context ───────────────────────────────────────────────────
  server.tool(
    'get_branch_context',
    "Get everything you need before working on a branch: its whole conversation from the session's start through the fork point (oldest first), who owns it and which branch it split from, and the session's other branches. Call this after being mentioned and before replying, so you are on the same page as the team.",
    {
      branchId: z.string().describe('The branch ID'),
      limit: z.number().int().min(1).max(500).default(200).describe('Max messages to return (newest kept)'),
    },
    async ({ branchId, limit }) => {
      const context = await getBranchContext(actor, branchId, limit)
      return { content: [{ type: 'text' as const, text: JSON.stringify(context ?? { error: 'not_found' }) }] }
    },
  )

  // ─── set_working ──────────────────────────────────────────────────────────
  server.tool(
    'set_working',
    'Show teammates that you are working on a branch ("<your label> is working…"). Call with working=true when you start on a mention. It clears automatically when you post_message to that branch, or after 5 minutes; call with working=false to clear it early.',
    {
      branchId: z.string().describe('The branch ID'),
      working: z.boolean().default(true),
    },
    async ({ branchId, working }) => {
      const ok = setWorking(actor, branchId, working)
      return { content: [{ type: 'text' as const, text: JSON.stringify(ok ? { ok: true } : { error: 'not_found' }) }] }
    },
  )

  // ─── share_to_main ────────────────────────────────────────────────────────
  server.tool(
    'share_to_main',
    "Post an AI summary of a branch's work (everything since it split from main) into the main thread, so the whole team is on the same page. Use it when work on a branch reaches a result worth sharing. Only works on branches owned by your token's user.",
    { branchId: z.string().describe('The branch ID to summarize') },
    async ({ branchId }) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await shareBranch(actor, branchId)) }] }
      } catch (err: unknown) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }] }
      }
    },
  )

  // ─── create_branch ────────────────────────────────────────────────────────
  server.tool(
    'create_branch',
    'Create a new branch from a specific message.',
    {
      fromMessageId: z.string().describe('The message ID to branch from'),
      model: z.string().describe('AI model ID for this branch'),
      name: z.string().optional().describe('Optional branch name'),
    },
    async ({ fromMessageId, model, name }) => {
      if (!isFreeModelId(model)) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'free_model_required', message: 'Select an OpenRouter model with the :free suffix.' }) }] }
      }
      const db = getDb()
      const msg = db.select().from(messages).where(eq(messages.id, fromMessageId)).get()
      if (!msg) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'message_not_found' }) }] }
      const branch = await createBranch(actor, msg.sessionId, fromMessageId, model, name)
      if (!branch) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }] }
      return { content: [{ type: 'text' as const, text: JSON.stringify(branch) }] }
    },
  )

  // ─── list_models ──────────────────────────────────────────────────────────
  server.tool(
    'list_models',
    'List free AI models that can be used when creating branches or sessions.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(await fetchFreeModels()),
        }],
      }
    },
  )

  return server
}

// ─── Fastify plugin ───────────────────────────────────────────────────────────

export const mcpHandler: FastifyPluginAsync = async (app) => {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    // Authenticate
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Missing token' } })
    }
    const actor = await resolveToken(header.slice(7))
    if (!actor) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Invalid token' } })
    }

    // Build a per-request server with the actor in the closure
    const mcpServer = buildMcpServer(actor)

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session persistence
    })

    await mcpServer.server.connect(transport)

    try {
      await transport.handleRequest(req.raw, reply.raw, req.body)
      reply.hijack()
    } catch (err) {
      if (!reply.sent) {
        reply.code(500).send({ error: { code: 'server_error', message: String(err) } })
      }
    }
  }

  app.post('/mcp', handler)
  app.get('/mcp', handler)
  app.delete('/mcp', handler)
}
