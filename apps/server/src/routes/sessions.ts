import type { FastifyPluginAsync } from 'fastify'
import { CreateSessionSchema, JoinSessionSchema, CreateBranchSchema, UpdateBriefSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
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
    } catch (err: any) {
      const status = err.status ?? 500
      return reply.code(status).send({ error: { code: err.code ?? 'server_error', message: err.message } })
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
