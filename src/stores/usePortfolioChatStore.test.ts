import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PortfolioChatConversationContext } from '../ai/portfolioChatHistory';
import { usePortfolioChatStore } from './usePortfolioChatStore';

const context: PortfolioChatConversationContext = {
    processId: 'process-1',
    scope: 'process',
    label: 'Handle requests',
    detail: 'Pinned process',
    baseRevision: 'revision-1',
    selection: null,
};

const reset = () => {
    localStorage.removeItem('axiom-portfolio-chat-history');
    usePortfolioChatStore.setState({
        archiveVersion: 1,
        conversationsByPortfolio: {},
        activeConversationByPortfolio: {},
    });
};

describe('Portfolio Chat local archive', () => {
    beforeEach(reset);
    afterEach(reset);

    it('stores transcript data locally without a portfolio snapshot or model endpoint', () => {
        const store = usePortfolioChatStore.getState();
        const conversationId = store.createConversation('main', context);
        store.appendMessage('main', conversationId, {
            id: 'message-user',
            role: 'user',
            content: 'Which handoff needs attention first?',
            createdAt: '2026-08-15T10:00:00.000Z',
        });
        store.appendMessage('main', conversationId, {
            id: 'message-assistant',
            role: 'assistant',
            content: 'Review the specialist handoff.',
            createdAt: '2026-08-15T10:00:01.000Z',
            modelId: 'local-model',
            citations: [],
            sharedSourceCount: 8,
            omittedSourceCount: 0,
            retrieval: {
                strategy: 'lexical-v1',
                baseRevision: 'retrieval-revision-1',
                indexedSourceCount: 42,
                matchedSourceCount: 5,
                returnedSourceCount: 1,
                fallbackUsed: false,
                sources: [{
                    sourceId: 'process:process-1',
                    label: 'Handle requests',
                    reason: 'match',
                    reference: {
                        schema: 'axiom.entity-reference',
                        schemaVersion: 1,
                        kind: 'core.process',
                        id: 'process-1',
                    },
                }],
            },
        });

        const saved = localStorage.getItem('axiom-portfolio-chat-history') || '';
        expect(saved).toContain('Which handoff needs attention first?');
        expect(saved).toContain('Review the specialist handoff.');
        expect(saved).not.toContain('localAiEndpoint');
        expect(saved).not.toContain('processes');
        expect(saved).not.toContain('assets');

        const conversation = usePortfolioChatStore.getState().conversationsByPortfolio.main[0];
        expect(conversation.title).toBe('Which handoff needs attention first?');
        expect(conversation.messages).toHaveLength(2);
        expect(conversation.messages[1]).toMatchObject({
            retrieval: {
                baseRevision: 'retrieval-revision-1',
                indexedSourceCount: 42,
                returnedSourceCount: 1,
            },
        });
    });

    it('keeps independent conversations and supports activation, rename, clear, and delete', () => {
        const store = usePortfolioChatStore.getState();
        const firstId = store.createConversation('main', context);
        const secondId = store.createConversation('main', {
            ...context,
            processId: 'process-2',
            label: 'Resolve incidents',
        });

        store.renameConversation('main', firstId, '  Handoff review  ');
        store.setActiveConversation('main', firstId);
        expect(usePortfolioChatStore.getState().activeConversationByPortfolio.main).toBe(firstId);
        expect(usePortfolioChatStore.getState().conversationsByPortfolio.main
            .find(conversation => conversation.id === firstId)?.title).toBe('Handoff review');

        store.appendMessage('main', firstId, {
            id: 'question',
            role: 'user',
            content: 'Question',
            createdAt: '2026-08-15T10:00:00.000Z',
        });
        store.clearConversation('main', firstId);
        expect(usePortfolioChatStore.getState().conversationsByPortfolio.main
            .find(conversation => conversation.id === firstId)?.messages).toEqual([]);

        store.deleteConversation('main', firstId);
        expect(usePortfolioChatStore.getState().conversationsByPortfolio.main.map(item => item.id))
            .toEqual([secondId]);
        expect(usePortfolioChatStore.getState().activeConversationByPortfolio.main).toBe(secondId);

        store.clearPortfolioHistory('main');
        expect(usePortfolioChatStore.getState().conversationsByPortfolio.main).toBeUndefined();
        expect(usePortfolioChatStore.getState().activeConversationByPortfolio.main).toBeUndefined();
    });

    it('rehydrates the archive from device storage', async () => {
        const store = usePortfolioChatStore.getState();
        const conversationId = store.createConversation('main', context);
        store.appendMessage('main', conversationId, {
            id: 'saved-question',
            role: 'user',
            content: 'Remember this transcript in Axiom.',
            createdAt: '2026-08-15T10:00:00.000Z',
        });
        const saved = localStorage.getItem('axiom-portfolio-chat-history');
        expect(saved).toBeTruthy();

        usePortfolioChatStore.setState({
            archiveVersion: 1,
            conversationsByPortfolio: {},
            activeConversationByPortfolio: {},
        });
        localStorage.setItem('axiom-portfolio-chat-history', saved!);
        await usePortfolioChatStore.persist.rehydrate();

        expect(usePortfolioChatStore.getState().conversationsByPortfolio.main[0].messages[0].content)
            .toBe('Remember this transcript in Axiom.');
    });
});
