import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { resolveToken } from '../services/auth.js'
import type { Actor } from '../services/auth.js'
import { listSessions, getSession, getSessionBranches, updateBrief, isSessionMember } from '../services/sessions.js'
import { BRIEF_MAX_CHARS, DOC_MAX_CHARS, UploadDocSchema } from '@tandem/shared'
import { refreshBrief } from '../services/brief.js'
import { getBranchMessages, postMessage, shareBranch } from '../services/messages.js'
import { createBranch } from '../services/branches.js'
import { waitForMentions, getBranchContext, setWorking } from '../services/agents.js'
import { listDocs, getDoc, searchDocs, uploadDoc, updateDoc } from '../services/docs.js'
import { askParent } from '../services/askParent.js'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { messages, users } from '../db/schema.js'
import { listModels } from '../ai/models.js'
import { hasSessionKey } from '../ai/keys.js'

// Tool results are JSON text. A service failure is returned as { error: message } so the agent can
// read it and react, instead of failing the tool call.
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

async function jsonOrError(run: () => unknown) {
  try {
    return json(await run())
  } catch (err: unknown) {
    return json({ error: err instanceof Error ? err.message : String(err) })
  }
}

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
      return json(sess)
    },
  )

  // ─── get_session ──────────────────────────────────────────────────────────
  server.tool(
    'get_session',
    'Get details about a session: members with online status, and branches with owner and model.',
    { sessionId: z.string().describe('The session ID') },
    async ({ sessionId }) => {
      const data = await getSession(actor, sessionId)
      if (!data) return json({ error: 'not_found' })
      const branchList = await getSessionBranches(actor, sessionId) ?? []
      return json({ ...data, branches: branchList })
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
      if (!msgs) return json({ error: 'not_found' })

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
      return json(result)
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
      return jsonOrError(async () => (await postMessage(actor, branchId, content, triggerAi)).userMessage)
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
      return json({ mentions, cursor })
    },
  )

  // ─── get_branch_context ───────────────────────────────────────────────────
  server.tool(
    'get_branch_context',
    "Get everything you need before working on a branch: the brief (a summary of the main thread: direction, decisions, who is on what), the project docs this branch reads (specs such as ARCHITECTURE.md or TODO.md, in full; main reads every doc) plus a list of the others (read them with read_project_doc or search_project_docs), the branch's purpose and branch context (a cited summary of what it needs from the conversation it split off from), the last few messages before the fork and the branch's own messages (oldest first; main returns its whole conversation), who owns it and which branch it split from, and the session's other branches. Call this after being mentioned and before replying, so you are on the same page as the team. If something you need is missing, use ask_parent.",
    {
      branchId: z.string().describe('The branch ID'),
      limit: z.number().int().min(1).max(500).default(200).describe('Max messages to return (newest kept)'),
    },
    async ({ branchId, limit }) => {
      const context = await getBranchContext(actor, branchId, limit)
      return json(context ?? { error: 'not_found' })
    },
  )

  // ─── ask_parent ───────────────────────────────────────────────────────────
  server.tool(
    'ask_parent',
    "Ask the branch this branch split off from about something its context leaves out: a decision, a constraint, what someone said. The parent branch's AI answers from its full live history with sources in [brackets], and asks its own parent if it does not know, up to main. The question and answer are recorded in the branch so teammates see them. Use it instead of guessing about project decisions. Only works on branches owned by your token's user, and not on main.",
    {
      branchId: z.string().describe('The branch that is asking'),
      question: z.string().min(1).max(2000).describe('One specific question'),
    },
    async ({ branchId, question }) => {
      return jsonOrError(async () => {
        const { answer, answeredBy } = await askParent(actor, branchId, question)
        return { answer, answeredBy }
      })
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
      return json(ok ? { ok: true } : { error: 'not_found' })
    },
  )

  // ─── share_to_main ────────────────────────────────────────────────────────
  server.tool(
    'share_to_main',
    "Post an AI summary of a branch's work (everything since it split from main) into the main thread, so the whole team is on the same page. Use it when work on a branch reaches a result worth sharing. Only works on branches owned by your token's user.",
    { branchId: z.string().describe('The branch ID to summarize') },
    async ({ branchId }) => {
      return jsonOrError(() => shareBranch(actor, branchId))
    },
  )

  // ─── update_brief ─────────────────────────────────────────────────────────
  server.tool(
    'update_brief',
    "Replace the session's brief: the short markdown summary of the main thread (direction, decisions, who is on what) that every branch's AI reads. Use it to record a decision every workstream should know; put specs in a project doc instead (write_project_doc). Read it first with get_branch_context, edit the full text, and pass its briefUpdatedAt as baseUpdatedAt; if a teammate saved in between you get a conflict error, so read it again and reapply your change. To have AI rewrite it from main's latest messages, use refresh_brief.",
    {
      sessionId: z.string().describe('The session ID'),
      content: z.string().max(BRIEF_MAX_CHARS).describe('The full new brief, in markdown'),
      baseUpdatedAt: z.string().nullable().describe('briefUpdatedAt from get_branch_context (null if the brief was never set)'),
    },
    async ({ sessionId, content, baseUpdatedAt }) => {
      return jsonOrError(() => updateBrief(actor, sessionId, content, baseUpdatedAt))
    },
  )

  // ─── refresh_brief ────────────────────────────────────────────────────────
  server.tool(
    'refresh_brief',
    "Have AI rewrite the session's brief from the current brief and the main thread's latest messages. Use it after an important discussion in main, so every branch picks up the new direction. Returns the session with the new brief.",
    { sessionId: z.string().describe('The session ID') },
    async ({ sessionId }) => {
      return jsonOrError(() => refreshBrief(actor, sessionId))
    },
  )

  // ─── Project docs ─────────────────────────────────────────────────────────
  server.tool(
    'list_project_docs',
    "List the session's project docs: specs, docs and decisions the team wrote or uploaded. Returns id, title, kind, size and updatedAt, not content. Use it to see what reference material exists before reading or searching it.",
    { sessionId: z.string().describe('The session ID') },
    async ({ sessionId }) => jsonOrError(() => listDocs(actor, sessionId)),
  )

  server.tool(
    'read_project_doc',
    'Read a project doc by id, in slices for long docs. Use it when list_project_docs or search_project_docs points to a doc you need in full. Returns title, the text from offset, totalChars so you can read the next slice, and updatedAt (pass it to write_project_doc when you edit).',
    {
      docId: z.string().describe('The doc ID'),
      offset: z.number().int().min(0).default(0).describe('Character offset to start from'),
      limit: z.number().int().min(1).max(20000).default(20000).describe('Max characters to return'),
    },
    async ({ docId, offset, limit }) => jsonOrError(() => {
      const { content, ...doc } = getDoc(actor, docId)
      return { ...doc, offset, text: content.slice(offset, offset + limit), totalChars: content.length }
    }),
  )

  server.tool(
    'search_project_docs',
    "Keyword-search the session's project docs and return the best-matching passages with their doc id and title. Use it when your branch is missing a spec, decision or detail that likely lives in main's docs, instead of guessing.",
    {
      sessionId: z.string().describe('The session ID'),
      query: z.string().min(1).describe('Keywords for what you are looking for'),
      k: z.number().int().min(1).max(10).default(5).describe('Max passages to return'),
    },
    async ({ sessionId, query, k }) => jsonOrError(() => searchDocs(actor, sessionId, query, k)),
  )

  server.tool(
    'write_project_doc',
    "Create a project doc, or replace one's text, e.g. tick off items in TODO.md or record a spec change in ARCHITECTURE.md. Every branch that reads the doc sees the new version on its next reply. To create, omit docId. To edit, read it first and pass its updatedAt as baseUpdatedAt; if a teammate saved in between you get a conflict error, so read it again and reapply your change.",
    {
      sessionId: z.string().describe('The session ID'),
      docId: z.string().optional().describe('The doc to replace; omit to create a new doc'),
      title: UploadDocSchema.options[0].shape.title.optional().describe('Doc title, e.g. TODO.md; required to create'),
      content: z.string().min(1).max(DOC_MAX_CHARS).describe('The full new text, in markdown'),
      baseUpdatedAt: z.string().optional().describe('updatedAt of the version you edited; required to edit'),
    },
    async ({ sessionId, docId, title, content, baseUpdatedAt }) => jsonOrError(() => {
      if (!docId) {
        if (!title) return { error: 'title is required to create a doc' }
        return uploadDoc(actor, sessionId, { title, text: content })
      }
      if (!baseUpdatedAt) return { error: 'baseUpdatedAt is required to edit a doc; read it first' }
      const { content: text, ...doc } = updateDoc(actor, docId, { title, content, baseUpdatedAt })
      return { ...doc, chars: text.length }
    }),
  )

  // ─── create_branch ────────────────────────────────────────────────────────
  server.tool(
    'create_branch',
    "Create a new branch from a specific message. The branch does not inherit the parent's whole conversation: AI writes it a cited branch context for its purpose, plus it keeps the last few messages before the fork. The branch's AI reads its pinned project docs in full and gets excerpts of the rest. A paid model works only when the session has its own OpenRouter key.",
    {
      fromMessageId: z.string().describe('The message ID to branch from'),
      model: z.string().min(1).describe('OpenRouter model ID from list_models'),
      name: z.string().optional().describe('Optional branch name'),
      purpose: z.string().max(500).optional().describe('What the branch is for, e.g. "Frontend: settings page". Its context is written for this.'),
      docIds: z.array(z.string()).max(100).optional().describe('Project doc IDs (from list_project_docs) to pin; the branch AI reads pinned docs in full. Omit to copy the parent branch\'s pins (every doc when branching from main).'),
    },
    async ({ fromMessageId, model, name, purpose, docIds }) => {
      const db = getDb()
      const msg = db.select().from(messages).where(eq(messages.id, fromMessageId)).get()
      if (!msg) return json({ error: 'message_not_found' })
      return jsonOrError(async () => {
        const branch = await createBranch(actor, msg.sessionId, fromMessageId, model, name, docIds, purpose?.trim() || undefined)
        return branch ?? { error: 'not_found' }
      })
    },
  )

  // ─── list_models ──────────────────────────────────────────────────────────
  server.tool(
    'list_models',
    "List the AI models a session can use: free models, or every model when the session has its own OpenRouter key. Omit sessionId for the free list (what a new session can use).",
    { sessionId: z.string().optional().describe('The session the model is for') },
    async ({ sessionId }) => {
      return jsonOrError(async () => {
        const byok = Boolean(sessionId && isSessionMember(sessionId, actor.userId) && hasSessionKey(sessionId))
        return listModels(byok)
      })
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
