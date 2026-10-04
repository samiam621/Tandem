import type { FastifyPluginAsync } from 'fastify'
import { CreateTokenSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { createAgentToken, listAgentTokens, revokeToken } from '../services/tokens.js'

export const tokenRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/tokens
  app.post('/api/tokens', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateTokenSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await createAgentToken(req.actor!.userId, body.data.label)
    // The raw token is shown only this once
    return reply.code(201).send({ token: result.token, rawToken: result.rawToken })
  })

  // GET /api/tokens
  app.get('/api/tokens', { preHandler: requireAuth }, async (req, reply) => {
    const tokens = await listAgentTokens(req.actor!.userId)
    return reply.send(tokens)
  })

  // DELETE /api/tokens/:id
  app.delete('/api/tokens/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = await revokeToken(req.actor!.userId, id)
    if (!ok) return reply.code(404).send({ error: { code: 'not_found', message: 'Token not found' } })
    return reply.send({ ok: true })
  })
}
