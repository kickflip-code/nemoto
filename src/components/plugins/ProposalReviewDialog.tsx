import { useMemo } from 'react';
import {
    AlertTriangle,
    Bot,
    Check,
    CheckCircle2,
    Database,
    FileInput,
    FileSearch,
    PackageCheck,
    ShieldCheck,
    X,
    XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    previewPluginProposal,
} from '../../plugins/proposalReview';
import {
    acceptPluginProposalTransaction,
    redoPluginPortfolioTransaction,
    undoPluginPortfolioTransaction,
    usePluginPortfolioTransactionHistory,
} from '../../host/pluginPortfolioTransactions';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProposalReviewStore, type ProposalReviewEntry } from '../../stores/useProposalReviewStore';
import {
    AxiomButton,
    AxiomDialog,
    AxiomDialogBody,
    AxiomDialogFooter,
    AxiomDialogHeader,
} from '../ui';

const statusPresentation = {
    pending: { label: 'Pending review', className: 'text-accent-warning', Icon: FileSearch },
    accepted: { label: 'Accepted', className: 'text-accent-success', Icon: CheckCircle2 },
    rejected: { label: 'Rejected', className: 'text-accent-danger', Icon: XCircle },
} as const;

const originLabel = (entry: ProposalReviewEntry): string => {
    const origin = entry.proposal.proposedBy;
    if (origin.kind === 'ai') return `AI · ${origin.modelId}`;
    if (origin.kind === 'import') return `Import · ${origin.sourceLabel}`;
    return `Plugin · ${origin.pluginId}`;
};

const operationLabel = (kind: string): string => {
    if (kind === 'core.resource.import') return 'Import resource';
    if (kind === 'semantic-record.create') return 'Create record';
    if (kind === 'semantic-relation.create') return 'Create relation';
    if (kind === 'semantic-annotation.create') return 'Create annotation';
    if (kind === 'semantic-record.update') return 'Update record';
    if (kind === 'semantic-relation.update') return 'Update relation';
    if (kind === 'semantic-annotation.update') return 'Update annotation';
    if (kind === 'semantic-record.delete') return 'Delete record';
    if (kind === 'semantic-relation.delete') return 'Delete relation';
    return 'Delete annotation';
};

interface OperationDisplay {
    type: string;
    label: string;
    detail?: string;
}

const operationDisplay = (
    operation: ProposalReviewEntry['proposal']['operations'][number],
): OperationDisplay => {
    switch (operation.kind) {
        case 'core.resource.import': {
            const source = operation.sourceLocation;
            const sourceLabel = source
                ? [source.sheetName, source.rowNumber ? `row ${source.rowNumber}` : undefined]
                    .filter(Boolean)
                    .join(' · ')
                : undefined;
            const metadataCount = Object.keys(operation.resource.metadata || {}).length;
            return {
                type: `Resource · ${operation.resource.categoryId}`,
                label: operation.resource.name,
                detail: [
                    `${metadataCount} mapped field${metadataCount === 1 ? '' : 's'}`,
                    sourceLabel,
                ].filter(Boolean).join(' · '),
            };
        }
        case 'semantic-record.create':
        case 'semantic-record.update':
            return { type: operation.record.type, label: operation.record.label };
        case 'semantic-relation.create':
        case 'semantic-relation.update':
            return { type: operation.relation.type, label: operation.relation.id };
        case 'semantic-annotation.create':
        case 'semantic-annotation.update':
            return { type: operation.annotation.type, label: operation.annotation.id };
        case 'semantic-record.delete':
        case 'semantic-relation.delete':
        case 'semantic-annotation.delete':
            return { type: operation.target.type, label: operation.target.id };
    }
};

function ProposalListItem({
    entry,
    selected,
    onSelect,
}: {
    entry: ProposalReviewEntry;
    selected: boolean;
    onSelect: () => void;
}) {
    const presentation = statusPresentation[entry.status];
    const StatusIcon = presentation.Icon;
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`w-full rounded-lg border p-3 text-left transition-colors ${
                selected
                    ? 'border-accent-primary/50 bg-accent-primary/10'
                    : 'border-app-border bg-app-surface hover:bg-app-hover'
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-text-main">{entry.proposal.title}</div>
                    <div className="mt-1 truncate text-[10px] text-text-muted">{originLabel(entry)}</div>
                </div>
                <StatusIcon size={14} className={`mt-0.5 shrink-0 ${presentation.className}`} />
            </div>
            <div className="mt-2 text-[10px] text-text-faint">
                {entry.proposal.operations.length} atomic operation{entry.proposal.operations.length === 1 ? '' : 's'}
            </div>
        </button>
    );
}

export default function ProposalReviewDialog() {
    const portfolio = usePortfolioStore(state => state.portfolio);
    const {
        entries,
        selectedProposalId,
        closeReview,
        selectProposal,
        markAccepted,
        markRejected,
        clearResolved,
    } = useProposalReviewStore();
    const selected = entries.find(entry => entry.proposal.id === selectedProposalId) || entries[0];
    const preview = useMemo(() => (
        selected?.status === 'pending'
            ? previewPluginProposal(selected.proposal, portfolio)
            : undefined
    ), [portfolio, selected]);
    const pendingCount = entries.filter(entry => entry.status === 'pending').length;
    const resolvedCount = entries.length - pendingCount;
    const undoTransactionId = usePluginPortfolioTransactionHistory(
        state => state.past[state.past.length - 1]?.id,
    );
    const redoTransactionId = usePluginPortfolioTransactionHistory(
        state => state.future[state.future.length - 1]?.id,
    );
    const canUndoSelected = selected?.status === 'accepted'
        && undoTransactionId === selected.proposal.id;
    const canRedoSelected = selected?.status === 'accepted'
        && redoTransactionId === selected.proposal.id;

    const acceptSelected = () => {
        if (!selected || selected.status !== 'pending') return;
        try {
            const result = acceptPluginProposalTransaction(
                selected.proposal,
                usePortfolioStore.getState().changeRevision,
            );
            markAccepted(selected.proposal.id, result.portfolioRevision);
            toast.success('Proposal accepted and added to the portfolio');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Proposal could not be applied');
        }
    };

    const rejectSelected = () => {
        if (!selected || selected.status !== 'pending') return;
        markRejected(selected.proposal.id);
        toast.success('Proposal rejected; the portfolio was not changed');
    };

    const undoAccepted = () => {
        try {
            undoPluginPortfolioTransaction();
            toast.success('Accepted transaction undone');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Transaction could not be undone');
        }
    };

    const redoAccepted = () => {
        try {
            redoPluginPortfolioTransaction();
            toast.success('Accepted transaction reapplied');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Transaction could not be reapplied');
        }
    };

    return (
        <AxiomDialog
            aria-describedby="proposal-review-description"
            aria-labelledby="proposal-review-title"
            closeOnBackdrop={false}
            onClose={closeReview}
            panelClassName="flex h-[82vh] w-[92vw] max-w-6xl flex-col overflow-hidden"
        >
            <AxiomDialogHeader className="flex h-16 shrink-0 items-center justify-between border-b px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-primary">
                        <ShieldCheck size={19} />
                    </div>
                    <div className="min-w-0">
                        <h2 id="proposal-review-title" className="text-sm font-bold text-text-main">Proposal review</h2>
                        <p id="proposal-review-description" className="text-[11px] text-text-muted">
                            Nemoto validates every requested change before it can reach the portfolio.
                        </p>
                    </div>
                </div>
                <AxiomButton aria-label="Close proposal review" icon variant="ghost" onClick={closeReview}>
                    <X size={18} />
                </AxiomButton>
            </AxiomDialogHeader>

            <AxiomDialogBody className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden p-0">
                <aside className="flex min-h-0 flex-col border-r border-app-border bg-app-sidebar">
                    <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Review queue</div>
                            <div className="mt-0.5 text-[11px] text-text-muted">{pendingCount} pending · {resolvedCount} resolved</div>
                        </div>
                        {resolvedCount > 0 && (
                            <AxiomButton size="sm" variant="ghost" onClick={clearResolved}>Clear</AxiomButton>
                        )}
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                        {entries.map(entry => (
                            <ProposalListItem
                                key={entry.proposal.id}
                                entry={entry}
                                selected={entry.proposal.id === selected?.proposal.id}
                                onSelect={() => selectProposal(entry.proposal.id)}
                            />
                        ))}
                        {entries.length === 0 && (
                            <div className="rounded-lg border border-dashed border-app-border p-5 text-center text-xs text-text-muted">
                                No proposals are waiting for review.
                            </div>
                        )}
                    </div>
                </aside>

                <section className="min-h-0 overflow-y-auto bg-app-surface">
                    {!selected ? (
                        <div className="flex h-full items-center justify-center text-sm text-text-muted">Select a proposal to inspect it.</div>
                    ) : (
                        <div className="mx-auto max-w-4xl space-y-5 p-6">
                            <div className="rounded-xl border border-app-border bg-app-bg p-5">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-accent-primary">
                                            {selected.proposal.proposedBy.kind === 'ai'
                                                ? <Bot size={13} />
                                                : selected.proposal.proposedBy.kind === 'import'
                                                    ? <FileInput size={13} />
                                                    : <PackageCheck size={13} />}
                                            {originLabel(selected)}
                                        </div>
                                        <h3 className="mt-2 text-xl font-bold text-text-main">{selected.proposal.title}</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-text-muted">{selected.proposal.summary}</p>
                                    </div>
                                    <div className={`flex items-center gap-1.5 rounded-full border border-app-border px-3 py-1.5 text-[10px] font-semibold ${statusPresentation[selected.status].className}`}>
                                        {statusPresentation[selected.status].label}
                                    </div>
                                </div>
                                <div className="mt-4 border-t border-app-border pt-4">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Why this change is proposed</div>
                                    <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{selected.proposal.rationale}</p>
                                </div>
                            </div>

                            {selected.status !== 'pending' && (
                                <div className={`flex items-start gap-3 rounded-lg border p-4 ${
                                    selected.status === 'accepted'
                                        ? 'border-accent-success/20 bg-accent-success/10'
                                        : 'border-accent-danger/20 bg-accent-danger/10'
                                }`}>
                                    {selected.status === 'accepted'
                                        ? <CheckCircle2 size={18} className="mt-0.5 text-accent-success" />
                                        : <XCircle size={18} className="mt-0.5 text-accent-danger" />}
                                    <div>
                                        <div className="text-xs font-semibold text-text-main">
                                            {selected.status === 'accepted'
                                                ? canRedoSelected
                                                    ? 'Accepted transaction is currently undone'
                                                    : 'Applied atomically'
                                                : 'Rejected without changes'}
                                        </div>
                                        <div className="mt-1 text-[11px] text-text-muted">
                                            {selected.resolution?.resolvedAt
                                                ? new Date(selected.resolution.resolvedAt).toLocaleString()
                                                : 'Resolved in this session'}
                                        </div>
                                        {canUndoSelected && (
                                            <AxiomButton size="sm" className="mt-3" onClick={undoAccepted}>
                                                Undo accepted change
                                            </AxiomButton>
                                        )}
                                        {canRedoSelected && (
                                            <AxiomButton size="sm" className="mt-3" onClick={redoAccepted}>
                                                Reapply accepted change
                                            </AxiomButton>
                                        )}
                                    </div>
                                </div>
                            )}

                            {preview && (
                                <div className={`rounded-lg border p-4 ${
                                    preview.valid
                                        ? 'border-accent-success/20 bg-accent-success/5'
                                        : 'border-accent-danger/20 bg-accent-danger/5'
                                }`}>
                                    <div className="flex items-start gap-3">
                                        {preview.valid
                                            ? <CheckCircle2 size={18} className="mt-0.5 text-accent-success" />
                                            : <AlertTriangle size={18} className="mt-0.5 text-accent-danger" />}
                                        <div className="min-w-0 flex-1">
                                            <div className="text-xs font-semibold text-text-main">
                                                {preview.valid ? 'Ready for atomic apply' : 'Cannot be applied safely'}
                                            </div>
                                            <div className="mt-1 text-[11px] text-text-muted">
                                                All operations are accepted together, or none of them are written.
                                            </div>
                                                    {preview.diagnostics.length > 0 && (
                                                        <ul className="mt-3 space-y-2">
                                                            {preview.diagnostics.map((diagnostic, index) => (
                                                                <li
                                                                    key={`${diagnostic.code}-${diagnostic.path}-${index}`}
                                                                    className={`text-[11px] ${diagnostic.severity === 'error' ? 'text-accent-danger' : 'text-accent-warning'}`}
                                                                >
                                                                    {diagnostic.message}
                                                                </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {preview && (
                                preview.coreResources ? (
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="rounded-lg border border-app-border bg-app-bg p-4">
                                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                                                <Database size={13} /> Resources
                                            </div>
                                            <div className="mt-2 text-lg font-bold text-text-main">
                                                {preview.coreResources.before} <span className="text-text-faint">→</span> {preview.coreResources.after}
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-app-border bg-app-bg p-4">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Staged import</div>
                                            <div className="mt-2 text-lg font-bold text-text-main">{preview.coreResources.created}</div>
                                            <div className="mt-1 text-[10px] text-text-muted">create-only resources</div>
                                        </div>
                                        <div className="rounded-lg border border-app-border bg-app-bg p-4">
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Mapped data</div>
                                            <div className="mt-2 text-lg font-bold text-text-main">{preview.coreResources.metadataFields}</div>
                                            <div className="mt-1 text-[10px] text-text-muted">
                                                fields · {preview.coreResources.categories} categor{preview.coreResources.categories === 1 ? 'y' : 'ies'}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-3">
                                        {(['records', 'relations', 'annotations'] as const).map(key => (
                                            <div key={key} className="rounded-lg border border-app-border bg-app-bg p-4">
                                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                                                    <Database size={13} /> {key}
                                                </div>
                                                <div className="mt-2 text-lg font-bold text-text-main">
                                                    {preview.before[key]} <span className="text-text-faint">→</span> {preview.after[key]}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )
                            )}

                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <h4 className="text-xs font-bold uppercase tracking-wider text-text-faint">Requested changes</h4>
                                    <span className="text-[10px] text-text-muted">{selected.proposal.operations.length} operations</span>
                                </div>
                                <div className="space-y-2">
                                    {selected.proposal.operations.map(operation => {
                                        const display = operationDisplay(operation);
                                        return (
                                            <div key={operation.operationId} className="flex items-start gap-3 rounded-lg border border-app-border bg-app-bg p-3">
                                                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent-primary/10 text-accent-primary">
                                                    <Check size={14} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                        <span className="text-xs font-semibold text-text-main">{operationLabel(operation.kind)}</span>
                                                        <span className="text-[10px] text-text-faint">{display.type}</span>
                                                    </div>
                                                    <div className="mt-1 text-[11px] text-text-muted">
                                                        {display.label}
                                                    </div>
                                                    {display.detail && (
                                                        <div className="mt-1 text-[10px] text-text-faint">{display.detail}</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </AxiomDialogBody>

            <AxiomDialogFooter className="flex min-h-16 shrink-0 items-center justify-between border-t px-5 py-3">
                <div className="text-[10px] text-text-faint">
                    Review state is session-only. Accepted changes are saved with the portfolio.
                </div>
                <div className="flex items-center gap-2">
                    <AxiomButton onClick={closeReview}>Close</AxiomButton>
                    {selected?.status === 'pending' && (
                        <>
                            <AxiomButton variant="danger" onClick={rejectSelected}>Reject</AxiomButton>
                            <AxiomButton
                                variant="primary"
                                disabled={!preview?.valid}
                                onClick={acceptSelected}
                            >
                                <ShieldCheck size={15} /> Accept proposal
                            </AxiomButton>
                        </>
                    )}
                </div>
            </AxiomDialogFooter>
        </AxiomDialog>
    );
}
