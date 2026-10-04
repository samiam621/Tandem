import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { resolveToken } from '../services/auth.js'
import type { Actor } from '../services/auth.js'
import { listSessions, getSession, getSessionBranches } from '../services/sessions.js'
import { getBranchMessages, postMessage } from '../services/messages.js'
import { createBranch } from '../services/branches.js'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { messages, users } from '../db/schema.js'

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
    'List available AI models that can be used when creating branches or sessions.',
    {},
    async () => {
      const key = process.env.OPENROUTER_API_KEY
      if (!key) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify([
              { id: 'openai/gpt-4o', name: 'GPT-4o' },
              { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
              { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            ]),
          }],
        }
      }
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      })
      const data = (await res.json()) as { data: { id: string; name: string }[] }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(data.data.map((m) => ({ id: m.id, name: m.name }))),
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
