import type { FastifyPluginAsync } from 'fastify'
import { CreateSessionSchema, JoinSessionSchema, CreateBranchSchema, UpdateBriefSchema, SetSessionKeySchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { sendServiceError } from './errors.js'
import {
  createSession,
  listSessions,
  getSession,
  joinSession,
  getSessionBranches,
  listSessionAgents,
  lookupInviteCode,
  updateBrief,
} from '../services/sessions.js'
import { createBranch, getSessionTree } from '../services/branches.js'
import { refreshBrief } from '../services/brief.js'
import { getSessionKeyInfo, setSessionKey, removeSessionKey } from '../services/sessionKeys.js'

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sessions — the default model must be :free (a new session has no key of its own)
  app.post('/api/sessions', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateSessionSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      return reply.code(201).send(await createSession(req.actor!, body.data.title, body.data.defaultModel))
    } catch (err) {
      return sendServiceError(reply, err)
    }
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

  // PUT /api/sessions/:id/brief
  app.put('/api/sessions/:id/brief', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UpdateBriefSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      return reply.send(updateBrief(req.actor!, id, body.data.content, body.data.baseUpdatedAt))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // POST /api/sessions/:id/brief/refresh
  app.post('/api/sessions/:id/brief/refresh', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return reply.send(await refreshBrief(req.actor!, id))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // GET /api/sessions/:id/key — the session's OpenRouter key status (never the key)
  app.get('/api/sessions/:id/key', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return reply.send(getSessionKeyInfo(req.actor!, id))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // PUT /api/sessions/:id/key — owner only
  app.put('/api/sessions/:id/key', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = SetSessionKeySchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.issues[0]?.message ?? body.error.message } })
    }
    try {
      return reply.send(await setSessionKey(req.actor!, id, body.data.key))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // DELETE /api/sessions/:id/key — owner only
  app.delete('/api/sessions/:id/key', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return reply.send(removeSessionKey(req.actor!, id))
    } catch (err) {
      return sendServiceError(reply, err)
    }
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

  // POST /api/sessions/:id/branches — a paid model needs the session's own key
  app.post('/api/sessions/:id/branches', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = CreateBranchSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      const { fromMessageId, model, name, docIds, purpose } = body.data
      const result = await createBranch(req.actor!, id, fromMessageId, model, name, docIds, purpose)
      if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Session or message not found' } })
      return reply.code(201).send(result)
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // GET /api/sessions/:id/tree
  app.get('/api/sessions/:id/tree', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const data = await getSessionTree(req.actor!, id)
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'Session not found' } })
    return reply.send(data)
  })
}
