import { z } from 'zod'

// ─── Domain types ────────────────────────────────────────────────────────────

export type UserKind = 'github' | 'guest' | 'agent'
export type AuthorType = 'user' | 'assistant' | 'agent'
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error'
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

// documentIds omitted = copy the parent branch's selection (every document when forking from main).
export const CreateBranchSchema = z.object({
  fromMessageId: z.string().min(1),
  model: z.string().min(1),
  name: z.string().min(1).max(64).optional(),
  documentIds: z.array(z.string().min(1)).max(200).optional(),
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
  messages: McpContextMessage[] // root → head, including history inherited from the fork
  otherBranches: { id: string; name: string; ownerDisplayName: string | null }[]
}

// ─── Error shape ──────────────────────────────────────────────────────────────

export interface ApiError {
  error: { code: string; message: string }
}
