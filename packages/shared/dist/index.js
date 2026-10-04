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
export const CreateBranchSchema = z.object({
    fromMessageId: z.string().min(1),
    model: z.string().min(1),
    name: z.string().min(1).max(64).optional(),
});
export const UpdateBranchSchema = z.object({
    name: z.string().min(1).max(64).optional(),
    model: z.string().min(1).optional(),
});
export const PostMessageSchema = z.object({
    content: z.string().min(1),
    triggerAi: z.boolean().default(true),
});
export const CreateTokenSchema = z.object({
    label: z.string().min(1).max(64),
});
//# sourceMappingURL=index.js.map