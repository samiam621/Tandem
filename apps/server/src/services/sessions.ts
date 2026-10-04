import { nanoid } from 'nanoid'
import { eq, and, inArray } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { sessions, sessionMembers, branches, users } from '../db/schema.js'
import { bus } from '../events.js'
import type { Session, Branch, User } from '@tandem/shared'

function now() { return new Date().toISOString() }

function rowToSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.ownerId,
    defaultModel: row.defaultModel,
    inviteCode: row.inviteCode,
    createdAt: row.createdAt,
  }
}

function rowToBranch(row: typeof branches.$inferSelect): Branch {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerId: row.ownerId ?? null,
    isMain: Boolean(row.isMain),
    name: row.name,
    model: row.model,
    forkMessageId: row.forkMessageId ?? null,
    headMessageId: row.headMessageId ?? null,
    createdAt: row.createdAt,
  }
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

// ─── Create session ───────────────────────────────────────────────────────────

export async function createSession(
  actor: { userId: string },
  title: string,
  defaultModel: string,
): Promise<{ session: Session; mainBranch: Branch; inviteCode: string }> {
  const db = getDb()
  const sessionId = nanoid()
  const branchId = nanoid()
  const inviteCode = nanoid(12)
  const ts = now()

  // Insert session + main branch + membership in one transaction
  db.transaction((tx) => {
    tx.insert(sessions).values({
      id: sessionId,
      title,
      ownerId: actor.userId,
      defaultModel,
      inviteCode,
      createdAt: ts,
    }).run()

    tx.insert(branches).values({
      id: branchId,
      sessionId,
      ownerId: null,
      isMain: 1 as unknown as boolean,
      name: 'main',
      model: defaultModel,
      forkMessageId: null,
      headMessageId: null,
      createdAt: ts,
    }).run()

    tx.insert(sessionMembers).values({
      sessionId,
      userId: actor.userId,
      joinedAt: ts,
      lastSeenAt: ts,
    }).run()
  })

  const session = rowToSession(db.select().from(sessions).where(eq(sessions.id, sessionId)).get()!)
  const mainBranch = rowToBranch(db.select().from(branches).where(eq(branches.id, branchId)).get()!)

  return { session, mainBranch, inviteCode }
}

// ─── List sessions for user ───────────────────────────────────────────────────

export async function listSessions(userId: string): Promise<Session[]> {
  const db = getDb()
  const memberships = db.select().from(sessionMembers).where(eq(sessionMembers.userId, userId)).all()
  if (!memberships.length) return []
  const sessionIds = memberships.map((m) => m.sessionId)
  const rows = db.select().from(sessions).where(inArray(sessions.id, sessionIds)).all()
  return rows.map(rowToSession)
}

// ─── Get session details ──────────────────────────────────────────────────────

export async function getSession(
  actor: { userId: string },
  sessionId: string,
) {
  const db = getDb()

  // Check membership
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return null

  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) return null

  const members = db.select().from(sessionMembers)
    .where(eq(sessionMembers.sessionId, sessionId))
    .all()
  const memberUserIds = members.map((m) => m.userId)
  const memberUsers = memberUserIds.length
    ? db.select().from(users).where(inArray(users.id, memberUserIds)).all()
    : []

  return {
    session: rowToSession(session),
    members: memberUsers.map(rowToUser),
  }
}

// ─── Join session ─────────────────────────────────────────────────────────────

export async function joinSession(
  actor: { userId: string },
  inviteCode: string,
): Promise<{ session: Session; mainBranch: Branch } | null> {
  const db = getDb()

  const session = db.select().from(sessions).where(eq(sessions.inviteCode, inviteCode)).get()
  if (!session) return null

  const existing = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, session.id), eq(sessionMembers.userId, actor.userId)))
    .get()

  const ts = now()
  if (!existing) {
    db.insert(sessionMembers).values({
      sessionId: session.id,
      userId: actor.userId,
      joinedAt: ts,
      lastSeenAt: ts,
    }).run()
  }

  const mainBranch = db.select().from(branches)
    .where(and(eq(branches.sessionId, session.id), eq(branches.isMain, true)))
    .get()

  if (!mainBranch) return null
  return { session: rowToSession(session), mainBranch: rowToBranch(mainBranch) }
}

// ─── Get branches for session ─────────────────────────────────────────────────

export async function getSessionBranches(
  actor: { userId: string },
  sessionId: string,
): Promise<Branch[] | null> {
  const db = getDb()

  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return null

  const rows = db.select().from(branches).where(eq(branches.sessionId, sessionId)).all()
  return rows.map(rowToBranch)
}
