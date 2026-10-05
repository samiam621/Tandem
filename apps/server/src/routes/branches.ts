import type { FastifyPluginAsync } from 'fastify'
import { UpdateBranchSchema, UpdateBranchContextSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { sendServiceError } from './errors.js'
import { shareBranch } from '../services/messages.js'
import { updateBranch } from '../services/branches.js'
import { updateBranchContext, regenerateBranchContext } from '../services/branchContext.js'

export const branchRoutes: FastifyPluginAsync = async (app) => {
  // PATCH /api/branches/:id — owner only; a paid model needs the session's own key
  app.patch('/api/branches/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UpdateBranchSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      return reply.send(updateBranch(req.actor!, id, body.data))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // PUT /api/branches/:id/context — owner only
  app.put('/api/branches/:id/context', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UpdateBranchContextSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      return reply.send(updateBranchContext(req.actor!, id, body.data.content, body.data.baseUpdatedAt))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // POST /api/branches/:id/context/regenerate — owner only
  app.post('/api/branches/:id/context/regenerate', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return reply.send(await regenerateBranchContext(req.actor!, id))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })

  // POST /api/branches/:id/share
  app.post('/api/branches/:id/share', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      return reply.code(201).send(await shareBranch(req.actor!, id))
    } catch (err) {
      return sendServiceError(reply, err)
    }
  })
}
