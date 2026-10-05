import { z } from 'zod'

// ─── Free model helpers ───────────────────────────────────────────────────────

// Returns true only if the model ID ends with the `:free` variant suffix.
// OpenRouter free models always carry this suffix, e.g. "qwen/qwen3.8-27b:free".
export function isFreeModelId(modelId: string): boolean {
  return modelId.endsWith(':free')
}

// Free models run on the server's key. A paid model needs the session's own key (BYOK), so the
// request schemas accept any id and the server checks it against the session.

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
  pinnedDocIds: string[] // project docs this branch's AI reads in full; main reads every doc, so its list is unused
  purpose: string | null // what the branch is for, given at fork; null on main
  // Cited summary of what the branch needs from its parent, written by AI at fork and editable by the
  // owner. Null on main, and on a branch whose context has not been written yet.
  branchContext: string | null
  branchContextUpdatedAt: string | null // doubles as the version for optimistic saves
  branchContextUpdatedBy: string | null // a user id, or AI_AUTHOR
}

export type ProjectDocKind = 'text' | 'pdf'

// A spec or file in the session's project docs: written in the app, or uploaded (a PDF is stored as
// its extracted text). Any member can edit the text.
export interface ProjectDoc {
  id: string
  sessionId: string
  title: string
  kind: ProjectDocKind
  content: string
  uploadedBy: string // the creator
  createdAt: string
  updatedAt: string // doubles as the version for optimistic saves
  updatedBy: string
}

export type ProjectDocMeta = Omit<ProjectDoc, 'content'> & { chars: number }

// A passage of a project doc matched by keyword search.
export interface DocExcerpt {
  docId: string
  title: string
  text: string
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
  defaultModel: z.string().min(1), // a :free model: a new session has no key of its own yet
})

export const JoinSessionSchema = z.object({
  inviteCode: z.string().min(1),
})

export const BRANCH_PURPOSE_MAX = 500
export const BRANCH_CONTEXT_MAX_CHARS = 12000

// docIds omitted = copy the parent branch's pins (every doc when forking from main).
// purpose omitted = the branch name stands in for it when the branch context is written.
export const CreateBranchSchema = z.object({
  fromMessageId: z.string().min(1),
  model: z.string().min(1),
  name: z.string().min(1).max(64).optional(),
  docIds: z.array(z.string().min(1)).max(100).optional(), // project docs to pin to the new branch
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
  pinnedDocIds: z.array(z.string().min(1)).max(100).optional(), // replaces the branch's pins
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

export const DOC_MAX_CHARS = 200_000 // stored text per doc, after PDF extraction
export const DOC_TITLE_MAX = 200
export const DOC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024 // raw PDF size
export const PINNED_DOCS_MAX_CHARS = 40_000 // pinned docs' share of a reply's context
export const DOC_EXCERPTS_K = 3 // excerpts from unpinned docs added to each reply

// A doc written in the app or a text file is sent as text; a PDF as base64, and the server extracts its text.
export const UploadDocSchema = z.union([
  z.object({ title: z.string().trim().min(1).max(DOC_TITLE_MAX), text: z.string().min(1).max(DOC_MAX_CHARS) }),
  // base64 is 4/3 of the raw size
  z.object({ title: z.string().trim().min(1).max(DOC_TITLE_MAX), pdfBase64: z.string().min(1).max(Math.ceil(DOC_UPLOAD_MAX_BYTES / 3) * 4) }),
])

// baseUpdatedAt is the updatedAt the edit started from; a mismatch means someone saved in between.
export const UpdateDocSchema = z.object({
  title: z.string().trim().min(1).max(DOC_TITLE_MAX).optional(),
  content: z.string().max(DOC_MAX_CHARS),
  baseUpdatedAt: z.string(),
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

export interface WsDocCreatedEvent {
  type: 'doc_created'
  payload: ProjectDocMeta
}
export interface WsDocUpdatedEvent {
  type: 'doc_updated' // text or title saved
  payload: ProjectDocMeta
}
export interface WsDocDeletedEvent {
  type: 'doc_deleted'
  payload: { sessionId: string; docId: string }
}

export interface WsSessionKeyUpdatedEvent {
  type: 'session_key_updated' // set, replaced, or removed
  payload: SessionKeyInfo
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
  | WsDocCreatedEvent
  | WsDocUpdatedEvent
  | WsDocDeletedEvent
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
  docs: ProjectDoc[] // the docs this branch's AI reads in full (every doc on main)
  otherDocs: ProjectDocMeta[] // the rest; fetch with read_doc
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
