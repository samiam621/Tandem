import type { FastifyRequest, FastifyReply } from 'fastify'
import { resolveToken } from '../services/auth.js'
import type { Actor } from '../services/auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return reply.code(401).send({ error: { code: 'unauthorized', message: 'Missing token' } })
  }
  const token = header.slice(7)
  const actor = await resolveToken(token)
  if (!actor) {
    return reply.code(401).send({ error: { code: 'unauthorized', message: 'Invalid token' } })
  }
  request.actor = actor
}
