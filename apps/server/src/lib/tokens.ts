import crypto from 'crypto'

const TOKEN_PREFIX = 'tdm_'

export function hashToken(token: string): string {
  const secret = process.env.TOKEN_SECRET ?? 'dev-secret'
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

export function generateToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('hex')
}

export function isValidTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX)
}
