import { nanoid } from 'nanoid'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../db/index.js'
import { sessions, sessionMembers, branches, users, apiTokens } from '../db/schema.js'
import { bus } from '../events.js'
import type { Session, Branch, User, SessionAgent } from '@tandem/shared'

function now() { return new Date().toISOString() }

function rowToSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.ownerId,
    defaultModel: row.defaultModel,
    inviteCode: row.inviteCode,
    createdAt: row.createdAt,
    brief: row.brief,
    briefUpdatedAt: row.briefUpdatedAt ?? null,
    briefUpdatedBy: row.briefUpdatedBy ?? null,
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
      isMain: true,
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

// ─── Session agents ───────────────────────────────────────────────────────────
// Agent tokens owned by session members. Their labels are the names teammates @mention.

const ACTIVE_MS = 5 * 60 * 1000

export function sessionAgentTokens(sessionId: string) {
  return getDb()
    .select({ token: apiTokens, ownerName: users.displayName })
    .from(apiTokens)
    .innerJoin(sessionMembers, and(eq(sessionMembers.userId, apiTokens.userId), eq(sessionMembers.sessionId, sessionId)))
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.kind, 'agent'))
    .all()
}

export async function listSessionAgents(
  actor: { userId: string },
  sessionId: string,
): Promise<SessionAgent[] | null> {
  const db = getDb()
  const membership = db.select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, actor.userId)))
    .get()
  if (!membership) return null

  return sessionAgentTokens(sessionId).map(({ token, ownerName }) => ({
    tokenId: token.id,
    label: token.label,
    ownerId: token.userId,
    ownerName,
    active: token.lastUsedAt !== null && Date.now() - Date.parse(token.lastUsedAt) < ACTIVE_MS,
  }))
}

// ─── Project brief ────────────────────────────────────────────────────────────
// Any member may edit. baseUpdatedAt must match the stored briefUpdatedAt so a save never
// silently overwrites a teammate's newer version.

export function updateBrief(
  actor: { userId: string },
  sessionId: string,
  content: string,
  baseUpdatedAt: string | null,
): Session {
  const db = getDb()
  if (!isSessionMember(sessionId, actor.userId)) {
    throw Object.assign(new Error('Session not found'), { code: 'not_found', status: 404 })
  }
  // briefUpdatedAt doubles as the version, so it must strictly increase even for saves in the same millisecond.
  const ts = baseUpdatedAt && Date.parse(now()) <= Date.parse(baseUpdatedAt)
    ? new Date(Date.parse(baseUpdatedAt) + 1).toISOString()
    : now()
  const res = db.update(sessions)
    .set({ brief: content, briefUpdatedAt: ts, briefUpdatedBy: actor.userId })
    .where(and(
      eq(sessions.id, sessionId),
      baseUpdatedAt === null ? isNull(sessions.briefUpdatedAt) : eq(sessions.briefUpdatedAt, baseUpdatedAt),
    ))
    .run()
  if (res.changes === 0) {
    throw Object.assign(new Error('Someone updated the brief since you started editing'), { code: 'conflict', status: 409 })
  }

  const session = rowToSession(db.select().from(sessions).where(eq(sessions.id, sessionId)).get()!)
  bus.emitSession(sessionId, {
    type: 'brief_updated',
    payload: { sessionId, brief: session.brief, briefUpdatedAt: ts, briefUpdatedBy: actor.userId },
  })
  return session
}

// ─── Membership ───────────────────────────────────────────────────────────────

export function isSessionMember(sessionId: string, userId: string): boolean {
  return Boolean(getDb().select().from(sessionMembers)
    .where(and(eq(sessionMembers.sessionId, sessionId), eq(sessionMembers.userId, userId)))
    .get())
}
