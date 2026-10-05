import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { fetchFreeModels } from '../ai/models.js'

// Free models list — fetched from OpenRouter and cached for 1 hour
let modelsCache: { id: string; name: string }[] | null = null
let modelsCacheAt = 0
const CACHE_TTL = 60 * 60 * 1000

export const modelsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/models', { preHandler: requireAuth }, async (_req, reply) => {
    if (!modelsCache || Date.now() - modelsCacheAt > CACHE_TTL) {
      try {
        modelsCache = await fetchFreeModels()
        modelsCacheAt = Date.now()
      } catch (err) {
        if (!modelsCache) {
          return reply.code(502).send({ error: { code: 'upstream_error', message: 'Failed to fetch models' } })
        }
      }
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
