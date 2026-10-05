import type { FastifyPluginAsync } from 'fastify'
import { UploadDocSchema, UpdateDocSchema } from '@tandem/shared'
import { requireAuth } from '../middleware/auth.js'
import { listDocs, getDoc, uploadDoc, updateDoc, deleteDoc } from '../services/docs.js'

type Handler = () => unknown

export const docRoutes: FastifyPluginAsync = async (app) => {
  // Services throw { status, code } errors; send them in the shared error shape.
  const run = async (reply: any, ok: number, fn: Handler) => {
    try {
      const result = await fn()
      return ok === 204 ? reply.code(204).send() : reply.code(ok).send(result)
    } catch (err: any) {
      return reply.code(err.status ?? 500).send({ error: { code: err.code ?? 'server_error', message: err.message } })
    }
  }

  // GET /api/sessions/:id/docs
  app.get('/api/sessions/:id/docs', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return run(reply, 200, () => listDocs(req.actor!, id))
  })

  // POST /api/sessions/:id/docs — a base64 PDF can be up to ~14 MB of JSON
  app.post('/api/sessions/:id/docs', { preHandler: requireAuth, bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UploadDocSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    return run(reply, 201, () => uploadDoc(req.actor!, id, body.data))
  })

  // GET /api/docs/:id
  app.get('/api/docs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return run(reply, 200, () => getDoc(req.actor!, id))
  })

  // PUT /api/docs/:id — any member; 409 when someone saved since baseUpdatedAt
  app.put('/api/docs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = UpdateDocSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    return run(reply, 200, () => updateDoc(req.actor!, id, body.data))
  })

  // DELETE /api/docs/:id
  app.delete('/api/docs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return run(reply, 204, () => deleteDoc(req.actor!, id))
  })
}
