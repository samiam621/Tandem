import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { apiTokens } from '../db/schema.js'
import { generateToken, hashToken } from '../lib/tokens.js'
import type { ApiToken } from '@tandem/shared'

function now() { return new Date().toISOString() }

function rowToToken(row: typeof apiTokens.$inferSelect): ApiToken {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    label: row.label,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
  }
}

export async function createAgentToken(userId: string, label: string): Promise<{ token: ApiToken; rawToken: string }> {
  const db = getDb()
  const rawToken = generateToken()
  const id = nanoid()
  db.insert(apiTokens).values({
    id,
    userId,
    kind: 'agent',
    tokenHash: hashToken(rawToken),
    label,
    createdAt: now(),
    lastUsedAt: null,
  }).run()
  const row = db.select().from(apiTokens).where(eq(apiTokens.id, id)).get()!
  return { token: rowToToken(row), rawToken }
}

export async function listAgentTokens(userId: string): Promise<ApiToken[]> {
  const db = getDb()
  const rows = db.select().from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .all()
  return rows.filter((r) => r.kind === 'agent').map(rowToToken)
}

export async function revokeToken(userId: string, tokenId: string): Promise<boolean> {
  const db = getDb()
  const row = db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).get()
  if (!row || row.userId !== userId) return false
  db.delete(apiTokens).where(eq(apiTokens.id, tokenId)).run()
  return true
}
