import { z } from 'zod';
import { UniversalEntityReferenceSchema } from '../plugins/universalReference';

export const PORTFOLIO_CHAT_ARCHIVE_VERSION = 1;
export const PORTFOLIO_CHAT_MAIN_PORTFOLIO_KEY = 'main';
export const MAX_SAVED_CHAT_CONVERSATIONS = 30;
export const MAX_SAVED_CHAT_MESSAGES = 80;
export const MAX_SAVED_CHAT_CHARACTERS = 1_500_000;

const StoredSelectionSchema = z.object({
    kind: z.enum(['asset', 'node']),
    id: z.string().trim().min(1).max(240),
    label: z.string().trim().min(1).max(500),
    detail: z.string().trim().min(1).max(200),
}).strict();

export const PortfolioChatConversationContextSchema = z.object({
    processId: z.string().trim().min(1).max(240).nullable(),
    scope: z.enum(['selection', 'process', 'portfolio']),
    label: z.string().trim().min(1).max(500),
    detail: z.string().trim().min(1).max(200),
    baseRevision: z.string().trim().min(1).max(240),
    selection: StoredSelectionSchema.nullable(),
}).strict();

export const PortfolioChatStoredCitationSchema = z.object({
    sourceId: z.string().trim().min(1).max(300),
    label: z.string().trim().min(1).max(500),
    reference: UniversalEntityReferenceSchema,
    note: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const PortfolioChatStoredRetrievalSchema = z.object({
    strategy: z.literal('lexical-v1'),
    baseRevision: z.string().trim().min(1).max(240).optional(),
    indexedSourceCount: z.number().int().positive(),
    matchedSourceCount: z.number().int().nonnegative(),
    returnedSourceCount: z.number().int().positive(),
    fallbackUsed: z.boolean(),
    sources: z.array(z.object({
        sourceId: z.string().trim().min(1).max(300),
        label: z.string().trim().min(1).max(500),
        reference: UniversalEntityReferenceSchema,
        reason: z.enum(['match', 'related']),
    }).strict()).max(100),
}).strict();

const PortfolioChatUserMessageSchema = z.object({
    id: z.string().trim().min(1).max(240),
    role: z.literal('user'),
    content: z.string().min(1).max(100_000),
    createdAt: z.string().datetime(),
}).strict();

const PortfolioChatAssistantMessageSchema = z.object({
    id: z.string().trim().min(1).max(240),
    role: z.literal('assistant'),
    content: z.string().min(1).max(100_000),
    createdAt: z.string().datetime(),
    modelId: z.string().trim().min(1).max(500),
    citations: z.array(PortfolioChatStoredCitationSchema).max(100),
    sharedSourceCount: z.number().int().nonnegative(),
    omittedSourceCount: z.number().int().nonnegative(),
    retrieval: PortfolioChatStoredRetrievalSchema.optional(),
}).strict();

export const PortfolioChatStoredMessageSchema = z.discriminatedUnion('role', [
    PortfolioChatUserMessageSchema,
    PortfolioChatAssistantMessageSchema,
]);

export const PortfolioChatConversationSchema = z.object({
    id: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(120),
    titleEdited: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    context: PortfolioChatConversationContextSchema,
    messages: z.array(PortfolioChatStoredMessageSchema).max(MAX_SAVED_CHAT_MESSAGES),
    trimmedMessageCount: z.number().int().nonnegative(),
}).strict();

export const PortfolioChatArchiveSchema = z.object({
    archiveVersion: z.literal(PORTFOLIO_CHAT_ARCHIVE_VERSION),
    conversationsByPortfolio: z.record(
        z.string(),
        z.array(PortfolioChatConversationSchema).max(MAX_SAVED_CHAT_CONVERSATIONS),
    ),
    activeConversationByPortfolio: z.record(z.string(), z.string()),
}).strict();

export type PortfolioChatConversationContext = z.infer<typeof PortfolioChatConversationContextSchema>;
export type PortfolioChatStoredCitation = z.infer<typeof PortfolioChatStoredCitationSchema>;
export type PortfolioChatStoredMessage = z.infer<typeof PortfolioChatStoredMessageSchema>;
export type PortfolioChatConversation = z.infer<typeof PortfolioChatConversationSchema>;
export type PortfolioChatArchive = z.infer<typeof PortfolioChatArchiveSchema>;

export const createConversationTitle = (question: string): string => {
    const normalized = question.replace(/\s+/g, ' ').trim();
    if (!normalized) return 'New conversation';
    return normalized.length > 54 ? `${normalized.slice(0, 53).trimEnd()}…` : normalized;
};

const serializedSize = (value: unknown): number => JSON.stringify(value).length;

const trimOversizedConversation = (
    conversation: PortfolioChatConversation,
): PortfolioChatConversation => {
    let messages = conversation.messages.slice(-MAX_SAVED_CHAT_MESSAGES);
    let trimmedMessageCount = conversation.trimmedMessageCount
        + Math.max(0, conversation.messages.length - messages.length);
    let candidate = { ...conversation, messages, trimmedMessageCount };

    while (messages.length > 2 && serializedSize(candidate) > MAX_SAVED_CHAT_CHARACTERS) {
        const removeCount = messages[0]?.role === 'user' && messages[1]?.role === 'assistant' ? 2 : 1;
        messages = messages.slice(removeCount);
        trimmedMessageCount += removeCount;
        candidate = { ...conversation, messages, trimmedMessageCount };
    }
    return candidate;
};

/**
 * Keeps the device-local archive bounded. The active/newest conversation is
 * retained first; older conversations are removed before the current one is
 * shortened.
 */
export const prunePortfolioChatConversations = (
    conversations: readonly PortfolioChatConversation[],
): PortfolioChatConversation[] => {
    const sorted = conversations
        .map(trimOversizedConversation)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_SAVED_CHAT_CONVERSATIONS);
    const retained: PortfolioChatConversation[] = [];
    let usedCharacters = 0;

    sorted.forEach(conversation => {
        const size = serializedSize(conversation);
        if (retained.length > 0 && usedCharacters + size > MAX_SAVED_CHAT_CHARACTERS) return;
        retained.push(conversation);
        usedCharacters += size;
    });
    return retained;
};
