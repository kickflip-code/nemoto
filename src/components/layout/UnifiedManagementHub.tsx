import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    BookOpen,
    Box,
    CheckCircle2,
    ChevronRight,
    GitMerge,
    Library,
    Link2Off,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import type { Asset, Process } from '../../types';
import type { JournalEntry, JournalNotebook } from '../../types/journal';
import { createPortfolioManagementSummary } from '../../lib/portfolioManagement';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import {
    AxiomButton,
    AxiomInput,
    AxiomSegmented,
    AxiomSegmentedOption,
} from '../ui';
import ConfirmationModal from '../shared/ConfirmationModal';
import PowerTable, { type Column } from '../shared/PowerTable';
import PowerViewModal from '../shared/PowerViewModal';

interface UnifiedManagementHubProps {
    isOpen: boolean;
    onClose: () => void;
}

type HubView = 'overview' | 'content';
type ContentKind = 'processes' | 'assets' | 'journal' | 'notebooks';

interface ProcessDeleteReview {
    processIds: string[];
    orphanAssets: Asset[];
    orphanJournals: JournalEntry[];
}

interface ConfirmDialogState {
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'primary';
}

const CONTENT_ORDER: ContentKind[] = ['processes', 'assets', 'journal', 'notebooks'];

const CONTENT_META: Record<ContentKind, {
    label: string;
    description: string;
    icon: typeof Box;
}> = {
    processes: {
        label: 'Processes',
        description: 'Process maps and their latest changes.',
        icon: GitMerge,
    },
    assets: {
        label: 'Resources',
        description: 'Systems, roles, documents, hardware, and other shared context.',
        icon: Box,
    },
    journal: {
        label: 'Notes',
        description: 'Journal entries and the portfolio context they explain.',
        icon: BookOpen,
    },
    notebooks: {
        label: 'Notebooks',
        description: 'The collections used to keep journal work organized.',
        icon: Library,
    },
};

const formatDate = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString();
};

const includesSearch = (searchTerm: string, ...values: unknown[]): boolean => (
    !searchTerm || values.some(value => String(value ?? '').toLocaleLowerCase().includes(searchTerm))
);

export default function UnifiedManagementHub({ isOpen, onClose }: UnifiedManagementHubProps) {
    const { portfolio, deleteAssets, deleteProcess, deleteEntry, deleteNotebook } = usePortfolioStore();
    const [view, setView] = useState<HubView>('overview');
    const [contentKind, setContentKind] = useState<ContentKind>('processes');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [unlinkedOnly, setUnlinkedOnly] = useState(false);
    const [deleteReview, setDeleteReview] = useState<ProcessDeleteReview | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

    const summary = useMemo(() => createPortfolioManagementSummary(portfolio), [portfolio]);
    const unusedAssetIds = useMemo(
        () => new Set(summary.attention.unusedAssetIds),
        [summary.attention.unusedAssetIds],
    );
    const unlinkedJournalEntryIds = useMemo(
        () => new Set(summary.attention.unlinkedJournalEntryIds),
        [summary.attention.unlinkedJournalEntryIds],
    );
    const emptyNotebookIds = useMemo(
        () => new Set(summary.attention.emptyNotebookIds),
        [summary.attention.emptyNotebookIds],
    );

    const searchTerm = searchQuery.trim().toLocaleLowerCase();
    const assetCategories = portfolio.assetCategories;
    const processes = portfolio.processes;
    const journalEntries = portfolio.journal.entries;

    const visibleAssets = portfolio.assets.filter(asset => (
        (!unlinkedOnly || unusedAssetIds.has(asset.id))
        && includesSearch(
            searchTerm,
            asset.name,
            asset.id,
            assetCategories.find(category => category.id === asset.type)?.label,
        )
    ));
    const visibleProcesses = portfolio.processes.filter(process => includesSearch(
        searchTerm,
        process.title,
        process.description,
        process.id,
    ));
    const visibleJournalEntries = portfolio.journal.entries.filter(entry => (
        (!unlinkedOnly || unlinkedJournalEntryIds.has(entry.id))
        && includesSearch(searchTerm, entry.title, entry.content, entry.id)
    ));
    const visibleNotebooks = portfolio.journal.notebooks.filter(notebook => (
        (!unlinkedOnly || emptyNotebookIds.has(notebook.id))
        && includesSearch(searchTerm, notebook.title, notebook.id)
    ));

    const assetColumns = useMemo<Column<Asset>[]>(() => [
        {
            key: 'name',
            header: 'Name',
            sortable: true,
            render: asset => <span className="font-medium text-text-main">{asset.name}</span>,
        },
        {
            key: 'type',
            header: 'Category',
            sortable: true,
            render: asset => (
                <span className="text-text-muted">
                    {assetCategories.find(category => category.id === asset.type)?.label || 'Uncategorized'}
                </span>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            render: asset => unusedAssetIds.has(asset.id)
                ? <span className="text-text-muted">Unlinked</span>
                : <span className="text-text-muted">In use</span>,
        },
    ], [assetCategories, unusedAssetIds]);

    const processColumns = useMemo<Column<Process>[]>(() => [
        {
            key: 'title',
            header: 'Title',
            sortable: true,
            render: process => <span className="font-medium text-text-main">{process.title}</span>,
        },
        {
            key: 'nodes',
            header: 'Items',
            render: process => <span className="text-text-muted">{process.graph.nodes.length}</span>,
        },
        {
            key: 'updatedAt',
            header: 'Last modified',
            sortable: true,
            render: process => <span className="text-text-muted">{formatDate(process.updatedAt)}</span>,
        },
    ], []);

    const journalColumns = useMemo<Column<JournalEntry>[]>(() => [
        {
            key: 'title',
            header: 'Title',
            sortable: true,
            render: entry => <span className="font-medium text-text-main">{entry.title || 'Untitled note'}</span>,
        },
        {
            key: 'context',
            header: 'Linked context',
            render: entry => {
                const count = entry.linkedContext?.length || 0;
                return count === 0
                    ? <span className="text-text-muted">No links</span>
                    : <span className="text-text-muted">{count} {count === 1 ? 'link' : 'links'}</span>;
            },
        },
        {
            key: 'updatedAt',
            header: 'Last modified',
            sortable: true,
            render: entry => <span className="text-text-muted">{formatDate(entry.updatedAt || entry.createdAt)}</span>,
        },
    ], []);

    const notebookColumns = useMemo<Column<JournalNotebook>[]>(() => [
        {
            key: 'title',
            header: 'Title',
            sortable: true,
            render: notebook => <span className="font-medium text-text-main">{notebook.title || 'Untitled notebook'}</span>,
        },
        {
            key: 'entries',
            header: 'Notes',
            render: notebook => {
                const count = journalEntries.filter(entry => entry.notebookId === notebook.id).length;
                return count === 0
                    ? <span className="text-text-muted">Empty</span>
                    : <span className="text-text-muted">{count}</span>;
            },
        },
        {
            key: 'updatedAt',
            header: 'Last modified',
            sortable: true,
            render: notebook => <span className="text-text-muted">{formatDate(notebook.updatedAt)}</span>,
        },
    ], [journalEntries]);

    const contentConfig = {
        processes: {
            data: visibleProcesses,
            columns: processColumns,
            emptyTitle: searchTerm ? 'No matching processes' : 'No processes yet',
            emptyMessage: searchTerm ? 'Try another search term.' : 'Create a process to begin mapping the portfolio.',
        },
        assets: {
            data: visibleAssets,
            columns: assetColumns,
            emptyTitle: searchTerm || unlinkedOnly ? 'No matching resources' : 'No resources yet',
            emptyMessage: unlinkedOnly
                ? 'No unlinked resources were found.'
                : searchTerm ? 'Try another search term.' : 'Resources appear here when they are created or imported.',
        },
        journal: {
            data: visibleJournalEntries,
            columns: journalColumns,
            emptyTitle: searchTerm || unlinkedOnly ? 'No matching notes' : 'No notes yet',
            emptyMessage: unlinkedOnly
                ? 'No unlinked notes were found.'
                : searchTerm ? 'Try another search term.' : 'Journal notes appear here when they are created or imported.',
        },
        notebooks: {
            data: visibleNotebooks,
            columns: notebookColumns,
            emptyTitle: searchTerm || unlinkedOnly ? 'No matching notebooks' : 'No notebooks yet',
            emptyMessage: unlinkedOnly
                ? 'Every notebook contains at least one note.'
                : searchTerm ? 'Try another search term.' : 'Notebooks appear here when journal work is organized.',
        },
    };

    const activeConfig = contentConfig[contentKind];
    const activeMeta = CONTENT_META[contentKind];
    const ActiveIcon = activeMeta.icon;
    const unlinkedCountForKind = contentKind === 'assets'
        ? summary.attention.unusedAssetIds.length
        : contentKind === 'journal'
            ? summary.attention.unlinkedJournalEntryIds.length
            : contentKind === 'notebooks'
                ? summary.attention.emptyNotebookIds.length
                : 0;
    const unlinkedTotal = summary.attention.unusedAssetIds.length
        + summary.attention.unlinkedJournalEntryIds.length
        + summary.attention.emptyNotebookIds.length;
    const unlinkedFilterLabel = contentKind === 'notebooks' ? 'Empty' : 'Unlinked';
    const totalCountForKind = contentKind === 'processes'
        ? summary.counts.processes
        : contentKind === 'assets'
            ? summary.counts.assets
            : contentKind === 'journal'
                ? summary.counts.journalEntries
                : summary.counts.notebooks;

    const selectView = (nextView: HubView) => {
        setView(nextView);
        setSelectedIds(new Set());
        setSearchQuery('');
        setUnlinkedOnly(false);
    };

    const openContent = (kind: ContentKind, onlyAttention = false) => {
        setView('content');
        setContentKind(kind);
        setSelectedIds(new Set());
        setSearchQuery('');
        setUnlinkedOnly(onlyAttention);
    };

    const selectContentKind = (kind: ContentKind) => {
        setContentKind(kind);
        setSelectedIds(new Set());
        setSearchQuery('');
        setUnlinkedOnly(false);
    };

    const reviewProcessDeletion = () => {
        const processIds = [...selectedIds];
        const assetsInDeleted = new Set<string>();
        processes.filter(process => processIds.includes(process.id)).forEach(process => {
            if (process.ownerId) assetsInDeleted.add(process.ownerId);
            const collect = (node: Process['graph']['nodes'][number]) => {
                node.assetIds?.forEach(id => assetsInDeleted.add(id));
                const resourceId = getResourceReferenceAssetId(node);
                if (resourceId) assetsInDeleted.add(resourceId);
            };
            process.graph.nodes.forEach(collect);
            Object.values(process.subGraphs || {}).forEach(graph => {
                graph.nodes.forEach(collect);
            });
        });

        const assetsStillUsed = new Set<string>();
        processes.filter(process => !processIds.includes(process.id)).forEach(process => {
            if (process.ownerId) assetsStillUsed.add(process.ownerId);
            const collect = (node: Process['graph']['nodes'][number]) => {
                node.assetIds?.forEach(id => assetsStillUsed.add(id));
                const resourceId = getResourceReferenceAssetId(node);
                if (resourceId) assetsStillUsed.add(resourceId);
            };
            process.graph.nodes.forEach(collect);
            Object.values(process.subGraphs || {}).forEach(graph => {
                graph.nodes.forEach(collect);
            });
        });
        portfolio.assets.forEach(asset => {
            if (asset.parentId) assetsStillUsed.add(asset.parentId);
        });
        journalEntries.forEach(entry => entry.linkedContext?.forEach(reference => {
            if (reference.type === 'asset') assetsStillUsed.add(reference.id);
        }));

        const orphanAssets = portfolio.assets.filter(asset => (
            assetsInDeleted.has(asset.id) && !assetsStillUsed.has(asset.id)
        ));
        const orphanJournals = journalEntries.filter(entry => {
            if (!entry.linkedContext?.length) return false;
            const linksToDeleted = entry.linkedContext.some(reference => (
                reference.type === 'process' && processIds.includes(reference.id)
            ));
            const linksElsewhere = entry.linkedContext.some(reference => !(
                reference.type === 'process' && processIds.includes(reference.id)
            ));
            return linksToDeleted && !linksElsewhere;
        });

        setDeleteReview({ processIds, orphanAssets, orphanJournals });
    };

    const handleDelete = () => {
        if (selectedIds.size === 0) return;
        const ids = [...selectedIds];

        if (contentKind === 'processes') {
            reviewProcessDeletion();
            return;
        }

        const label = contentKind === 'assets' ? 'resources' : contentKind === 'journal' ? 'notes' : 'notebooks';
        setConfirmDialog({
            title: `Delete ${label}`,
            message: `Delete ${ids.length} selected ${label}? This action cannot be undone.`,
            variant: 'danger',
            onConfirm: () => {
                if (contentKind === 'assets') deleteAssets(ids);
                if (contentKind === 'journal') ids.forEach(deleteEntry);
                if (contentKind === 'notebooks') ids.forEach(deleteNotebook);
                setSelectedIds(new Set());
            },
        });
    };

    return (
        <PowerViewModal
            title="Manage portfolio"
            isOpen={isOpen}
            onClose={onClose}
            actions={view === 'content' && selectedIds.size > 0 ? (
                <AxiomButton size="sm" variant="danger" onClick={handleDelete}>
                    <Trash2 size={14} />
                    Delete {selectedIds.size}
                </AxiomButton>
            ) : undefined}
        >
            <div className="flex h-full min-h-0 flex-col bg-app-bg">
                <div className="flex h-14 shrink-0 items-center border-b border-app-border bg-app-sidebar/35 px-6">
                    <AxiomSegmented aria-label="Portfolio view">
                        <AxiomSegmentedOption active={view === 'overview'} onClick={() => selectView('overview')}>
                            Overview
                        </AxiomSegmentedOption>
                        <AxiomSegmentedOption active={view === 'content'} onClick={() => selectView('content')}>
                            Content
                        </AxiomSegmentedOption>
                    </AxiomSegmented>
                </div>

                {view === 'overview' ? (
                    <div className="flex-1 overflow-y-auto app-scroll">
                        <main className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-10">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-faint">Portfolio overview</p>
                                <h3 className="mt-2 text-2xl font-semibold text-text-main">Everything in one place</h3>
                                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                                    See how much information the portfolio contains and review it without losing the bigger picture.
                                </p>
                            </div>

                            <section aria-label="Portfolio content" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
                                {CONTENT_ORDER.map(kind => {
                                    const meta = CONTENT_META[kind];
                                    const Icon = meta.icon;
                                    const count = kind === 'processes'
                                        ? summary.counts.processes
                                        : kind === 'assets'
                                            ? summary.counts.assets
                                            : kind === 'journal'
                                                ? summary.counts.journalEntries
                                                : summary.counts.notebooks;
                                    return (
                                        <button
                                            key={kind}
                                            type="button"
                                            onClick={() => openContent(kind)}
                                            className="axiom-dialog-row group flex items-center gap-3 p-4 text-left"
                                        >
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-bg text-text-muted group-hover:text-text-main">
                                                <Icon size={17} />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xl font-semibold text-text-main">{count}</span>
                                                <span className="block text-xs text-text-muted">{meta.label}</span>
                                            </span>
                                            <ChevronRight size={15} className="text-text-faint" />
                                        </button>
                                    );
                                })}
                            </section>

                            <section aria-label="Portfolio review" className="mt-8 space-y-3">
                                {unlinkedTotal === 0 && summary.attention.integrityIssues.length === 0 ? (
                                    <div className="flex items-center gap-4 rounded-xl border border-app-border bg-app-surface/35 p-5">
                                        <CheckCircle2 size={22} className="shrink-0 text-accent-success" />
                                        <div>
                                            <h3 className="text-sm font-semibold text-text-main">Everything is in order</h3>
                                            <p className="mt-1 text-xs text-text-muted">No unlinked content or data integrity issues were found.</p>
                                        </div>
                                    </div>
                                ) : null}

                                {unlinkedTotal > 0 && (
                                    <div className="overflow-hidden rounded-xl border border-app-border bg-app-surface/35">
                                        <div className="flex items-center gap-4 border-b border-app-border px-5 py-4">
                                            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-app-border bg-app-bg text-text-muted">
                                                <Link2Off size={18} />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <h3 className="text-sm font-semibold text-text-main">
                                                    {unlinkedTotal} unlinked {unlinkedTotal === 1 ? 'item' : 'items'}
                                                </h3>
                                                <p className="mt-1 text-xs text-text-muted">This can be intentional. Use these filters only when you want to review organization.</p>
                                            </div>
                                        </div>
                                        <div className="divide-y divide-app-border">
                                            {summary.attention.unusedAssetIds.length > 0 && (
                                                <UnlinkedRow
                                                    count={summary.attention.unusedAssetIds.length}
                                                    label="Unlinked resources"
                                                    description="Resources that are not currently referenced elsewhere."
                                                    onClick={() => openContent('assets', true)}
                                                />
                                            )}
                                            {summary.attention.unlinkedJournalEntryIds.length > 0 && (
                                                <UnlinkedRow
                                                    count={summary.attention.unlinkedJournalEntryIds.length}
                                                    label="Unlinked notes"
                                                    description="Notes that do not currently link to other portfolio content."
                                                    onClick={() => openContent('journal', true)}
                                                />
                                            )}
                                            {summary.attention.emptyNotebookIds.length > 0 && (
                                                <UnlinkedRow
                                                    count={summary.attention.emptyNotebookIds.length}
                                                    label="Empty notebooks"
                                                    description="Notebooks that currently contain no notes."
                                                    onClick={() => openContent('notebooks', true)}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {summary.attention.integrityIssues.length > 0 && (
                                    <details className="group rounded-xl border border-accent-warning/25 bg-app-surface/35 px-5 py-4">
                                        <summary className="flex cursor-pointer list-none items-center gap-4">
                                            <AlertTriangle size={18} className="shrink-0 text-accent-warning" />
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-sm font-medium text-text-main">
                                                    {summary.attention.integrityIssues.length} data integrity {summary.attention.integrityIssues.length === 1 ? 'warning' : 'warnings'}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-text-muted">References or identifiers that need a closer look.</span>
                                            </span>
                                            <ChevronRight size={15} className="text-text-faint transition-transform group-open:rotate-90" />
                                        </summary>
                                        <ul className="ml-8 mt-3 space-y-2 border-l border-app-border pl-4 text-xs text-text-muted">
                                            {summary.attention.integrityIssues.slice(0, 8).map(issue => (
                                                <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
                                            ))}
                                            {summary.attention.integrityIssues.length > 8 && (
                                                <li>And {summary.attention.integrityIssues.length - 8} more.</li>
                                            )}
                                        </ul>
                                    </details>
                                )}
                            </section>
                        </main>
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="shrink-0 border-b border-app-border bg-app-sidebar/20 px-6 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <AxiomSegmented aria-label="Content type" className="max-w-full overflow-x-auto">
                                    {CONTENT_ORDER.map(kind => (
                                        <AxiomSegmentedOption
                                            key={kind}
                                            active={contentKind === kind}
                                            onClick={() => selectContentKind(kind)}
                                        >
                                            {CONTENT_META[kind].label}
                                        </AxiomSegmentedOption>
                                    ))}
                                </AxiomSegmented>
                                <span className="text-xs text-text-faint">{activeConfig.data.length} of {totalCountForKind}</span>
                            </div>

                            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <ActiveIcon size={17} className="text-text-muted" />
                                        <h3 className="text-base font-semibold text-text-main">{activeMeta.label}</h3>
                                    </div>
                                    <p className="mt-1 text-xs text-text-muted">{activeMeta.description}</p>
                                </div>
                                <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
                                    <div className="relative w-full sm:w-72">
                                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                                        <AxiomInput
                                            type="search"
                                            aria-label={`Search ${activeMeta.label.toLocaleLowerCase()}`}
                                            controlSize="sm"
                                            value={searchQuery}
                                            onChange={event => {
                                                setSearchQuery(event.target.value);
                                                setSelectedIds(new Set());
                                            }}
                                            placeholder={`Search ${activeMeta.label.toLocaleLowerCase()}...`}
                                            className="axiom-field-leading-icon axiom-field-trailing-action w-full"
                                        />
                                        {searchQuery && (
                                            <button
                                                type="button"
                                                aria-label="Clear search"
                                                onClick={() => {
                                                    setSearchQuery('');
                                                    setSelectedIds(new Set());
                                                }}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-faint hover:text-text-main"
                                            >
                                                <X size={13} />
                                            </button>
                                        )}
                                    </div>
                                    {unlinkedCountForKind > 0 && (
                                        <AxiomButton
                                            size="sm"
                                            aria-pressed={unlinkedOnly}
                                            onClick={() => {
                                                setUnlinkedOnly(current => !current);
                                                setSelectedIds(new Set());
                                            }}
                                        >
                                            <Link2Off size={14} />
                                            {unlinkedFilterLabel} · {unlinkedCountForKind}
                                        </AxiomButton>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 p-4">
                            <div className="h-full overflow-hidden rounded-xl border border-app-border bg-app-surface/35">
                                <PowerTable
                                    data={activeConfig.data as unknown as Array<Record<string, unknown>>}
                                    columns={activeConfig.columns as unknown as Column<Record<string, unknown>>[]}
                                    selectedIds={selectedIds}
                                    onSelectionChange={setSelectedIds}
                                    getItemLabel={item => String(item.title || item.name || item.id)}
                                    emptyState={{
                                        icon: <ActiveIcon size={26} />,
                                        title: activeConfig.emptyTitle,
                                        message: activeConfig.emptyMessage,
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {deleteReview && createPortal(
                <div className="fixed inset-0 z-[10300] flex items-center justify-center p-4 axiom-motion-overlay">
                    <div className="axiom-dialog-backdrop absolute inset-0" onClick={() => setDeleteReview(null)} />
                    <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-app-border bg-app-sidebar shadow-2xl axiom-motion-dialog">
                        <div className="flex items-center justify-between border-b border-app-border bg-app-header px-6 py-4">
                            <h3 className="flex items-center gap-2 font-semibold text-text-main">
                                <AlertTriangle size={18} className="text-accent-danger" />
                                Review process deletion
                            </h3>
                            <AxiomButton icon size="sm" variant="ghost" aria-label="Close deletion review" onClick={() => setDeleteReview(null)}>
                                <X size={16} />
                            </AxiomButton>
                        </div>

                        <div className="space-y-4 p-6">
                            <p className="text-sm leading-relaxed text-text-muted">
                                Delete {deleteReview.processIds.length} selected {deleteReview.processIds.length === 1 ? 'process' : 'processes'}?
                            </p>
                            {(deleteReview.orphanAssets.length > 0 || deleteReview.orphanJournals.length > 0) && (
                                <div className="rounded-lg border border-accent-warning/25 bg-accent-warning/5 p-4">
                                    <p className="text-xs font-semibold text-text-main">Related content may become unused</p>
                                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                        {deleteReview.orphanAssets.length} resources and {deleteReview.orphanJournals.length} notes are only connected to these processes.
                                    </p>
                                </div>
                            )}
                            <p className="text-xs text-text-faint">This action cannot be undone.</p>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2 border-t border-app-border bg-app-header px-6 py-4">
                            <AxiomButton size="sm" variant="ghost" onClick={() => setDeleteReview(null)}>Cancel</AxiomButton>
                            {(deleteReview.orphanAssets.length > 0 || deleteReview.orphanJournals.length > 0) && (
                                <AxiomButton
                                    size="sm"
                                    onClick={() => {
                                        deleteProcess(deleteReview.processIds, false);
                                        setDeleteReview(null);
                                        setSelectedIds(new Set());
                                    }}
                                >
                                    Processes only
                                </AxiomButton>
                            )}
                            <AxiomButton
                                size="sm"
                                variant="danger"
                                onClick={() => {
                                    deleteProcess(deleteReview.processIds, true);
                                    setDeleteReview(null);
                                    setSelectedIds(new Set());
                                }}
                            >
                                {(deleteReview.orphanAssets.length > 0 || deleteReview.orphanJournals.length > 0)
                                    ? 'Delete with related content'
                                    : 'Delete processes'}
                            </AxiomButton>
                        </div>
                    </div>
                </div>,
                document.body,
            )}

            {confirmDialog && (
                <ConfirmationModal
                    isOpen
                    onClose={() => setConfirmDialog(null)}
                    onConfirm={confirmDialog.onConfirm}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    variant={confirmDialog.variant}
                />
            )}
        </PowerViewModal>
    );
}

function UnlinkedRow({ count, label, description, onClick }: {
    count: number;
    label: string;
    description: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={`Show ${label.toLocaleLowerCase()}`}
            className="group flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-app-hover"
        >
            <span className="min-w-8 text-center text-sm font-semibold text-text-muted">{count}</span>
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text-main">{label}</span>
                <span className="mt-0.5 block text-xs text-text-muted">{description}</span>
            </span>
            <ChevronRight size={15} className="text-text-faint group-hover:text-text-main" />
        </button>
    );
}
