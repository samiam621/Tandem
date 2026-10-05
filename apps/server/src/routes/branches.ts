import type { FastifyPluginAsync } from 'fastify'
import { UpdateBranchSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { shareBranch } from '../services/messages.js'
import { updateBranch } from '../services/branches.js'

export const branchRoutes: FastifyPluginAsync = async (app) => {
  // PATCH /api/branches/:id — UpdateBranchSchema.model uses FreeModelIdSchema, so paid models are rejected by Zod
  app.patch('/api/branches/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UpdateBranchSchema.safeParse(req.body)
    if (!body.success) {
      // Zod failures include the :free check, so the code is always invalid_request
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      return reply.send(updateBranch(req.actor!, id, body.data))
    } catch (err: any) {
      return reply.code(err.status ?? 500).send({ error: { code: err.code ?? 'server_error', message: err.message } })
    }
  })

  // POST /api/branches/:id/share
  app.post('/api/branches/:id/share', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return reply.code(201).send(await shareBranch(req.actor!, id))
    } catch (err: any) {
      return reply.code(err.status ?? 500).send({ error: { code: err.code ?? 'server_error', message: err.message } })
    }
  })
}
