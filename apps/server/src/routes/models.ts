import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../middleware/auth.js'

// Models list — fetched from OpenRouter and cached for 1 hour
let modelsCache: { id: string; name: string }[] | null = null
let modelsCacheAt = 0
const CACHE_TTL = 60 * 60 * 1000

async function fetchModels(): Promise<{ id: string; name: string }[]> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) {
    // Return a minimal list for dev without a key
    return [
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    ]
  }
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  })
  const data = (await res.json()) as { data: { id: string; name: string }[] }
  return data.data.map((m) => ({ id: m.id, name: m.name }))
}

export const modelsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/models', { preHandler: requireAuth }, async (_req, reply) => {
    if (!modelsCache || Date.now() - modelsCacheAt > CACHE_TTL) {
      try {
        modelsCache = await fetchModels()
        modelsCacheAt = Date.now()
      } catch (err) {
        if (!modelsCache) {
          return reply.code(502).send({ error: { code: 'upstream_error', message: 'Failed to fetch models' } })
        }
      }
    }
    return reply.send(modelsCache)
  })
}
