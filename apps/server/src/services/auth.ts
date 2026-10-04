import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { users, apiTokens } from '../db/schema.js'
import { hashToken, generateToken } from '../lib/tokens.js'
import { createOneTimeCode, consumeOneTimeCode } from '../lib/oneTimeCodes.js'
import type { User } from '@tandem/shared'

function now() {
  return new Date().toISOString()
}

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: row.createdAt,
  }
}

// ─── Guest auth ───────────────────────────────────────────────────────────────

export async function guestAuth(displayName: string, deviceId: string): Promise<{ user: User; token: string }> {
  const db = getDb()

  // Find or create guest user by device_id
  const existing = db.select().from(users)
    .where(eq(users.deviceId, deviceId))
    .get()

  let user: typeof users.$inferSelect
  if (existing) {
    user = existing
  } else {
    const id = nanoid()
    db.insert(users).values({
      id,
      kind: 'guest',
      displayName,
      deviceId,
      avatarUrl: null,
      createdAt: now(),
    }).run()
    user = db.select().from(users).where(eq(users.id, id)).get()!
  }

  const token = generateToken()
  const tokenId = nanoid()
  db.insert(apiTokens).values({
    id: tokenId,
    userId: user.id,
    kind: 'desktop',
    tokenHash: hashToken(token),
    label: 'desktop',
    createdAt: now(),
    lastUsedAt: null,
  }).run()

  return { user: rowToUser(user), token }
}

// ─── GitHub OAuth ─────────────────────────────────────────────────────────────

// In-memory state nonces: state → expiresAt
const githubStates = new Map<string, number>()

export function createGithubState(): string {
  const state = nanoid(32)
  githubStates.set(state, Date.now() + 10 * 60_000) // 10 min
  return state
}

export function validateGithubState(state: string): boolean {
  const exp = githubStates.get(state)
  if (!exp) return false
  githubStates.delete(state)
  return Date.now() < exp
}

export async function githubCallback(githubId: string, displayName: string, avatarUrl: string | null): Promise<string> {
  const db = getDb()

  // Upsert user by github_id
  const existing = db.select().from(users).where(eq(users.githubId, githubId)).get()

  let userId: string
  if (existing) {
    userId = existing.id
    db.update(users)
      .set({ displayName, avatarUrl: avatarUrl ?? null })
      .where(eq(users.id, userId))
      .run()
  } else {
    userId = nanoid()
    db.insert(users).values({
      id: userId,
      kind: 'github',
      displayName,
      githubId,
      avatarUrl: avatarUrl ?? null,
      createdAt: now(),
    }).run()
  }

  return createOneTimeCode(userId)
}

// ─── Exchange code for token ──────────────────────────────────────────────────

export async function exchangeCode(code: string): Promise<{ user: User; token: string } | null> {
  const userId = consumeOneTimeCode(code)
  if (!userId) return null

  const db = getDb()
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) return null

  const token = generateToken()
  const tokenId = nanoid()
  db.insert(apiTokens).values({
    id: tokenId,
    userId,
    kind: 'desktop',
    tokenHash: hashToken(token),
    label: 'desktop',
    createdAt: now(),
    lastUsedAt: null,
  }).run()

  return { user: rowToUser(user), token }
}

// ─── Resolve token → user ─────────────────────────────────────────────────────

export interface Actor {
  userId: string
  tokenKind: 'desktop' | 'agent'
  tokenId: string
}

export async function resolveToken(rawToken: string): Promise<Actor | null> {
  const db = getDb()
  const hash = hashToken(rawToken)
  const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).get()
  if (!row) return null

  // Update last_used_at
  db.update(apiTokens)
    .set({ lastUsedAt: now() })
    .where(eq(apiTokens.id, row.id))
    .run()

  return { userId: row.userId, tokenKind: row.kind, tokenId: row.id }
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(rawToken: string): Promise<void> {
  const db = getDb()
  const hash = hashToken(rawToken)
  db.delete(apiTokens).where(eq(apiTokens.tokenHash, hash)).run()
}

// ─── Get current user ─────────────────────────────────────────────────────────

export async function getMe(userId: string): Promise<User | null> {
  const db = getDb()
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  return row ? rowToUser(row) : null
}
