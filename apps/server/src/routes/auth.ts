import type { FastifyPluginAsync } from 'fastify'
import { GuestAuthSchema, ExchangeCodeSchema } from '@tandem/shared'
import {
  guestAuth,
  githubCallback,
  exchangeCode,
  logout,
  getMe,
  createGithubState,
  validateGithubState,
} from '../services/auth.js'
import { requireAuth } from '../middleware/auth.js'

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/auth/guest
  app.post('/api/auth/guest', async (req, reply) => {
    const body = GuestAuthSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await guestAuth(body.data.displayName, body.data.deviceId)
    return reply.send(result)
  })

  // GET /api/auth/github — redirect to GitHub
  app.get('/api/auth/github', async (_req, reply) => {
    const clientId = process.env.GITHUB_CLIENT_ID
    if (!clientId) {
      return reply.code(500).send({ error: { code: 'server_error', message: 'GitHub OAuth not configured' } })
    }
    const state = createGithubState()
    const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000'
    const callbackUrl = encodeURIComponent(`${publicUrl}/api/auth/github/callback`)
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${callbackUrl}&scope=user:email&state=${state}`
    return reply.redirect(url)
  })

  // GET /api/auth/github/callback
  app.get('/api/auth/github/callback', async (req, reply) => {
    const { code, state } = req.query as Record<string, string>

    if (!state || !validateGithubState(state)) {
      return reply.code(400).send({ error: { code: 'invalid_state', message: 'Invalid or expired state' } })
    }
    if (!code) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: 'Missing code' } })
    }

    // Exchange code for GitHub access token
    const clientId = process.env.GITHUB_CLIENT_ID!
    const clientSecret = process.env.GITHUB_CLIENT_SECRET!
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    })
    const tokenData = (await tokenRes.json()) as Record<string, string>
    if (tokenData.error || !tokenData.access_token) {
      return reply.code(400).send({ error: { code: 'github_error', message: tokenData.error_description ?? 'GitHub OAuth failed' } })
    }

    // Get GitHub user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'Tandem' },
    })
    const ghUser = (await userRes.json()) as Record<string, string>

    const oneTimeCode = await githubCallback(
      String(ghUser.id),
      ghUser.name ?? ghUser.login,
      ghUser.avatar_url ?? null,
    )

    const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000'
    // Try to redirect to the desktop app; show the code as a fallback
    const deepLink = `tandem://auth?code=${oneTimeCode}`
    const html = `<!DOCTYPE html>
<html>
<head><title>Sign in to Tandem</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:20px">
<h2>Opening Tandem…</h2>
<p>If the app doesn't open automatically, copy this code and paste it into Tandem:</p>
<code style="font-size:1.2em;background:#f0f0f0;padding:8px 16px;border-radius:4px;display:inline-block;margin:16px 0">${oneTimeCode}</code>
<p><a href="${deepLink}">Open Tandem</a></p>
<script>window.location.href = "${deepLink}"</script>
</body>
</html>`

    return reply.header('Content-Type', 'text/html').send(html)
  })

  // POST /api/auth/exchange
  app.post('/api/auth/exchange', async (req, reply) => {
    const body = ExchangeCodeSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: { code: 'invalid_request', message: body.error.message } })
    }
    const result = await exchangeCode(body.data.code)
    if (!result) {
      return reply.code(401).send({ error: { code: 'invalid_code', message: 'Code invalid or expired' } })
    }
    return reply.send(result)
  })

  // POST /api/auth/logout
  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    const header = req.headers.authorization!
    const token = header.slice(7)
    await logout(token)
    return reply.send({ ok: true })
  })

  // GET /api/me
  app.get('/api/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await getMe(req.actor!.userId)
    if (!user) return reply.code(404).send({ error: { code: 'not_found', message: 'User not found' } })
    return reply.send(user)
  })
}
