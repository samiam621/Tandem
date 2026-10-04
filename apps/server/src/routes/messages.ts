import type { FastifyPluginAsync } from 'fastify'
import { PostMessageSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { getBranchMessages, postMessage } from '../services/messages.js'

export const messageRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/branches/:id/messages
  app.get('/api/branches/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const data = await getBranchMessages(req.actor!, id)
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'Branch not found' } })
    return reply.send(data)
  })

  // POST /api/branches/:id/messages
  app.post('/api/branches/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = PostMessageSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      const result = await postMessage(req.actor!, id, body.data.content, body.data.triggerAi)
      return reply.code(201).send(result)
    } catch (err: any) {
      const status = err.status ?? 500
      return reply.code(status).send({ error: { code: err.code ?? 'server_error', message: err.message } })
    }
  })
}
