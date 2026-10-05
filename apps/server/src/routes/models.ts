import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { listModels } from '../ai/models.js'
import { hasSessionKey } from '../ai/keys.js'
import { isSessionMember } from '../services/sessions.js'

export const modelsRoute: FastifyPluginAsync = async (app) => {
  // ?sessionId= lists what that session can use: every model when it has its own key.
  app.get('/api/models', { preHandler: requireAuth }, async (req, reply) => {
    const { sessionId } = req.query as { sessionId?: string }
    const byok = Boolean(sessionId && isSessionMember(sessionId, req.actor!.userId) && hasSessionKey(sessionId))
    try {
      return reply.send(await listModels(byok))
    } catch {
      return reply.code(502).send({ error: { code: 'upstream_error', message: 'Failed to fetch models' } })
    }
  })
}
