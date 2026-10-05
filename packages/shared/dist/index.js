import { z } from 'zod';
// ─── Request schemas ─────────────────────────────────────────────────────────
export const GuestAuthSchema = z.object({
    displayName: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(128),
});
export const ExchangeCodeSchema = z.object({
    code: z.string().min(1),
});
export const CreateSessionSchema = z.object({
    title: z.string().min(1).max(128),
    defaultModel: z.string().min(1),
});
export const JoinSessionSchema = z.object({
    inviteCode: z.string().min(1),
});
export const DOCUMENT_MAX_CHARS = 60000;
export const DOCUMENT_NAME_MAX = 128;
export const BRANCH_PURPOSE_MAX = 500;
export const BRANCH_CONTEXT_MAX_CHARS = 12000;
// documentIds omitted = copy the parent branch's selection (every document when forking from main).
// purpose omitted = the branch name stands in for it when the branch context is written.
export const CreateBranchSchema = z.object({
    fromMessageId: z.string().min(1),
    model: z.string().min(1),
    name: z.string().min(1).max(64).optional(),
    documentIds: z.array(z.string().min(1)).max(200).optional(),
    purpose: z.string().trim().min(1).max(BRANCH_PURPOSE_MAX).optional(),
});
// baseUpdatedAt is the branchContextUpdatedAt the edit started from; a mismatch means it changed in between.
export const UpdateBranchContextSchema = z.object({
    content: z.string().max(BRANCH_CONTEXT_MAX_CHARS),
    baseUpdatedAt: z.string().nullable(),
});
export const SetSessionKeySchema = z.object({
    key: z.string().trim().startsWith('sk-or-', 'An OpenRouter key starts with sk-or-').max(200),
});
export const UpdateBranchSchema = z.object({
    name: z.string().min(1).max(64).optional(),
    model: z.string().min(1).optional(),
});
export const PostMessageSchema = z.object({
    content: z.string().min(1),
    triggerAi: z.boolean().default(true),
});
export const BRIEF_MAX_CHARS = 20000;
// Session.briefUpdatedBy holds a user id, or this value when the server's automatic refresh wrote
// the brief (no user did).
export const BRIEF_AUTO_REFRESH_AUTHOR = 'system';
// Branch.branchContextUpdatedBy when AI wrote the branch context.
export const AI_AUTHOR = 'system';
// baseUpdatedAt is the briefUpdatedAt the edit started from; a mismatch means someone saved in between.
export const UpdateBriefSchema = z.object({
    content: z.string().max(BRIEF_MAX_CHARS),
    baseUpdatedAt: z.string().nullable(),
});
// Creates the document when baseUpdatedAt is null and no document has this name; otherwise
// baseUpdatedAt must match the stored updatedAt.
export const SaveDocumentSchema = z.object({
    name: z.string().trim().min(1).max(DOCUMENT_NAME_MAX),
    content: z.string().max(DOCUMENT_MAX_CHARS),
    baseUpdatedAt: z.string().nullable(),
});
export const SetBranchDocumentsSchema = z.object({
    documentIds: z.array(z.string().min(1)).max(200),
});
export const CreateTokenSchema = z.object({
    label: z.string().min(1).max(64),
});
//# sourceMappingURL=index.js.map