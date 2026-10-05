import { z } from 'zod'

// ─── Domain types ────────────────────────────────────────────────────────────

export type UserKind = 'github' | 'guest' | 'agent'
export type AuthorType = 'user' | 'assistant' | 'agent'
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error'
// 'ask_parent': a branch's question to its parent branch and the answer (see ARCHITECTURE.md § Scoped branch context)
export type MessageKind = 'text' | 'ask_parent'
export type TokenKind = 'desktop' | 'agent'

export interface User {
  id: string
  kind: UserKind
  displayName: string
  avatarUrl: string | null
  createdAt: string
}

export interface Session {
  id: string
  title: string
  ownerId: string
  defaultModel: string
  inviteCode: string
  createdAt: string
  brief: string // short summary of main (direction, decisions, who's on what); every branch's AI reads the latest version
  briefUpdatedAt: string | null
  briefUpdatedBy: string | null // a user id, or BRIEF_AUTO_REFRESH_AUTHOR
}

export interface Branch {
  id: string
  sessionId: string
  ownerId: string | null
  isMain: boolean
  name: string
  model: string
  forkMessageId: string | null
  headMessageId: string | null
  createdAt: string
  documentIds: string[] | null // session documents this branch's AI reads; null on main = all of them
  purpose: string | null // what the branch is for, given at fork; null on main
  // Cited summary of what the branch needs from its parent, written by AI at fork and editable by the
  // owner. Null on main, and on a branch whose context has not been written yet.
  branchContext: string | null
  branchContextUpdatedAt: string | null // doubles as the version for optimistic saves
  branchContextUpdatedBy: string | null // a user id, or AI_AUTHOR
}

// A spec or doc stored in the session (e.g. ARCHITECTURE.md). Names are unique per session.
export interface SessionDocument {
  id: string
  sessionId: string
  name: string
  content: string
  createdAt: string
  updatedAt: string // doubles as the version for optimistic saves
  updatedBy: string
}

export interface Message {
  id: string
  sessionId: string
  branchId: string
  parentId: string | null
  authorType: AuthorType
  authorId: string
  model: string | null
  content: string
  status: MessageStatus
  createdAt: string
  agentLabel?: string | null // agent token label, e.g. "Claude", when posted through MCP
  sharedFromBranchId?: string | null // set on a Share to main summary posted in main
  kind?: MessageKind // 'text' when absent
  askQuestion?: string | null // on an ask_parent message: the question; content holds the answer
  askedBranchId?: string | null // on an ask_parent message: the branch that answered
}

// A session's own OpenRouter key, as members see it. The key itself never leaves the server.
export interface SessionKeyInfo {
  sessionId: string
  hasKey: boolean
  keyLast4: string | null
  setBy: string | null
  setAt: string | null
}

// An agent token owned by a session member; its label is the name teammates @mention.
export interface SessionAgent {
  tokenId: string
  label: string
  ownerId: string
  ownerName: string
  active: boolean // token used in the last few minutes
}

export interface ApiToken {
  id: string
  userId: string
  kind: TokenKind
  label: string
  createdAt: string
  lastUsedAt: string | null
}

// ─── Request schemas ─────────────────────────────────────────────────────────

export const GuestAuthSchema = z.object({
  displayName: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(128),
})

export const ExchangeCodeSchema = z.object({
  code: z.string().min(1),
})

export const CreateSessionSchema = z.object({
  title: z.string().min(1).max(128),
  defaultModel: z.string().min(1),
})

export const JoinSessionSchema = z.object({
  inviteCode: z.string().min(1),
})

export const DOCUMENT_MAX_CHARS = 60000
export const DOCUMENT_NAME_MAX = 128

export const BRANCH_PURPOSE_MAX = 500
export const BRANCH_CONTEXT_MAX_CHARS = 12000

// documentIds omitted = copy the parent branch's selection (every document when forking from main).
// purpose omitted = the branch name stands in for it when the branch context is written.
export const CreateBranchSchema = z.object({
  fromMessageId: z.string().min(1),
  model: z.string().min(1),
  name: z.string().min(1).max(64).optional(),
  documentIds: z.array(z.string().min(1)).max(200).optional(),
  purpose: z.string().trim().min(1).max(BRANCH_PURPOSE_MAX).optional(),
})

// baseUpdatedAt is the branchContextUpdatedAt the edit started from; a mismatch means it changed in between.
export const UpdateBranchContextSchema = z.object({
  content: z.string().max(BRANCH_CONTEXT_MAX_CHARS),
  baseUpdatedAt: z.string().nullable(),
})

export const SetSessionKeySchema = z.object({
  key: z.string().trim().startsWith('sk-or-', 'An OpenRouter key starts with sk-or-').max(200),
})

export const UpdateBranchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  model: z.string().min(1).optional(),
})

export const PostMessageSchema = z.object({
  content: z.string().min(1),
  triggerAi: z.boolean().default(true),
})

export const BRIEF_MAX_CHARS = 20000

// Session.briefUpdatedBy holds a user id, or this value when the server's automatic refresh wrote
// the brief (no user did).
export const BRIEF_AUTO_REFRESH_AUTHOR = 'system'

// Branch.branchContextUpdatedBy when AI wrote the branch context.
export const AI_AUTHOR = 'system'

// baseUpdatedAt is the briefUpdatedAt the edit started from; a mismatch means someone saved in between.
export const UpdateBriefSchema = z.object({
  content: z.string().max(BRIEF_MAX_CHARS),
  baseUpdatedAt: z.string().nullable(),
})

// Creates the document when baseUpdatedAt is null and no document has this name; otherwise
// baseUpdatedAt must match the stored updatedAt.
export const SaveDocumentSchema = z.object({
  name: z.string().trim().min(1).max(DOCUMENT_NAME_MAX),
  content: z.string().max(DOCUMENT_MAX_CHARS),
  baseUpdatedAt: z.string().nullable(),
})

export const SetBranchDocumentsSchema = z.object({
  documentIds: z.array(z.string().min(1)).max(200),
})

export const CreateTokenSchema = z.object({
  label: z.string().min(1).max(64),
})

// ─── WebSocket frame types ────────────────────────────────────────────────────

// Client → Server
export interface WsAuthFrame {
  type: 'auth'
  payload: { token: string }
}
export interface WsJoinSessionFrame {
  type: 'join_session'
  payload: { sessionId: string }
}
export interface WsLeaveSessionFrame {
  type: 'leave_session'
  payload: { sessionId: string }
}
export interface WsTypingFrame {
  type: 'typing'
  payload: { sessionId: string; branchId: string }
}

export type WsClientFrame =
  | WsAuthFrame
  | WsJoinSessionFrame
  | WsLeaveSessionFrame
  | WsTypingFrame

// Server → Client
export interface OnlineUser {
  id: string
  displayName: string
  kind: UserKind
}

export interface WsPresenceUpdateEvent {
  type: 'presence_update'
  payload: { sessionId: string; onlineUsers: OnlineUser[]; onlineCount: number }
}
export interface WsMessageCreatedEvent {
  type: 'message_created'
  payload: Message
}
export interface WsAssistantDeltaEvent {
  type: 'assistant_delta'
  payload: { messageId: string; branchId: string; text: string }
}
export interface WsAssistantDoneEvent {
  type: 'assistant_done'
  payload: { messageId: string; content: string; model: string }
}
export interface WsAssistantErrorEvent {
  type: 'assistant_error'
  payload: { messageId: string; error: string }
}
export interface WsBranchCreatedEvent {
  type: 'branch_created'
  payload: Branch
}
export interface WsBranchUpdatedEvent {
  type: 'branch_updated'
  payload: Branch
}
export interface WsTypingEvent {
  type: 'typing'
  payload: { userId: string; branchId: string; agentLabel?: string } // agentLabel set by MCP set_working
}

export interface WsBriefUpdatedEvent {
  type: 'brief_updated'
  payload: { sessionId: string; brief: string; briefUpdatedAt: string; briefUpdatedBy: string }
}

export interface WsDocumentUpdatedEvent {
  type: 'document_updated' // created or saved
  payload: SessionDocument
}

export interface WsSessionKeyUpdatedEvent {
  type: 'session_key_updated' // set, replaced, or removed
  payload: SessionKeyInfo
}

export interface WsDocumentDeletedEvent {
  type: 'document_deleted'
  payload: { sessionId: string; documentId: string }
}

export type WsServerEvent =
  | WsPresenceUpdateEvent
  | WsMessageCreatedEvent
  | WsAssistantDeltaEvent
  | WsAssistantDoneEvent
  | WsAssistantErrorEvent
  | WsBranchCreatedEvent
  | WsBranchUpdatedEvent
  | WsTypingEvent
  | WsBriefUpdatedEvent
  | WsDocumentUpdatedEvent
  | WsDocumentDeletedEvent
  | WsSessionKeyUpdatedEvent

// ─── MCP tool I/O ─────────────────────────────────────────────────────────────

export interface McpSessionSummary {
  id: string
  title: string
  onlineCount: number
}

export interface McpSessionDetail {
  session: Session
  members: (User & { online: boolean })[]
  branches: (Branch & { ownerDisplayName: string | null })[]
}

export interface McpMessageRow {
  id: string
  authorType: AuthorType
  authorDisplayName: string
  model: string | null
  content: string
  status: MessageStatus
  createdAt: string
}

export interface McpMention {
  messageId: string
  sessionId: string
  branchId: string
  branchName: string
  authorDisplayName: string
  content: string
  createdAt: string
}

export interface McpContextMessage extends McpMessageRow {
  branchId: string
  kind: MessageKind
  askQuestion: string | null
  agentLabel: string | null
  sharedFromBranchId: string | null // set on a Share to main summary
}

export interface McpBranchContext {
  session: { id: string; title: string }
  brief: string // summary of main, always the latest version
  briefUpdatedAt: string | null
  documents: SessionDocument[] // the documents this branch reads, in full
  otherDocuments: { id: string; name: string; updatedAt: string }[] // the rest; fetch with read_document
  branch: Branch & { ownerDisplayName: string | null }
  forkedFrom: { branchId: string; branchName: string; messageId: string } | null
  purpose: string | null
  branchContext: string | null // cited summary of what the branch needs from its parent; null on main
  // Main: root → head. Any other branch: the last few messages before the fork (verbatim), then its own.
  messages: McpContextMessage[]
  otherBranches: { id: string; name: string; ownerDisplayName: string | null }[]
}

// ─── Error shape ──────────────────────────────────────────────────────────────

export interface ApiError {
  error: { code: string; message: string }
}
