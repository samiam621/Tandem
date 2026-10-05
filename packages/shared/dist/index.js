import { z } from 'zod';
// ─── Free model helpers ───────────────────────────────────────────────────────
// Returns true only if the model ID ends with the `:free` variant suffix.
// OpenRouter free models always carry this suffix, e.g. "qwen/qwen3.8-27b:free".
export function isFreeModelId(modelId) {
    return modelId.endsWith(':free');
}
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
    defaultModel: z.string().min(1), // a :free model: a new session has no key of its own yet
});
export const JoinSessionSchema = z.object({
    inviteCode: z.string().min(1),
});
export const BRANCH_PURPOSE_MAX = 500;
export const BRANCH_CONTEXT_MAX_CHARS = 12000;
// docIds omitted = copy the parent branch's pins (every doc when forking from main).
// purpose omitted = the branch name stands in for it when the branch context is written.
export const CreateBranchSchema = z.object({
    fromMessageId: z.string().min(1),
    model: z.string().min(1),
    name: z.string().min(1).max(64).optional(),
    docIds: z.array(z.string().min(1)).max(100).optional(), // project docs to pin to the new branch
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
    pinnedDocIds: z.array(z.string().min(1)).max(100).optional(), // replaces the branch's pins
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
export const DOC_MAX_CHARS = 200_000; // stored text per doc, after PDF extraction
export const DOC_TITLE_MAX = 200;
export const DOC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // raw PDF size
export const PINNED_DOCS_MAX_CHARS = 40_000; // pinned docs' share of a reply's context
export const DOC_EXCERPTS_K = 3; // excerpts from unpinned docs added to each reply
// A doc written in the app or a text file is sent as text; a PDF as base64, and the server extracts its text.
export const UploadDocSchema = z.union([
    z.object({ title: z.string().trim().min(1).max(DOC_TITLE_MAX), text: z.string().min(1).max(DOC_MAX_CHARS) }),
    // base64 is 4/3 of the raw size
    z.object({ title: z.string().trim().min(1).max(DOC_TITLE_MAX), pdfBase64: z.string().min(1).max(Math.ceil(DOC_UPLOAD_MAX_BYTES / 3) * 4) }),
]);
// baseUpdatedAt is the updatedAt the edit started from; a mismatch means someone saved in between.
export const UpdateDocSchema = z.object({
    title: z.string().trim().min(1).max(DOC_TITLE_MAX).optional(),
    content: z.string().max(DOC_MAX_CHARS),
    baseUpdatedAt: z.string(),
});
export const CreateTokenSchema = z.object({
    label: z.string().min(1).max(64),
});
//# sourceMappingURL=index.js.map