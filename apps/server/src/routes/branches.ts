import type { FastifyPluginAsync } from 'fastify'
import { UpdateBranchSchema, SetBranchDocumentsSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { sendServiceError } from './errors.js'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { branches, sessionMembers } from '../db/schema.js'
import { bus } from '../events.js'
import { shareBranch } from '../services/messages.js'
import { rowToBranch } from '../services/branches.js'
import { setBranchDocuments } from '../services/documents.js'

export const branchRoutes: FastifyPluginAsync = async (app) => {
  // PATCH /api/branches/:id
  app.patch('/api/branches/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UpdateBranchSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }

    const db = getDb()
    const branch = db.select().from(branches).where(eq(branches.id, id)).get()
    if (!branch) return reply.code(404).send({ error: { code: 'not_found', message: 'Branch not found' } })

    // Only owner can patch (main has null ownerId — disallow PATCH on main)
    if (branch.ownerId !== req.actor!.userId) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Only the owner can update this branch' } })
    }

    const updates: Partial<typeof branches.$inferInsert> = {}
    if (body.data.name) updates.name = body.data.name
    if (body.data.model) updates.model = body.data.model

    db.update(branches).set(updates).where(eq(branches.id, id)).run()
    const updated = rowToBranch(db.select().from(branches).where(eq(branches.id, id)).get()!)

    bus.emitSession(branch.sessionId, { type: 'branch_updated', payload: updated })
    return reply.send(updated)
  })

  // PUT /api/branches/:id/documents
  app.put('/api/branches/:id/documents', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = SetBranchDocumentsSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    try {
      return reply.send(setBranchDocuments(req.actor!, id, body.data.documentIds))
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
