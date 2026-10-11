import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
    PORTFOLIO_CHAT_ARCHIVE_VERSION,
    PortfolioChatArchiveSchema,
    createConversationTitle,
    prunePortfolioChatConversations,
    type PortfolioChatConversation,
    type PortfolioChatConversationContext,
    type PortfolioChatStoredMessage,
} from '../ai/portfolioChatHistory';

interface PortfolioChatState {
    archiveVersion: typeof PORTFOLIO_CHAT_ARCHIVE_VERSION;
    conversationsByPortfolio: Record<string, PortfolioChatConversation[]>;
    activeConversationByPortfolio: Record<string, string>;
    ensureConversation: (portfolioKey: string, context: PortfolioChatConversationContext) => string;
    createConversation: (portfolioKey: string, context: PortfolioChatConversationContext) => string;
    setActiveConversation: (portfolioKey: string, conversationId: string) => void;
    appendMessage: (portfolioKey: string, conversationId: string, message: PortfolioChatStoredMessage) => void;
    renameConversation: (portfolioKey: string, conversationId: string, title: string) => void;
    clearConversation: (portfolioKey: string, conversationId: string) => void;
    deleteConversation: (portfolioKey: string, conversationId: string) => void;
    clearPortfolioHistory: (portfolioKey: string) => void;
}

const conversationId = (): string => (
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const now = (): string => new Date().toISOString();

const newConversation = (context: PortfolioChatConversationContext): PortfolioChatConversation => {
    const timestamp = now();
    return {
        id: conversationId(),
        title: 'New conversation',
        titleEdited: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        context,
        messages: [],
        trimmedMessageCount: 0,
    };
};

const updateConversation = (
    conversations: readonly PortfolioChatConversation[],
    conversationIdToUpdate: string,
    update: (conversation: PortfolioChatConversation) => PortfolioChatConversation,
): PortfolioChatConversation[] => prunePortfolioChatConversations(conversations.map(conversation => (
    conversation.id === conversationIdToUpdate ? update(conversation) : conversation
)));

export const usePortfolioChatStore = create<PortfolioChatState>()(persist(
    (set, get) => ({
        archiveVersion: PORTFOLIO_CHAT_ARCHIVE_VERSION,
        conversationsByPortfolio: {},
        activeConversationByPortfolio: {},

        ensureConversation: (portfolioKey, context) => {
            const state = get();
            const existingId = state.activeConversationByPortfolio[portfolioKey];
            const existing = state.conversationsByPortfolio[portfolioKey]
                ?.find(conversation => conversation.id === existingId);
            if (existing) return existing.id;
            return state.createConversation(portfolioKey, context);
        },

        createConversation: (portfolioKey, context) => {
            const conversation = newConversation(context);
            set(state => ({
                conversationsByPortfolio: {
                    ...state.conversationsByPortfolio,
                    [portfolioKey]: prunePortfolioChatConversations([
                        conversation,
                        ...(state.conversationsByPortfolio[portfolioKey] || []),
                    ]),
                },
                activeConversationByPortfolio: {
                    ...state.activeConversationByPortfolio,
                    [portfolioKey]: conversation.id,
                },
            }));
            return conversation.id;
        },

        setActiveConversation: (portfolioKey, conversationIdToActivate) => set(state => {
            const conversations = state.conversationsByPortfolio[portfolioKey] || [];
            if (!conversations.some(conversation => conversation.id === conversationIdToActivate)) return state;
            const timestamp = now();
            return {
                conversationsByPortfolio: {
                    ...state.conversationsByPortfolio,
                    [portfolioKey]: updateConversation(conversations, conversationIdToActivate, conversation => ({
                        ...conversation,
                        updatedAt: timestamp,
                    })),
                },
                activeConversationByPortfolio: {
                    ...state.activeConversationByPortfolio,
                    [portfolioKey]: conversationIdToActivate,
                },
            };
        }),

        appendMessage: (portfolioKey, conversationIdToUpdate, message) => set(state => {
            const conversations = state.conversationsByPortfolio[portfolioKey] || [];
            return {
                conversationsByPortfolio: {
                    ...state.conversationsByPortfolio,
                    [portfolioKey]: updateConversation(conversations, conversationIdToUpdate, conversation => ({
                        ...conversation,
                        title: message.role === 'user'
                            && !conversation.titleEdited
                            && !conversation.messages.some(item => item.role === 'user')
                            ? createConversationTitle(message.content)
                            : conversation.title,
                        updatedAt: message.createdAt,
                        messages: [...conversation.messages, message],
                    })),
                },
            };
        }),

        renameConversation: (portfolioKey, conversationIdToUpdate, title) => set(state => {
            const normalized = title.replace(/\s+/g, ' ').trim().slice(0, 120);
            if (!normalized) return state;
            const conversations = state.conversationsByPortfolio[portfolioKey] || [];
            return {
                conversationsByPortfolio: {
                    ...state.conversationsByPortfolio,
                    [portfolioKey]: updateConversation(conversations, conversationIdToUpdate, conversation => ({
                        ...conversation,
                        title: normalized,
                        titleEdited: true,
                        updatedAt: now(),
                    })),
                },
            };
        }),

        clearConversation: (portfolioKey, conversationIdToUpdate) => set(state => {
            const conversations = state.conversationsByPortfolio[portfolioKey] || [];
            return {
                conversationsByPortfolio: {
                    ...state.conversationsByPortfolio,
                    [portfolioKey]: updateConversation(conversations, conversationIdToUpdate, conversation => ({
                        ...conversation,
                        messages: [],
                        trimmedMessageCount: 0,
                        updatedAt: now(),
                    })),
                },
            };
        }),

        deleteConversation: (portfolioKey, conversationIdToDelete) => set(state => {
            const conversations = (state.conversationsByPortfolio[portfolioKey] || [])
                .filter(conversation => conversation.id !== conversationIdToDelete);
            const activeId = state.activeConversationByPortfolio[portfolioKey];
            const nextActiveId = activeId === conversationIdToDelete
                ? conversations[0]?.id
                : activeId;
            const activeConversationByPortfolio = { ...state.activeConversationByPortfolio };
            if (nextActiveId) activeConversationByPortfolio[portfolioKey] = nextActiveId;
            else delete activeConversationByPortfolio[portfolioKey];
            return {
                conversationsByPortfolio: {
                    ...state.conversationsByPortfolio,
                    [portfolioKey]: conversations,
                },
                activeConversationByPortfolio,
            };
        }),

        clearPortfolioHistory: (portfolioKey) => set(state => {
            const conversationsByPortfolio = { ...state.conversationsByPortfolio };
            const activeConversationByPortfolio = { ...state.activeConversationByPortfolio };
            delete conversationsByPortfolio[portfolioKey];
            delete activeConversationByPortfolio[portfolioKey];
            return { conversationsByPortfolio, activeConversationByPortfolio };
        }),
    }),
    {
        name: 'axiom-portfolio-chat-history',
        version: PORTFOLIO_CHAT_ARCHIVE_VERSION,
        storage: createJSONStorage(() => localStorage),
        partialize: state => ({
            archiveVersion: state.archiveVersion,
            conversationsByPortfolio: state.conversationsByPortfolio,
            activeConversationByPortfolio: state.activeConversationByPortfolio,
        }),
        merge: (persisted, current) => {
            const parsed = PortfolioChatArchiveSchema.safeParse(persisted);
            return parsed.success ? { ...current, ...parsed.data } : current;
        },
    },
));
