import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, boolean, timestamp } from 'drizzle-orm/pg-core'

// We use SQLite for local dev and Postgres in prod.
// drizzle-orm supports both dialects; we export both and pick at runtime.
// For simplicity, types are driven from the sqlite schema; columns map 1:1.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['github', 'guest', 'agent'] }).notNull(),
  displayName: text('display_name').notNull(),
  githubId: text('github_id'),
  deviceId: text('device_id'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  ownerId: text('owner_id').notNull(),
  defaultModel: text('default_model').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: text('created_at').notNull(),
})

export const sessionMembers = sqliteTable('session_members', {
  sessionId: text('session_id').notNull(),
  userId: text('user_id').notNull(),
  joinedAt: text('joined_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
})

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  ownerId: text('owner_id'),
  isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
  name: text('name').notNull(),
  model: text('model').notNull(),
  forkMessageId: text('fork_message_id'),
  headMessageId: text('head_message_id'),
  createdAt: text('created_at').notNull(),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  branchId: text('branch_id').notNull(),
  parentId: text('parent_id'),
  authorType: text('author_type', { enum: ['user', 'assistant', 'agent'] }).notNull(),
  authorId: text('author_id').notNull(),
  agentLabel: text('agent_label'), // agent token label at post time, e.g. "Claude"
  sharedFromBranchId: text('shared_from_branch_id'), // set on a Share to main summary
  model: text('model'),
  content: text('content').notNull().default(''),
  status: text('status', { enum: ['pending', 'streaming', 'done', 'error'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull(),
})

// Agent tokens mentioned as @label in a message (agents are MCP tokens for now).
export const messageMentions = sqliteTable('message_mentions', {
  messageId: text('message_id').notNull(),
  tokenId: text('token_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind', { enum: ['desktop', 'agent'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
})
