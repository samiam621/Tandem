import { z } from 'zod'

// ─── Free model helpers ───────────────────────────────────────────────────────

// Returns true only if the model ID ends with the `:free` variant suffix.
// OpenRouter free models always carry this suffix, e.g. "meta-llama/llama-3.3-70b-instruct:free".
export function isFreeModelId(modelId: string): boolean {
  return modelId.endsWith(':free')
}

// Zod schema that validates a model ID is both non-empty and a free model.
// Used anywhere a model field is accepted (session create, branch create/patch).
export const FreeModelIdSchema = z.string().min(1).refine(isFreeModelId, 'Select an OpenRouter model with the :free suffix.')

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
  brief: string // shared project brief: every branch's AI reads the latest version
  briefUpdatedAt: string | null
  briefUpdatedBy: string | null
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
  pinnedDocIds: string[] // project docs this branch's AI reads in full; the rest reach it as search excerpts
}

export type ProjectDocKind = 'text' | 'pdf'

// A file uploaded to the session's project docs. content is the text (extracted, for a PDF).
export interface ProjectDoc {
  id: string
  sessionId: string
  title: string
  kind: ProjectDocKind
  content: string
  uploadedBy: string
  createdAt: string
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
  // Must be an OpenRouter :free model — rejected at 400 if not
  defaultModel: FreeModelIdSchema,
})

export const JoinSessionSchema = z.object({
  inviteCode: z.string().min(1),
})

export const CreateBranchSchema = z.object({
  fromMessageId: z.string().min(1),
  // Must be an OpenRouter :free model — rejected at 400 if not
  model: FreeModelIdSchema,
  name: z.string().min(1).max(64).optional(),
  docIds: z.array(z.string().min(1)).max(100).optional(), // project docs to pin to the new branch
})

export const UpdateBranchSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  // When provided, must be an OpenRouter :free model — rejected at 400 if not
  model: FreeModelIdSchema.optional(),
  pinnedDocIds: z.array(z.string().min(1)).max(100).optional(), // replaces the branch's pins
})

export const PostMessageSchema = z.object({
  content: z.string().min(1),
  triggerAi: z.boolean().default(true),
})

export const BRIEF_MAX_CHARS = 20000

// baseUpdatedAt is the briefUpdatedAt the edit started from; a mismatch means someone saved in between.
export const UpdateBriefSchema = z.object({
  content: z.string().max(BRIEF_MAX_CHARS),
  baseUpdatedAt: z.string().nullable(),
})

export const DOC_MAX_CHARS = 200_000 // stored text per doc, after PDF extraction
export const DOC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024 // raw PDF size
export const PINNED_DOCS_MAX_CHARS = 40_000 // pinned docs' share of a reply's context
export const DOC_EXCERPTS_K = 3 // excerpts from unpinned docs added to each reply

// A text file is sent as text; a PDF as base64, and the server extracts its text.
export const UploadDocSchema = z.union([
  z.object({ title: z.string().min(1).max(200), text: z.string().min(1).max(DOC_MAX_CHARS) }),
  // base64 is 4/3 of the raw size
  z.object({ title: z.string().min(1).max(200), pdfBase64: z.string().min(1).max(Math.ceil(DOC_UPLOAD_MAX_BYTES / 3) * 4) }),
])

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
export interface WsDocDeletedEvent {
  type: 'doc_deleted'
  payload: { sessionId: string; docId: string }
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
  | WsDocDeletedEvent

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
  brief: string // the session's shared project brief, always the latest version
  briefUpdatedAt: string | null
  docs: ProjectDocMeta[] // the session's project docs; branch.pinnedDocIds says which are pinned here
  branch: Branch & { ownerDisplayName: string | null }
  forkedFrom: { branchId: string; branchName: string; messageId: string } | null
  messages: McpContextMessage[] // root → head, including history inherited from the fork
  otherBranches: { id: string; name: string; ownerDisplayName: string | null }[]
}

// ─── Error shape ──────────────────────────────────────────────────────────────

export interface ApiError {
  error: { code: string; message: string }
}
