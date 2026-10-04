import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { listModels } from '../ai/models.js'

export const modelsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/models', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      return reply.send(await listModels())
    } catch {
      return reply.code(502).send({ error: { code: 'upstream_error', message: 'Failed to fetch models' } })
    }
  })
}
