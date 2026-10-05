import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { SaveDocumentSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { sendServiceError } from './errors.js'
import { listDocuments, getDocument, saveDocument, deleteDocument } from '../services/documents.js'

export const documentRoutes: FastifyPluginAsync = async (app) => {
  const send = (reply: FastifyReply, run: () => unknown) => {
    try {
      return reply.send(run())
    } catch (err) {
      return sendServiceError(reply, err)
    }
  }

  // GET /api/sessions/:id/documents
  app.get('/api/sessions/:id/documents', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return send(reply, () => listDocuments(req.actor!, id))
  })

  // PUT /api/sessions/:id/documents
  app.put('/api/sessions/:id/documents', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = SaveDocumentSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    return send(reply, () => saveDocument(req.actor!, id, body.data.name, body.data.content, body.data.baseUpdatedAt))
  })

  // GET /api/documents/:id
  app.get('/api/documents/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return send(reply, () => getDocument(req.actor!, id))
  })

  // DELETE /api/documents/:id
  app.delete('/api/documents/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return send(reply, () => {
      deleteDocument(req.actor!, id)
      return { ok: true }
    })
  })
}
