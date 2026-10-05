import type { FastifyReply } from 'fastify'

// Sends a service failure (see services/errors.ts) as `{ error: { code, message } }`. Anything
// thrown without a status is an unexpected 500.
export function sendServiceError(reply: FastifyReply, err: any) {
  return reply.code(err.status ?? 500).send({ error: { code: err.code ?? 'server_error', message: err.message } })
}
