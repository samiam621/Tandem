import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { healthRoute } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { sessionRoutes } from './routes/sessions.js'
import { modelsRoute } from './routes/models.js'
import { branchRoutes } from './routes/branches.js'
import { messageRoutes } from './routes/messages.js'
import { recoverStaleMessages } from './services/messages.js'
import { wsHandler } from './ws/handler.js'
import { tokenRoutes } from './routes/tokens.js'
import { mcpHandler } from './mcp/handler.js'

// A deployed server (non-localhost PUBLIC_URL) must not hash tokens with the known dev secret.
const publicUrl = process.env.PUBLIC_URL ?? ''
if (!process.env.TOKEN_SECRET && publicUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(publicUrl)) {
  console.error(`TOKEN_SECRET must be set when PUBLIC_URL is ${publicUrl}`)
  process.exit(1)
}

const server = Fastify({ logger: true })

await server.register(cors, {
  origin: true,
  credentials: true,
})

await server.register(websocket)

// Routes
await server.register(healthRoute)
await server.register(authRoutes)
await server.register(sessionRoutes)
await server.register(modelsRoute)
await server.register(branchRoutes)
await server.register(messageRoutes)
await server.register(wsHandler)
await server.register(tokenRoutes)
await server.register(mcpHandler)

// Run migrations on startup, before anything touches the tables
await import('./db/migrate.js').catch((err) => {
  server.log.error(err, 'Migration failed')
  process.exit(1)
})

// Recover stale messages from a previous crash
recoverStaleMessages()

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'

await server.listen({ port, host })
