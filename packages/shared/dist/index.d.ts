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
}, "strip", z.ZodTypeAny, {
    fromMessageId: string;
    model: string;
    name?: string | undefined;
}, {
    fromMessageId: string;
    model: string;
    name?: string | undefined;
}>;
export declare const UpdateBranchSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    model?: string | undefined;
}, {
    name?: string | undefined;
    model?: string | undefined;
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
export type WsServerEvent = WsPresenceUpdateEvent | WsMessageCreatedEvent | WsAssistantDeltaEvent | WsAssistantDoneEvent | WsAssistantErrorEvent | WsBranchCreatedEvent | WsBranchUpdatedEvent | WsTypingEvent;
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