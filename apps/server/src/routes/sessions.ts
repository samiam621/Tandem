import type { FastifyPluginAsync } from 'fastify'
import { CreateSessionSchema, JoinSessionSchema, CreateBranchSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import {
  createSession,
  listSessions,
  getSession,
  joinSession,
  getSessionBranches,
  listSessionAgents,
  lookupInviteCode,
} from '../services/sessions.js'
import { createBranch, getSessionTree } from '../services/branches.js'

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sessions — creates a new session; FreeModelIdSchema in CreateSessionSchema rejects paid models
  app.post('/api/sessions', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateSessionSchema.safeParse(req.body)
    if (!body.success) {
      // Zod failures include the :free check, so the code is always invalid_request
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await createSession(req.actor!, body.data.title, body.data.defaultModel)
    return reply.code(201).send(result)
  })

  // GET /api/sessions
  app.get('/api/sessions', { preHandler: requireAuth }, async (req, reply) => {
    const data = await listSessions(req.actor!.userId)
    return reply.send(data)
  })

  // GET /api/sessions/:id
  app.get('/api/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const data = await getSession(req.actor!, id)
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'Session not found' } })
    return reply.send(data)
  })

  // GET /api/sessions/join/:code — browser-friendly invite link; redirects into the desktop app
  app.get('/api/sessions/join/:code', async (req, reply) => {
    const { code } = req.params as { code: string }
    const exists = await lookupInviteCode(code)
    if (!exists) return reply.code(404).send({ error: { code: 'not_found', message: 'Invalid invite code' } })

    const deepLink = `tandem://join/${code}`
    const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000'
    const html = `<!DOCTYPE html>
<html>
<head><title>Join Tandem session</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:20px">
<h2>Opening Tandem…</h2>
<p>If the app doesn't open automatically, copy this code and paste it into <strong>Tandem → Join</strong>:</p>
<code style="font-size:1.2em;background:#f0f0f0;padding:8px 16px;border-radius:4px;display:inline-block;margin:16px 0">${code}</code>
<p><a href="${deepLink}">Open Tandem</a></p>
<script>window.location.href = "${deepLink}"</script>
</body>
</html>`
    return reply.header('Content-Type', 'text/html').send(html)
  })

  // POST /api/sessions/join
  app.post('/api/sessions/join', { preHandler: requireAuth }, async (req, reply) => {
    const body = JoinSessionSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await joinSession(req.actor!, body.data.inviteCode)
    if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Invalid invite code' } })
    return reply.send(result)
  })

  // GET /api/sessions/:id/branches
  app.get('/api/sessions/:id/branches', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const data = await getSessionBranches(req.actor!, id)
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'Session not found' } })
    return reply.send(data)
  })

  // GET /api/sessions/:id/agents
  app.get('/api/sessions/:id/agents', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const data = await listSessionAgents(req.actor!, id)
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'Session not found' } })
    return reply.send(data)
  })

  // POST /api/sessions/:id/branches — FreeModelIdSchema in CreateBranchSchema rejects paid models
  app.post('/api/sessions/:id/branches', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = CreateBranchSchema.safeParse(req.body)
    if (!body.success) {
      // Zod failures include the :free check, so the code is always invalid_request
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await createBranch(req.actor!, id, body.data.fromMessageId, body.data.model, body.data.name)
    if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Session or message not found' } })
    return reply.code(201).send(result)
  })

  // GET /api/sessions/:id/tree
  app.get('/api/sessions/:id/tree', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const data = await getSessionTree(req.actor!, id)
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'Session not found' } })
    return reply.send(data)
  })
}
