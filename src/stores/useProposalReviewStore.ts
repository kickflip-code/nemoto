import { create } from 'zustand';
import { parsePluginProposal, type PluginProposal } from '../plugins/proposals';

export type ProposalReviewStatus = 'pending' | 'accepted' | 'rejected';

export interface ProposalReviewResolution {
    kind: 'accepted' | 'rejected';
    resolvedAt: string;
    portfolioRevision?: string;
}

export interface ProposalReviewEntry {
    proposal: PluginProposal;
    receivedAt: string;
    status: ProposalReviewStatus;
    resolution?: ProposalReviewResolution;
}

interface ProposalReviewState {
    entries: ProposalReviewEntry[];
    selectedProposalId: string | null;
    reviewOpen: boolean;
    submitProposal: (input: unknown) => string;
    openReview: (proposalId?: string) => void;
    closeReview: () => void;
    selectProposal: (proposalId: string) => void;
    markAccepted: (proposalId: string, portfolioRevision: string) => void;
    markRejected: (proposalId: string) => void;
    clearResolved: () => void;
    reset: () => void;
}

export class ProposalReviewQueueError extends Error {
    constructor(
        message: string,
        readonly code: 'DUPLICATE_PROPOSAL' | 'UNKNOWN_PROPOSAL' | 'ALREADY_RESOLVED' | 'QUEUE_LIMIT_REACHED',
    ) {
        super(message);
        this.name = 'ProposalReviewQueueError';
    }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (typeof value !== 'object' || value === null || seen.has(value)) return value;
    seen.add(value);
    Reflect.ownKeys(value).forEach(key => deepFreeze((value as Record<PropertyKey, unknown>)[key], seen));
    return Object.freeze(value);
}

const immutableProposal = (input: unknown): PluginProposal => deepFreeze(
    typeof structuredClone === 'function'
        ? structuredClone(parsePluginProposal(input))
        : JSON.parse(JSON.stringify(parsePluginProposal(input))) as PluginProposal,
);

const nextSelectableId = (entries: ProposalReviewEntry[], excludedId?: string): string | null => (
    entries.find(entry => entry.proposal.id !== excludedId && entry.status === 'pending')?.proposal.id
    || entries.find(entry => entry.proposal.id !== excludedId)?.proposal.id
    || null
);

export const useProposalReviewStore = create<ProposalReviewState>((set, get) => ({
    entries: [],
    selectedProposalId: null,
    reviewOpen: false,

    submitProposal: (input) => {
        const proposal = immutableProposal(input);
        if (get().entries.length >= 200) {
            throw new ProposalReviewQueueError(
                'The session review queue is full. Resolve or clear proposals before adding more.',
                'QUEUE_LIMIT_REACHED',
            );
        }
        if (get().entries.some(entry => entry.proposal.id === proposal.id)) {
            throw new ProposalReviewQueueError(
                `Proposal '${proposal.id}' is already in the review queue.`,
                'DUPLICATE_PROPOSAL',
            );
        }
        set(state => ({
            entries: [...state.entries, {
                proposal,
                receivedAt: new Date().toISOString(),
                status: 'pending' as const,
            }],
            selectedProposalId: state.selectedProposalId || proposal.id,
        }));
        return proposal.id;
    },

    openReview: (proposalId) => {
        if (proposalId && !get().entries.some(entry => entry.proposal.id === proposalId)) {
            throw new ProposalReviewQueueError(`Unknown proposal '${proposalId}'.`, 'UNKNOWN_PROPOSAL');
        }
        set(state => ({
            reviewOpen: true,
            selectedProposalId: proposalId
                || state.selectedProposalId
                || nextSelectableId(state.entries),
        }));
    },
    closeReview: () => set({ reviewOpen: false }),
    selectProposal: (proposalId) => {
        if (!get().entries.some(entry => entry.proposal.id === proposalId)) {
            throw new ProposalReviewQueueError(`Unknown proposal '${proposalId}'.`, 'UNKNOWN_PROPOSAL');
        }
        set({ selectedProposalId: proposalId });
    },

    markAccepted: (proposalId, portfolioRevision) => set(state => {
        const entry = state.entries.find(candidate => candidate.proposal.id === proposalId);
        if (!entry) throw new ProposalReviewQueueError(`Unknown proposal '${proposalId}'.`, 'UNKNOWN_PROPOSAL');
        if (entry.status !== 'pending') {
            throw new ProposalReviewQueueError(`Proposal '${proposalId}' is already resolved.`, 'ALREADY_RESOLVED');
        }
        return {
            entries: state.entries.map(candidate => candidate.proposal.id === proposalId ? {
                ...candidate,
                status: 'accepted' as const,
                resolution: {
                    kind: 'accepted' as const,
                    resolvedAt: new Date().toISOString(),
                    portfolioRevision,
                },
            } : candidate),
        };
    }),

    markRejected: (proposalId) => set(state => {
        const entry = state.entries.find(candidate => candidate.proposal.id === proposalId);
        if (!entry) throw new ProposalReviewQueueError(`Unknown proposal '${proposalId}'.`, 'UNKNOWN_PROPOSAL');
        if (entry.status !== 'pending') {
            throw new ProposalReviewQueueError(`Proposal '${proposalId}' is already resolved.`, 'ALREADY_RESOLVED');
        }
        return {
            entries: state.entries.map(candidate => candidate.proposal.id === proposalId ? {
                ...candidate,
                status: 'rejected' as const,
                resolution: {
                    kind: 'rejected' as const,
                    resolvedAt: new Date().toISOString(),
                },
            } : candidate),
        };
    }),

    clearResolved: () => set(state => {
        const entries = state.entries.filter(entry => entry.status === 'pending');
        return {
            entries,
            selectedProposalId: entries.some(entry => entry.proposal.id === state.selectedProposalId)
                ? state.selectedProposalId
                : nextSelectableId(entries),
        };
    }),
    reset: () => set({ entries: [], selectedProposalId: null, reviewOpen: false }),
}));
