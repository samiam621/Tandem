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
  updateBrief,
} from '../services/sessions.js'
import { createBranch, getSessionTree } from '../services/branches.js'
import { refreshBrief } from '../services/brief.js'
import { getSessionKeyInfo, setSessionKey, removeSessionKey } from '../services/sessionKeys.js'

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sessions
  app.post('/api/sessions', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateSessionSchema.safeParse(req.body)
    if (!body.success) {
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

  // POST /api/sessions/:id/branches
  app.post('/api/sessions/:id/branches', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = CreateBranchSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await createBranch(req.actor!, id, body.data.fromMessageId, body.data.model, body.data.name, body.data.documentIds, body.data.purpose)
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
