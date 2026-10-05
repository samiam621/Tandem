import { z } from 'zod';
export declare function isFreeModelId(modelId: string): boolean;
export declare const FreeModelIdSchema: z.ZodEffects<z.ZodString, string, string>;
export type UserKind = 'github' | 'guest' | 'agent';
export type AuthorType = 'user' | 'assistant' | 'agent';
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'error';
export type TokenKind = 'desktop' | 'agent';
export interface User {
    id: string;
    kind: UserKind;
    displayName: string;
    avatarUrl: string | null;
    createdAt: string;
}
export interface Session {
    id: string;
    title: string;
    ownerId: string;
    defaultModel: string;
    inviteCode: string;
    createdAt: string;
    brief: string;
    briefUpdatedAt: string | null;
    briefUpdatedBy: string | null;
}
export interface Branch {
    id: string;
    sessionId: string;
    ownerId: string | null;
    isMain: boolean;
    name: string;
    model: string;
    forkMessageId: string | null;
    headMessageId: string | null;
    createdAt: string;
    pinnedDocIds: string[];
}
export type ProjectDocKind = 'text' | 'pdf';
export interface ProjectDoc {
    id: string;
    sessionId: string;
    title: string;
    kind: ProjectDocKind;
    content: string;
    uploadedBy: string;
    createdAt: string;
}
export type ProjectDocMeta = Omit<ProjectDoc, 'content'> & {
    chars: number;
};
export interface DocExcerpt {
    docId: string;
    title: string;
    text: string;
}
export interface Message {
    id: string;
    sessionId: string;
    branchId: string;
    parentId: string | null;
    authorType: AuthorType;
    authorId: string;
    model: string | null;
    content: string;
    status: MessageStatus;
    createdAt: string;
    agentLabel?: string | null;
    sharedFromBranchId?: string | null;
}
export interface SessionAgent {
    tokenId: string;
    label: string;
    ownerId: string;
    ownerName: string;
    active: boolean;
}
export interface ApiToken {
    id: string;
    userId: string;
    kind: TokenKind;
    label: string;
    createdAt: string;
    lastUsedAt: string | null;
}
export declare const GuestAuthSchema: z.ZodObject<{
    displayName: z.ZodString;
    deviceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    displayName: string;
    deviceId: string;
}, {
    displayName: string;
    deviceId: string;
}>;
export declare const ExchangeCodeSchema: z.ZodObject<{
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
}, {
    code: string;
}>;
export declare const CreateSessionSchema: z.ZodObject<{
    title: z.ZodString;
    defaultModel: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    title: string;
    defaultModel: string;
}, {
    title: string;
    defaultModel: string;
}>;
export declare const JoinSessionSchema: z.ZodObject<{
    inviteCode: z.ZodString;
}, "strip", z.ZodTypeAny, {
    inviteCode: string;
}, {
    inviteCode: string;
}>;
export declare const CreateBranchSchema: z.ZodObject<{
    fromMessageId: z.ZodString;
    model: z.ZodEffects<z.ZodString, string, string>;
    name: z.ZodOptional<z.ZodString>;
    docIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    fromMessageId: string;
    model: string;
    name?: string | undefined;
    docIds?: string[] | undefined;
}, {
    fromMessageId: string;
    model: string;
    name?: string | undefined;
    docIds?: string[] | undefined;
}>;
export declare const UpdateBranchSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    pinnedDocIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    model?: string | undefined;
    name?: string | undefined;
    pinnedDocIds?: string[] | undefined;
}, {
    model?: string | undefined;
    name?: string | undefined;
    pinnedDocIds?: string[] | undefined;
}>;
export declare const PostMessageSchema: z.ZodObject<{
    content: z.ZodString;
    triggerAi: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    content: string;
    triggerAi: boolean;
}, {
    content: string;
    triggerAi?: boolean | undefined;
}>;
export declare const BRIEF_MAX_CHARS = 20000;
export declare const UpdateBriefSchema: z.ZodObject<{
    content: z.ZodString;
    baseUpdatedAt: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    content: string;
    baseUpdatedAt: string | null;
}, {
    content: string;
    baseUpdatedAt: string | null;
}>;
export declare const DOC_MAX_CHARS = 200000;
export declare const DOC_UPLOAD_MAX_BYTES: number;
export declare const PINNED_DOCS_MAX_CHARS = 40000;
export declare const DOC_EXCERPTS_K = 3;
export declare const UploadDocSchema: z.ZodUnion<[z.ZodObject<{
    title: z.ZodString;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    title: string;
    text: string;
}, {
    title: string;
    text: string;
}>, z.ZodObject<{
    title: z.ZodString;
    pdfBase64: z.ZodString;
}, "strip", z.ZodTypeAny, {
    title: string;
    pdfBase64: string;
}, {
    title: string;
    pdfBase64: string;
}>]>;
export declare const CreateTokenSchema: z.ZodObject<{
    label: z.ZodString;
}, "strip", z.ZodTypeAny, {
    label: string;
}, {
    label: string;
}>;
export interface WsAuthFrame {
    type: 'auth';
    payload: {
        token: string;
    };
}
export interface WsJoinSessionFrame {
    type: 'join_session';
    payload: {
        sessionId: string;
    };
}
export interface WsLeaveSessionFrame {
    type: 'leave_session';
    payload: {
        sessionId: string;
    };
}
export interface WsTypingFrame {
    type: 'typing';
    payload: {
        sessionId: string;
        branchId: string;
    };
}
export type WsClientFrame = WsAuthFrame | WsJoinSessionFrame | WsLeaveSessionFrame | WsTypingFrame;
export interface OnlineUser {
    id: string;
    displayName: string;
    kind: UserKind;
}
export interface WsPresenceUpdateEvent {
    type: 'presence_update';
    payload: {
        sessionId: string;
        onlineUsers: OnlineUser[];
        onlineCount: number;
    };
}
export interface WsMessageCreatedEvent {
    type: 'message_created';
    payload: Message;
}
export interface WsAssistantDeltaEvent {
    type: 'assistant_delta';
    payload: {
        messageId: string;
        branchId: string;
        text: string;
    };
}
export interface WsAssistantDoneEvent {
    type: 'assistant_done';
    payload: {
        messageId: string;
        content: string;
        model: string;
    };
}
export interface WsAssistantErrorEvent {
    type: 'assistant_error';
    payload: {
        messageId: string;
        error: string;
    };
}
export interface WsBranchCreatedEvent {
    type: 'branch_created';
    payload: Branch;
}
export interface WsBranchUpdatedEvent {
    type: 'branch_updated';
    payload: Branch;
}
export interface WsTypingEvent {
    type: 'typing';
    payload: {
        userId: string;
        branchId: string;
        agentLabel?: string;
    };
}
export interface WsBriefUpdatedEvent {
    type: 'brief_updated';
    payload: {
        sessionId: string;
        brief: string;
        briefUpdatedAt: string;
        briefUpdatedBy: string;
    };
}
export interface WsDocCreatedEvent {
    type: 'doc_created';
    payload: ProjectDocMeta;
}
export interface WsDocDeletedEvent {
    type: 'doc_deleted';
    payload: {
        sessionId: string;
        docId: string;
    };
}
export type WsServerEvent = WsPresenceUpdateEvent | WsMessageCreatedEvent | WsAssistantDeltaEvent | WsAssistantDoneEvent | WsAssistantErrorEvent | WsBranchCreatedEvent | WsBranchUpdatedEvent | WsTypingEvent | WsBriefUpdatedEvent | WsDocCreatedEvent | WsDocDeletedEvent;
export interface McpSessionSummary {
    id: string;
    title: string;
    onlineCount: number;
}
export interface McpSessionDetail {
    session: Session;
    members: (User & {
        online: boolean;
    })[];
    branches: (Branch & {
        ownerDisplayName: string | null;
    })[];
}
export interface McpMessageRow {
    id: string;
    authorType: AuthorType;
    authorDisplayName: string;
    model: string | null;
    content: string;
    status: MessageStatus;
    createdAt: string;
}
export interface McpMention {
    messageId: string;
    sessionId: string;
    branchId: string;
    branchName: string;
    authorDisplayName: string;
    content: string;
    createdAt: string;
}
export interface McpContextMessage extends McpMessageRow {
    branchId: string;
    agentLabel: string | null;
    sharedFromBranchId: string | null;
}
export interface McpBranchContext {
    session: {
        id: string;
        title: string;
    };
    brief: string;
    briefUpdatedAt: string | null;
    docs: ProjectDocMeta[];
    branch: Branch & {
        ownerDisplayName: string | null;
    };
    forkedFrom: {
        branchId: string;
        branchName: string;
        messageId: string;
    } | null;
    messages: McpContextMessage[];
    otherBranches: {
        id: string;
        name: string;
        ownerDisplayName: string | null;
    }[];
}
export interface ApiError {
    error: {
        code: string;
        message: string;
    };
}
//# sourceMappingURL=index.d.ts.map