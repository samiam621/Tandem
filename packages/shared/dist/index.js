import { z } from 'zod';
// ─── Free model helpers ───────────────────────────────────────────────────────
// Returns true only if the model ID ends with the `:free` variant suffix.
// OpenRouter free models always carry this suffix, e.g. "meta-llama/llama-3.3-70b-instruct:free".
export function isFreeModelId(modelId) {
    return modelId.endsWith(':free');
}
// Zod schema that validates a model ID is both non-empty and a free model.
// Used anywhere a model field is accepted (session create, branch create/patch).
export const FreeModelIdSchema = z.string().min(1).refine(isFreeModelId, 'Select an OpenRouter model with the :free suffix.');
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
    // Must be an OpenRouter :free model — rejected at 400 if not
    defaultModel: FreeModelIdSchema,
});
export const JoinSessionSchema = z.object({
    inviteCode: z.string().min(1),
});
export const CreateBranchSchema = z.object({
    fromMessageId: z.string().min(1),
    // Must be an OpenRouter :free model — rejected at 400 if not
    model: FreeModelIdSchema,
    name: z.string().min(1).max(64).optional(),
    docIds: z.array(z.string().min(1)).max(100).optional(), // project docs to pin to the new branch
});
export const UpdateBranchSchema = z.object({
    name: z.string().min(1).max(64).optional(),
    // When provided, must be an OpenRouter :free model — rejected at 400 if not
    model: FreeModelIdSchema.optional(),
    pinnedDocIds: z.array(z.string().min(1)).max(100).optional(), // replaces the branch's pins
});
export const PostMessageSchema = z.object({
    content: z.string().min(1),
    triggerAi: z.boolean().default(true),
});
export const BRIEF_MAX_CHARS = 20000;
// baseUpdatedAt is the briefUpdatedAt the edit started from; a mismatch means someone saved in between.
export const UpdateBriefSchema = z.object({
    content: z.string().max(BRIEF_MAX_CHARS),
    baseUpdatedAt: z.string().nullable(),
});
export const DOC_MAX_CHARS = 200_000; // stored text per doc, after PDF extraction
export const DOC_UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // raw PDF size
export const PINNED_DOCS_MAX_CHARS = 40_000; // pinned docs' share of a reply's context
export const DOC_EXCERPTS_K = 3; // excerpts from unpinned docs added to each reply
// A text file is sent as text; a PDF as base64, and the server extracts its text.
export const UploadDocSchema = z.union([
    z.object({ title: z.string().min(1).max(200), text: z.string().min(1).max(DOC_MAX_CHARS) }),
    // base64 is 4/3 of the raw size
    z.object({ title: z.string().min(1).max(200), pdfBase64: z.string().min(1).max(Math.ceil(DOC_UPLOAD_MAX_BYTES / 3) * 4) }),
]);
export const CreateTokenSchema = z.object({
    label: z.string().min(1).max(64),
});
//# sourceMappingURL=index.js.map