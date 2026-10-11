import { create } from 'zustand';
import type { Portfolio } from '../types';
import {
    applyPluginDataMigration,
    PluginDataMigrationPlanSchema,
    type PluginDataMigrationResult,
} from '../plugins/pluginDataMigrations';
import {
    applyPluginProposal,
    type PluginProposalApplicationResult,
} from '../plugins/proposalReview';
import { createPortfolioRevision } from '../plugins/portfolioRevision';
import type { PluginProposal } from '../plugins/proposals';
import {
    PluginHostPermissionError,
    PluginHostRevisionConflictError,
} from '../plugins/hostServices';
import { usePluginStore } from '../stores/usePluginStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { replacePortfolioFromPluginHost } from './pluginHostServices';
import { pluginDeveloperDiagnostics } from './pluginDeveloperDiagnostics';

const MAX_TRANSACTION_HISTORY = 50;

interface PluginPortfolioTransactionEntry {
    id: string;
    kind: 'proposal' | 'migration';
    pluginId: string;
    before: Portfolio;
    after: Portfolio;
    beforeRevision: string;
    afterRevision: string;
}

interface PluginPortfolioTransactionHistoryState {
    past: PluginPortfolioTransactionEntry[];
    future: PluginPortfolioTransactionEntry[];
    reset: () => void;
}

export interface PluginPortfolioTransactionResult {
    revision: number;
    portfolioRevision: string;
    transactionId: string;
}

export interface AcceptedPluginProposalResult extends PluginPortfolioTransactionResult {
    application: PluginProposalApplicationResult;
}

export interface AppliedPluginDataMigrationResult extends PluginPortfolioTransactionResult {
    migration: PluginDataMigrationResult;
}

export class PluginPortfolioHistoryConflictError extends Error {
    constructor(
        readonly expectedRevision: string,
        readonly actualRevision: string,
    ) {
        super('The portfolio changed after this transaction. Undo or redo would overwrite unrelated work.');
        this.name = 'PluginPortfolioHistoryConflictError';
    }
}

export class PluginPortfolioHistoryEmptyError extends Error {
    constructor(readonly direction: 'undo' | 'redo') {
        super(`There is no plugin portfolio transaction to ${direction}.`);
        this.name = 'PluginPortfolioHistoryEmptyError';
    }
}

const cloneJsonDocument = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

export const usePluginPortfolioTransactionHistory = create<PluginPortfolioTransactionHistoryState>(set => ({
    past: [],
    future: [],
    reset: () => set({ past: [], future: [] }),
}));

const requireRevision = (expectedRevision: number) => {
    const actualRevision = usePortfolioStore.getState().changeRevision;
    if (actualRevision !== expectedRevision) {
        throw new PluginHostRevisionConflictError(expectedRevision, actualRevision);
    }
};

const requireCapability = (pluginId: string, capability: 'proposal.create' | 'plugin-data.write') => {
    if (!usePluginStore.getState().hasGrant(pluginId, capability)) {
        pluginDeveloperDiagnostics.recordPermissionDenied(pluginId, capability);
        throw new PluginHostPermissionError(pluginId, capability);
    }
};

function recordTransaction(entry: PluginPortfolioTransactionEntry): void {
    usePluginPortfolioTransactionHistory.setState(state => ({
        past: [...state.past, entry].slice(-MAX_TRANSACTION_HISTORY),
        future: [],
    }));
}

export function acceptPluginProposalTransaction(
    proposal: PluginProposal,
    expectedRevision: number,
): AcceptedPluginProposalResult {
    requireCapability(proposal.proposedBy.pluginId, 'proposal.create');
    requireRevision(expectedRevision);
    const state = usePortfolioStore.getState();
    const before = cloneJsonDocument(state.portfolio);
    const beforeRevision = createPortfolioRevision(before);
    const application = applyPluginProposal(proposal, state.portfolio);
    const afterRevision = createPortfolioRevision(application.portfolio);

    replacePortfolioFromPluginHost(application.portfolio, {
        kind: 'plugin',
        operation: 'proposal.transaction.apply',
        pluginId: proposal.proposedBy.pluginId,
    });
    recordTransaction({
        id: proposal.id,
        kind: 'proposal',
        pluginId: proposal.proposedBy.pluginId,
        before,
        after: cloneJsonDocument(application.portfolio),
        beforeRevision,
        afterRevision,
    });
    return {
        application,
        revision: usePortfolioStore.getState().changeRevision,
        portfolioRevision: afterRevision,
        transactionId: proposal.id,
    };
}

export function applyPluginDataMigrationTransaction(
    input: unknown,
    expectedRevision: number,
): AppliedPluginDataMigrationResult {
    const plan = PluginDataMigrationPlanSchema.parse(input);
    requireCapability(plan.pluginId, 'plugin-data.write');
    requireRevision(expectedRevision);
    const state = usePortfolioStore.getState();
    const before = cloneJsonDocument(state.portfolio);
    const beforeRevision = createPortfolioRevision(before);
    const migration = applyPluginDataMigration(plan, state.portfolio);
    const afterRevision = createPortfolioRevision(migration.portfolio);

    replacePortfolioFromPluginHost(migration.portfolio, {
        kind: 'plugin',
        operation: `plugin-data.migration.${migration.status}`,
        pluginId: plan.pluginId,
    });
    if (migration.status === 'succeeded') {
        recordTransaction({
            id: plan.id,
            kind: 'migration',
            pluginId: plan.pluginId,
            before,
            after: cloneJsonDocument(migration.portfolio),
            beforeRevision,
            afterRevision,
        });
    }
    return {
        migration,
        revision: usePortfolioStore.getState().changeRevision,
        portfolioRevision: afterRevision,
        transactionId: plan.id,
    };
}

export function undoPluginPortfolioTransaction(): PluginPortfolioTransactionResult {
    const history = usePluginPortfolioTransactionHistory.getState();
    const entry = history.past[history.past.length - 1];
    if (!entry) throw new PluginPortfolioHistoryEmptyError('undo');
    const actualRevision = createPortfolioRevision(usePortfolioStore.getState().portfolio);
    if (actualRevision !== entry.afterRevision) {
        throw new PluginPortfolioHistoryConflictError(entry.afterRevision, actualRevision);
    }

    replacePortfolioFromPluginHost(cloneJsonDocument(entry.before), {
        kind: 'host',
        operation: `${entry.kind}.transaction.undo`,
        pluginId: entry.pluginId,
    });
    usePluginPortfolioTransactionHistory.setState(state => ({
        past: state.past.slice(0, -1),
        future: [...state.future, entry].slice(-MAX_TRANSACTION_HISTORY),
    }));
    return {
        revision: usePortfolioStore.getState().changeRevision,
        portfolioRevision: entry.beforeRevision,
        transactionId: entry.id,
    };
}

export function redoPluginPortfolioTransaction(): PluginPortfolioTransactionResult {
    const history = usePluginPortfolioTransactionHistory.getState();
    const entry = history.future[history.future.length - 1];
    if (!entry) throw new PluginPortfolioHistoryEmptyError('redo');
    const actualRevision = createPortfolioRevision(usePortfolioStore.getState().portfolio);
    if (actualRevision !== entry.beforeRevision) {
        throw new PluginPortfolioHistoryConflictError(entry.beforeRevision, actualRevision);
    }

    replacePortfolioFromPluginHost(cloneJsonDocument(entry.after), {
        kind: 'host',
        operation: `${entry.kind}.transaction.redo`,
        pluginId: entry.pluginId,
    });
    usePluginPortfolioTransactionHistory.setState(state => ({
        past: [...state.past, entry].slice(-MAX_TRANSACTION_HISTORY),
        future: state.future.slice(0, -1),
    }));
    return {
        revision: usePortfolioStore.getState().changeRevision,
        portfolioRevision: entry.afterRevision,
        transactionId: entry.id,
    };
}
