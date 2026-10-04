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
} from '../services/sessions.js'
import { createBranch, getSessionTree } from '../services/branches.js'
import { isFreeModelId } from '../ai/models.js'

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sessions
  app.post('/api/sessions', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateSessionSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    if (!isFreeModelId(body.data.defaultModel)) {
      return reply.code(400).send({ error: { code: 'free_model_required', message: 'Select an OpenRouter model with the :free suffix.' } })
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
    if (!isFreeModelId(body.data.model)) {
      return reply.code(400).send({ error: { code: 'free_model_required', message: 'Select an OpenRouter model with the :free suffix.' } })
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
