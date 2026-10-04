import type { FastifyPluginAsync } from 'fastify'

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ ok: true })
  })
}
