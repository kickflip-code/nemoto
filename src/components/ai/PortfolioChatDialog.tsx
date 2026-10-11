import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import {
    Bot,
    Check,
    CheckCircle2,
    ChevronUp,
    CircleAlert,
    Eraser,
    ExternalLink,
    GripVertical,
    History,
    Loader2,
    LockKeyhole,
    MessagesSquare,
    Pencil,
    Pin,
    Plus,
    RefreshCw,
    Send,
    Settings,
    Trash2,
    X,
} from 'lucide-react';
import {
    DeterministicPortfolioChatAdapter,
    PortfolioChatBroker,
} from '../../ai/portfolioChatBroker';
import type { PortfolioChatSelection } from '../../ai/portfolioChatContext';
import {
    PORTFOLIO_CHAT_MAIN_PORTFOLIO_KEY,
    type PortfolioChatConversation,
    type PortfolioChatConversationContext,
    type PortfolioChatStoredMessage,
} from '../../ai/portfolioChatHistory';
import { findNodeLocationInProcess, getGraphAtPath } from '../../lib/entityResolver';
import { loadCanvasGraphFromPortfolio } from '../../hooks/useCanvasSync';
import { AiBrokerError, type AiAdapterConversationTurn } from '../../plugins/aiBroker';
import { prefersReducedMotion } from '../../lib/motion';
import { LocalAiAdapterError, OpenAiCompatibleLocalAdapter } from '../../plugins/localAiAdapter';
import { createPortfolioRevision } from '../../plugins/proposalReview';
import type { UniversalEntityReference } from '../../plugins/universalReference';
import type { Portfolio, Process } from '../../types';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useJournalStore } from '../../stores/useJournalStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { usePortfolioChatStore } from '../../stores/usePortfolioChatStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useUIStore } from '../../stores/useUIStore';
import { AxiomButton, AxiomInput, AxiomSelect, AxiomTextarea } from '../ui';

const broker = new PortfolioChatBroker();
const MINIMUM_PANEL_WIDTH = 360;
const DEFAULT_PANEL_WIDTH = 500;
const MAXIMUM_PANEL_WIDTH = 760;

interface PortfolioChatPanelProps {
    onClose: () => void;
}

interface SelectionInfo {
    selection: PortfolioChatSelection;
    label: string;
    detail: string;
}

type PortfolioChatScope = PortfolioChatConversationContext['scope'];

interface SourceReferenceState {
    exists: boolean;
    navigable: boolean;
}

const EMPTY_CONVERSATIONS: PortfolioChatConversation[] = [];

const isPocAdapterRequested = (): boolean => (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('ai') === 'poc'
);

const messageId = (): string => (
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const messageTimestamp = (): string => new Date().toISOString();

const friendlyError = (error: unknown): string => {
    if (error instanceof AiBrokerError || error instanceof LocalAiAdapterError) return error.message;
    return error instanceof Error ? error.message : 'The local AI request failed.';
};

const sameSelection = (
    left: PortfolioChatSelection | undefined,
    right: PortfolioChatSelection | undefined,
): boolean => left?.kind === right?.kind && left?.id === right?.id;

const sameGraphPath = (left: readonly string[], right: readonly string[]): boolean => (
    left.length === right.length && left.every((id, index) => id === right[index])
);

const getSelectionInfo = (
    process: Process | null,
    selectedNodeIds: readonly string[],
    selectedAssetId: string | null,
    assets: readonly { id: string; name: string }[],
): SelectionInfo | null => {
    const selectedNode = process && selectedNodeIds.length === 1
        ? findNodeLocationInProcess(selectedNodeIds[0], process)
        : null;
    if (selectedNode) return {
        selection: { kind: 'node', id: selectedNode.node.id },
        label: selectedNode.node.label || 'Untitled node',
        detail: 'Selected process step',
    };

    const selectedAsset = selectedAssetId
        ? assets.find(asset => asset.id === selectedAssetId) || null
        : null;
    return selectedAsset ? {
        selection: { kind: 'asset', id: selectedAsset.id },
        label: selectedAsset.name,
        detail: 'Selected resource',
    } : null;
};

const storedSelectionInfo = (
    context: PortfolioChatConversationContext | undefined,
): SelectionInfo | null => context?.selection ? {
    selection: {
        kind: context.selection.kind,
        id: context.selection.id,
    },
    label: context.selection.label,
    detail: context.selection.detail,
} : null;

const getSourceReferenceState = (
    portfolio: Portfolio,
    reference: UniversalEntityReference,
): SourceReferenceState => {
    if (reference.kind === 'core.process') {
        const exists = portfolio.processes.some(process => process.id === reference.id);
        return { exists, navigable: exists };
    }
    if (reference.kind === 'core.process-folder') {
        return {
            exists: portfolio.processFolders.some(folder => folder.id === reference.id),
            navigable: false,
        };
    }
    if (reference.kind === 'core.asset') {
        const exists = portfolio.assets.some(asset => asset.id === reference.id);
        return { exists, navigable: exists };
    }
    if (reference.kind === 'core.asset-category') {
        return {
            exists: portfolio.assetCategories.some(category => category.id === reference.id),
            navigable: false,
        };
    }
    if (reference.kind === 'core.journal-entry') {
        const exists = portfolio.journal.entries.some(entry => entry.id === reference.id);
        return { exists, navigable: exists };
    }
    if (reference.kind === 'core.journal-notebook') {
        return {
            exists: portfolio.journal.notebooks.some(notebook => notebook.id === reference.id),
            navigable: false,
        };
    }
    if (reference.kind === 'core.journal-folder') {
        return {
            exists: portfolio.journal.folders.some(folder => folder.id === reference.id),
            navigable: false,
        };
    }
    if (reference.kind === 'core.tag') {
        return {
            exists: portfolio.journal.tags.some(tag => tag.id === reference.id),
            navigable: false,
        };
    }
    if (reference.kind === 'core.incident') {
        return {
            exists: portfolio.incidents.some(incident => incident.id === reference.id),
            navigable: false,
        };
    }
    if (reference.kind === 'core.finding') {
        return {
            exists: portfolio.incidents.some(incident => (
                incident.id === reference.location?.incidentId
                && incident.findings.some(finding => finding.id === reference.id)
            )),
            navigable: false,
        };
    }
    if (reference.kind === 'core.node' || reference.kind === 'core.edge' || reference.kind === 'core.swimlane') {
        const process = portfolio.processes.find(candidate => candidate.id === reference.location?.processId);
        if (!process) return { exists: false, navigable: false };
        const graph = getGraphAtPath(process, reference.location?.graphPath || []) || process.graph;
        const exists = reference.kind === 'core.node'
            ? graph.nodes.some(node => node.id === reference.id)
            : reference.kind === 'core.edge'
                ? graph.edges.some(edge => edge.id === reference.id)
                : graph.swimlanes.some(swimlane => swimlane.id === reference.id);
        return { exists, navigable: exists };
    }

    const semanticData = portfolio.plugins?.semanticData;
    const exists = !!semanticData && [
        ...semanticData.records,
        ...semanticData.relations,
        ...semanticData.annotations,
    ].some(entity => entity.id === reference.id && entity.type === reference.kind);
    return { exists, navigable: false };
};

const conversationTime = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

export default function PortfolioChatPanel({ onClose }: PortfolioChatPanelProps) {
    const portfolioKey = PORTFOLIO_CHAT_MAIN_PORTFOLIO_KEY;
    const portfolio = usePortfolioStore(state => state.portfolio);
    const activeProcessId = useProcessSessionStore(state => state.activeProcessId);
    const selectedNodeIds = useCanvasStore(state => state.selectedNodeIds);
    const selectedAssetId = useUIStore(state => state.selectedAssetId);
    const openSettings = useUIStore(state => state.openSettings);
    const panelWidth = useUIStore(state => state.portfolioChatWidth);
    const setPanelWidth = useUIStore(state => state.setPortfolioChatWidth);
    const { localAiEndpoint, localAiModel } = useSettingsStore();
    const conversations = usePortfolioChatStore(state => (
        state.conversationsByPortfolio[portfolioKey] || EMPTY_CONVERSATIONS
    ));
    const activeConversationId = usePortfolioChatStore(state => (
        state.activeConversationByPortfolio[portfolioKey]
    ));
    const ensureConversation = usePortfolioChatStore(state => state.ensureConversation);
    const createConversation = usePortfolioChatStore(state => state.createConversation);
    const setActiveConversation = usePortfolioChatStore(state => state.setActiveConversation);
    const appendMessage = usePortfolioChatStore(state => state.appendMessage);
    const renameConversation = usePortfolioChatStore(state => state.renameConversation);
    const clearStoredConversation = usePortfolioChatStore(state => state.clearConversation);
    const deleteConversation = usePortfolioChatStore(state => state.deleteConversation);
    const clearPortfolioHistory = usePortfolioChatStore(state => state.clearPortfolioHistory);
    const activeConversation = useMemo(() => conversations.find(
        conversation => conversation.id === activeConversationId,
    ) || null, [activeConversationId, conversations]);
    const liveProcess = portfolio.processes.find(process => process.id === activeProcessId) || null;
    const liveSelection = useMemo(() => getSelectionInfo(
        liveProcess,
        selectedNodeIds,
        selectedAssetId,
        portfolio.assets,
    ), [liveProcess, portfolio.assets, selectedAssetId, selectedNodeIds]);

    const [contextPortfolio, setContextPortfolio] = useState(() => structuredClone(portfolio));
    const [prompt, setPrompt] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const [deleteArmedConversationId, setDeleteArmedConversationId] = useState<string | null>(null);
    const [clearAllArmed, setClearAllArmed] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const loadedConversationIdRef = useRef<string | null>(null);
    const pocAdapter = isPocAdapterRequested();
    const configured = pocAdapter || (!!localAiEndpoint.trim() && !!localAiModel.trim());
    const conversationContext = activeConversation?.context;
    const contextProcessId = conversationContext ? conversationContext.processId : activeProcessId;
    const contextSelection = storedSelectionInfo(conversationContext);
    const scope: PortfolioChatScope = conversationContext?.scope
        || (liveSelection ? 'selection' : liveProcess ? 'process' : 'portfolio');
    const messages = activeConversation?.messages || [];
    const contextProcess = contextPortfolio.processes.find(process => process.id === contextProcessId) || null;
    const liveRevision = useMemo(() => createPortfolioRevision(portfolio), [portfolio]);
    const contextRevision = useMemo(() => createPortfolioRevision(contextPortfolio), [contextPortfolio]);
    const evidenceChanged = scope !== 'portfolio' && !!conversationContext && (
        liveRevision !== conversationContext.baseRevision
        || contextRevision !== conversationContext.baseRevision
    );
    const canvasContextChanged = scope !== 'portfolio' && (
        activeProcessId !== contextProcessId
        || (scope === 'selection' && !sameSelection(
            liveSelection?.selection,
            contextSelection?.selection,
        ))
    );
    const contextIsOutdated = evidenceChanged || canvasContextChanged;
    const canContinueConversation = (scope === 'portfolio' || !!contextProcess) && !evidenceChanged;

    const createLiveConversationContext = useCallback((
        requestedScope: PortfolioChatScope = liveSelection ? 'selection' : liveProcess ? 'process' : 'portfolio',
    ): PortfolioChatConversationContext | null => {
        if (requestedScope !== 'portfolio' && !liveProcess) return null;
        const nextScope: PortfolioChatScope = requestedScope === 'selection'
            ? liveSelection ? 'selection' : liveProcess ? 'process' : 'portfolio'
            : requestedScope;
        const selection = nextScope === 'selection' || nextScope === 'portfolio'
            ? liveSelection
            : null;
        return {
            processId: liveProcess?.id || null,
            scope: nextScope,
            label: nextScope === 'portfolio'
                ? 'Entire portfolio'
                : nextScope === 'selection'
                    ? liveSelection!.label
                    : liveProcess!.title,
            detail: nextScope === 'portfolio'
                ? 'Retrieved for each question'
                : nextScope === 'selection'
                    ? liveSelection!.detail
                    : 'Pinned process',
            baseRevision: liveRevision,
            selection: selection ? {
                ...selection.selection,
                label: selection.label,
                detail: selection.detail,
            } : null,
        };
    }, [liveProcess, liveRevision, liveSelection]);

    useEffect(() => () => abortRef.current?.abort(), []);

    useEffect(() => {
        const context = createLiveConversationContext();
        if (context) ensureConversation(portfolioKey, context);
    }, [activeConversationId, createLiveConversationContext, ensureConversation, portfolioKey]);

    useEffect(() => {
        if (!activeConversation || loadedConversationIdRef.current === activeConversation.id) return;
        loadedConversationIdRef.current = activeConversation.id;
        setContextPortfolio(structuredClone(portfolio));
        setPrompt('');
        setError(null);
        setDeleteArmedConversationId(null);
    }, [activeConversation, portfolio]);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView?.({
            behavior: prefersReducedMotion() ? 'auto' : 'smooth',
            block: 'end',
        });
    }, [messages, running, error]);

    const close = () => {
        abortRef.current?.abort();
        onClose();
    };

    const clearConversation = () => {
        if (running || !activeConversation) return;
        clearStoredConversation(portfolioKey, activeConversation.id);
        setError(null);
        setPrompt('');
        promptRef.current?.focus();
    };

    const changeScope = (nextScope: PortfolioChatScope) => {
        if (nextScope === scope || running) return;
        const context = createLiveConversationContext(nextScope);
        if (!context) return;
        createConversation(portfolioKey, context);
    };

    const adoptLiveContext = () => {
        if (running) return;
        const context = createLiveConversationContext(scope);
        if (!context) return;
        createConversation(portfolioKey, context);
        promptRef.current?.focus();
    };

    const startNewConversation = () => {
        if (running) return;
        const context = createLiveConversationContext(scope);
        if (!context) return;
        createConversation(portfolioKey, context);
        setHistoryOpen(false);
        promptRef.current?.focus();
    };

    const selectStoredConversation = (conversationIdToSelect: string) => {
        if (running || conversationIdToSelect === activeConversation?.id) return;
        setActiveConversation(portfolioKey, conversationIdToSelect);
        setHistoryOpen(false);
    };

    const beginRename = (conversation: PortfolioChatConversation) => {
        if (running) return;
        setRenamingConversationId(conversation.id);
        setRenameDraft(conversation.title);
        setDeleteArmedConversationId(null);
    };

    const commitRename = () => {
        if (!renamingConversationId) return;
        renameConversation(portfolioKey, renamingConversationId, renameDraft);
        setRenamingConversationId(null);
        setRenameDraft('');
    };

    const run = async () => {
        const question = prompt.trim();
        if (!question
            || (scope !== 'portfolio' && !contextProcess)
            || !activeConversation
            || running
            || !configured
            || evidenceChanged) return;

        const priorMessages = messages;
        const conversationIdAtRun = activeConversation.id;
        const userMessage: PortfolioChatStoredMessage = {
            id: messageId(),
            role: 'user',
            content: question,
            createdAt: messageTimestamp(),
        };
        appendMessage(portfolioKey, conversationIdAtRun, userMessage);
        setPrompt('');
        setRunning(true);
        setError(null);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const portfolioForRun = scope === 'portfolio'
                ? structuredClone(portfolio)
                : contextPortfolio;
            const adapter = pocAdapter
                ? new DeterministicPortfolioChatAdapter()
                : new OpenAiCompatibleLocalAdapter({
                    endpoint: localAiEndpoint,
                    modelId: localAiModel,
                });
            const history: AiAdapterConversationTurn[] = priorMessages.map(message => ({
                role: message.role,
                content: message.content,
            }));
            const result = await broker.run({
                portfolio: portfolioForRun,
                scope,
                processId: scope === 'portfolio'
                    ? activeProcessId
                    : conversationContext?.processId || null,
                selection: scope === 'portfolio'
                    ? liveSelection?.selection
                    : scope === 'selection' ? contextSelection?.selection : null,
                prompt: question,
                history,
                adapter,
                signal: controller.signal,
            });
            const retrieval = result.context.retrieval;
            const primarySourceIds = new Set(retrieval?.primarySourceIds || []);
            appendMessage(portfolioKey, conversationIdAtRun, {
                id: result.runId,
                role: 'assistant',
                content: result.answer,
                createdAt: messageTimestamp(),
                modelId: result.modelId,
                citations: result.citations.map(citation => ({
                    sourceId: citation.sourceId,
                    label: citation.label,
                    reference: citation.reference,
                    ...(citation.note ? { note: citation.note } : {}),
                })),
                sharedSourceCount: result.context.sources.length,
                omittedSourceCount: result.context.limits.omittedSources,
                ...(retrieval ? {
                    retrieval: {
                        strategy: retrieval.strategy,
                        baseRevision: result.context.baseRevision,
                        indexedSourceCount: retrieval.indexedSourceCount,
                        matchedSourceCount: retrieval.matchedSourceCount,
                        returnedSourceCount: retrieval.returnedSourceCount,
                        fallbackUsed: retrieval.fallbackUsed,
                        sources: result.context.sources.map(source => ({
                            sourceId: source.sourceId,
                            label: source.label,
                            reference: source.reference,
                            reason: primarySourceIds.has(source.sourceId) ? 'match' as const : 'related' as const,
                        })),
                    },
                } : {}),
            });
        } catch (runError) {
            setError(friendlyError(runError));
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void run();
        }
    };

    const navigateToSource = (reference: UniversalEntityReference) => {
        const ui = useUIStore.getState();
        const canvas = useCanvasStore.getState();
        const processSession = useProcessSessionStore.getState();
        ui.setActiveView('designer');

        if (reference.kind === 'core.process') {
            const alreadyAtProcessRoot = processSession.activeProcessId === reference.id
                && processSession.breadcrumbStack.length === 0;
            if (!alreadyAtProcessRoot) {
                const process = portfolio.processes.find(candidate => candidate.id === reference.id);
                if (process) {
                    if (processSession.activeProcessId !== reference.id) {
                        processSession.setActiveProcess(reference.id);
                    } else {
                        processSession.resetBreadcrumb();
                    }
                    loadCanvasGraphFromPortfolio(process.graph);
                }
            }
            canvas.selectElements([], []);
            ui.selectAsset(null);
        } else if (reference.kind === 'core.asset') {
            canvas.selectElements([], []);
            ui.selectAsset(reference.id);
            ui.closeInspector();
        } else if (reference.kind === 'core.node' || reference.kind === 'core.edge' || reference.kind === 'core.swimlane') {
            const process = portfolio.processes.find(candidate => candidate.id === reference.location?.processId);
            const graphPath = reference.location?.graphPath || [];
            if (process) {
                const targetAlreadyVisible = processSession.activeProcessId === process.id
                    && sameGraphPath(processSession.breadcrumbStack, graphPath);
                if (!targetAlreadyVisible) {
                    if (processSession.activeProcessId !== process.id) {
                        processSession.setActiveProcess(process.id);
                    }
                    processSession.setBreadcrumbStack(graphPath);
                    loadCanvasGraphFromPortfolio(getGraphAtPath(process, graphPath) || process.graph);
                }
                ui.selectAsset(null);
                canvas.selectElements(
                    reference.kind === 'core.node' ? [reference.id] : [],
                    reference.kind === 'core.edge' ? [reference.id] : [],
                );
                ui.selectSwimlane(reference.kind === 'core.swimlane' ? reference.id : null);
                ui.closeInspector();
            }
        } else if (reference.kind === 'core.journal-entry') {
            useJournalStore.getState().selectEntry(reference.id);
            ui.expandJournalPanel();
        }
    };

    const openLocalAiSettings = () => {
        close();
        openSettings();
    };

    const maximumWidthForWindow = () => Math.max(
        MINIMUM_PANEL_WIDTH,
        Math.min(MAXIMUM_PANEL_WIDTH, window.innerWidth - 480),
    );

    const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        resizeRef.current = { startX: event.clientX, startWidth: panelWidth };
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const resize = resizeRef.current;
            if (!resize) return;
            const nextWidth = resize.startWidth + resize.startX - moveEvent.clientX;
            setPanelWidth(Math.max(
                MINIMUM_PANEL_WIDTH,
                Math.min(maximumWidthForWindow(), nextWidth),
            ));
        };
        const handlePointerUp = () => {
            resizeRef.current = null;
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp, { once: true });
    };

    const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        if (event.key === 'Home') setPanelWidth(MINIMUM_PANEL_WIDTH);
        else if (event.key === 'End') setPanelWidth(maximumWidthForWindow());
        else setPanelWidth(panelWidth + (event.key === 'ArrowLeft' ? 24 : -24));
    };

    const canUseSelectionScope = scope === 'selection' || !!liveSelection;
    const canUseProcessScope = scope === 'process' || !!liveProcess;
    const contextLabel = conversationContext?.label
        || (scope === 'portfolio' ? 'Entire portfolio' : null)
        || contextProcess?.title
        || 'Source no longer available';
    const contextDetail = conversationContext?.detail
        || (scope === 'portfolio'
            ? 'Retrieved for each question'
            : scope === 'selection' ? 'Pinned selection' : 'Pinned process');

    return (
        <aside
            aria-labelledby="portfolio-chat-title"
            className="axiom-portfolio-chat relative z-30 flex h-full shrink-0 flex-col overflow-hidden border-l border-app-border bg-app-header shadow-2xl"
            style={{ width: panelWidth }}
        >
            <div
                aria-label="Resize Portfolio Chat"
                aria-orientation="vertical"
                className="group absolute inset-y-0 -left-1 z-40 flex w-3 cursor-col-resize items-center justify-center outline-none"
                role="separator"
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                onDoubleClick={() => setPanelWidth(DEFAULT_PANEL_WIDTH)}
                onKeyDown={handleResizeKeyDown}
                onPointerDown={handleResizePointerDown}
            >
                <span className="axiom-portfolio-chat-resize-handle flex h-12 w-3 items-center justify-center rounded-full border border-app-border bg-app-header text-text-faint opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                    <GripVertical size={11} />
                </span>
            </div>

            <header className="axiom-portfolio-chat-header flex min-h-16 shrink-0 items-center justify-between border-b border-app-border px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="axiom-portfolio-chat-mark flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-primary">
                        <MessagesSquare size={18} />
                    </div>
                    <div className="min-w-0">
                        <h2 id="portfolio-chat-title" className="text-sm font-bold text-text-main">Portfolio Chat</h2>
                        <p className="truncate text-[10px] text-text-muted">Local AI · read-only · saved locally</p>
                    </div>
                </div>
                <div className="flex items-center gap-0.5">
                    <AxiomButton
                        aria-label="New conversation"
                        icon
                        variant="ghost"
                        disabled={running}
                        title="New conversation with the current Nemoto context"
                        onClick={startNewConversation}
                    >
                        <Plus size={17} />
                    </AxiomButton>
                    <AxiomButton
                        aria-label="Chat history"
                        aria-expanded={historyOpen}
                        icon
                        variant={historyOpen ? 'default' : 'ghost'}
                        title="Saved conversations"
                        onClick={() => {
                            setHistoryOpen(open => !open);
                            setClearAllArmed(false);
                            setDeleteArmedConversationId(null);
                        }}
                    >
                        {historyOpen ? <ChevronUp size={17} /> : <History size={17} />}
                    </AxiomButton>
                    <AxiomButton aria-label="Close Portfolio Chat" icon variant="ghost" onClick={close}>
                        <X size={17} />
                    </AxiomButton>
                </div>
            </header>

            {historyOpen && (
                <section aria-label="Saved conversations" className="max-h-72 shrink-0 overflow-y-auto border-b border-app-border bg-app-bg/90 px-3 py-3 app-scroll">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                        <div>
                            <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Saved on this device</div>
                            <div className="mt-0.5 text-[9px] text-text-muted">{conversations.length} conversation{conversations.length === 1 ? '' : 's'} for this portfolio</div>
                        </div>
                        {conversations.length > 0 && (
                            <button
                                className={`shrink-0 rounded px-2 py-1 text-[9px] font-semibold transition-colors ${clearAllArmed
                                    ? 'bg-accent-danger text-white'
                                    : 'text-text-faint hover:bg-accent-danger/10 hover:text-accent-danger'}`}
                                type="button"
                                disabled={running}
                                onClick={() => {
                                    if (clearAllArmed) {
                                        clearPortfolioHistory(portfolioKey);
                                        setClearAllArmed(false);
                                        setHistoryOpen(false);
                                    } else {
                                        setClearAllArmed(true);
                                        setDeleteArmedConversationId(null);
                                    }
                                }}
                            >
                                {clearAllArmed ? 'Confirm clear all' : 'Clear all'}
                            </button>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        {conversations.map(conversation => {
                            const active = conversation.id === activeConversation?.id;
                            const renaming = renamingConversationId === conversation.id;
                            const deleteArmed = deleteArmedConversationId === conversation.id;
                            return (
                                <div
                                    key={conversation.id}
                                    data-active={active ? 'true' : undefined}
                                    className={`axiom-chat-history-item rounded-lg border p-2 transition-colors ${active
                                        ? 'border-accent-primary/35 bg-accent-primary/8'
                                        : 'border-app-border bg-app-surface/60'}`}
                                >
                                    {renaming ? (
                                        <div className="flex items-center gap-1.5">
                                            <AxiomInput
                                                aria-label="Conversation name"
                                                autoFocus
                                                className="min-w-0 flex-1"
                                                controlSize="sm"
                                                maxLength={120}
                                                value={renameDraft}
                                                onChange={event => setRenameDraft(event.target.value)}
                                                onKeyDown={event => {
                                                    if (event.key === 'Enter') commitRename();
                                                    if (event.key === 'Escape') setRenamingConversationId(null);
                                                }}
                                            />
                                            <AxiomButton aria-label="Save conversation name" icon size="sm" variant="ghost" onClick={commitRename}>
                                                <Check size={13} />
                                            </AxiomButton>
                                            <AxiomButton aria-label="Cancel rename" icon size="sm" variant="ghost" onClick={() => setRenamingConversationId(null)}>
                                                <X size={13} />
                                            </AxiomButton>
                                        </div>
                                    ) : (
                                        <div className="flex items-start gap-1.5">
                                            <button
                                                aria-current={active ? 'true' : undefined}
                                                className="min-w-0 flex-1 text-left"
                                                type="button"
                                                disabled={running}
                                                onClick={() => selectStoredConversation(conversation.id)}
                                            >
                                                <span className="block truncate text-[10px] font-semibold text-text-main">{conversation.title}</span>
                                                <span className="mt-0.5 block truncate text-[8px] text-text-faint">
                                                    {conversation.messages.length} messages · {conversationTime(conversation.updatedAt)}
                                                </span>
                                            </button>
                                            <AxiomButton
                                                aria-label={`Rename ${conversation.title}`}
                                                icon
                                                size="sm"
                                                variant="ghost"
                                                disabled={running}
                                                onClick={() => beginRename(conversation)}
                                            >
                                                <Pencil size={12} />
                                            </AxiomButton>
                                            <AxiomButton
                                                aria-label={deleteArmed ? `Confirm delete ${conversation.title}` : `Delete ${conversation.title}`}
                                                className={deleteArmed ? 'text-accent-danger' : ''}
                                                icon={!deleteArmed}
                                                size="sm"
                                                variant="ghost"
                                                disabled={running}
                                                onClick={() => {
                                                    if (deleteArmed) {
                                                        deleteConversation(portfolioKey, conversation.id);
                                                        setDeleteArmedConversationId(null);
                                                    } else {
                                                        setDeleteArmedConversationId(conversation.id);
                                                        setClearAllArmed(false);
                                                    }
                                                }}
                                            >
                                                <Trash2 size={12} /> {deleteArmed && 'Delete?'}
                                            </AxiomButton>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            <section className="axiom-portfolio-chat-context shrink-0 border-b border-app-border bg-app-sidebar/60 px-4 py-3">
                <div className="flex items-center gap-2">
                    <AxiomSelect
                        aria-label="Portfolio Chat scope"
                        className="min-w-0 flex-1"
                        controlSize="sm"
                        disabled={running}
                        value={scope}
                        onChange={event => changeScope(event.target.value as PortfolioChatScope)}
                    >
                        {canUseSelectionScope && <option value="selection">Pinned selection</option>}
                        {canUseProcessScope && <option value="process">Pinned process</option>}
                        <option value="portfolio">Entire portfolio</option>
                    </AxiomSelect>
                    <div className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-accent-success/20 bg-accent-success/5 px-2 text-[9px] font-semibold text-accent-success" title="Nemoto sends only bounded read-only context">
                        <LockKeyhole size={11} /> Read-only
                    </div>
                </div>

                <div className="axiom-portfolio-chat-context-card mt-2.5 flex items-start gap-2 rounded-lg border border-app-border bg-app-bg p-2.5">
                    <Pin size={13} className="axiom-portfolio-chat-pin mt-0.5 shrink-0 text-accent-primary" />
                    <div className="min-w-0 flex-1">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">{contextDetail}</div>
                        <div className="mt-0.5 truncate text-[11px] font-semibold text-text-main" title={contextLabel}>{contextLabel}</div>
                    </div>
                </div>

                {contextIsOutdated && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-accent-warning/25 bg-accent-warning/5 px-2.5 py-2">
                        <div className="min-w-0 text-[10px] leading-relaxed text-text-muted">
                            {evidenceChanged
                                ? 'The portfolio changed since this saved conversation used its sources. The transcript remains available.'
                                : 'The canvas context changed. This conversation remains pinned.'}
                        </div>
                        {liveProcess && (
                            <AxiomButton className="shrink-0" size="sm" disabled={running} onClick={adoptLiveContext}>
                                <RefreshCw size={12} /> New with current
                            </AxiomButton>
                        )}
                    </div>
                )}

                <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-text-faint">
                    <span className="truncate">
                        {pocAdapter
                            ? 'Development POC model'
                            : configured
                                ? localAiModel
                                : 'No local model attached'}
                    </span>
                    {!configured && (
                        <button className="flex shrink-0 items-center gap-1 text-accent-primary hover:underline" type="button" onClick={openLocalAiSettings}>
                            <Settings size={10} /> Configure
                        </button>
                    )}
                </div>
            </section>

            <section className="axiom-portfolio-chat-transcript min-h-0 flex-1 overflow-y-auto px-4 py-4 app-scroll" aria-live="polite">
                {messages.length === 0 && !running && !error && (
                    <div className="axiom-portfolio-chat-empty flex min-h-full flex-col items-center justify-center py-6 text-center">
                        <Bot size={28} className="text-accent-primary" />
                        <div className="mt-3 text-sm font-semibold text-text-main">Ask while you explore</div>
                        <div className="mt-1 max-w-xs text-[11px] leading-relaxed text-text-muted">
                            Keep the canvas visible, inspect sources, and return here for follow-up questions.
                        </div>
                        <div className="mt-4 grid w-full gap-2">
                            {[
                                'Summarize this process and its main handoffs.',
                                'Which decisions appear most important here?',
                                'What information looks incomplete or ambiguous?',
                            ].map(suggestion => (
                                <button
                                    key={suggestion}
                                    className="rounded-lg border border-app-border bg-app-bg p-2.5 text-left text-[10px] leading-relaxed text-text-muted transition-colors hover:border-accent-primary/40 hover:text-text-main"
                                    type="button"
                                    onClick={() => {
                                        setPrompt(suggestion);
                                        promptRef.current?.focus();
                                    }}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    {!!activeConversation?.trimmedMessageCount && (
                        <div className="rounded-lg border border-app-border bg-app-bg/60 px-3 py-2 text-center text-[9px] text-text-faint">
                            {activeConversation.trimmedMessageCount} older message{activeConversation.trimmedMessageCount === 1 ? '' : 's'} removed from local history.
                        </div>
                    )}
                    {messages.map(message => message.role === 'user' ? (
                        <div key={message.id} className="flex justify-end">
                            <div className="axiom-chat-message-user max-w-[88%] cursor-text select-text rounded-2xl rounded-br-sm bg-accent-primary px-3.5 py-2.5 text-xs leading-relaxed text-white shadow-sm">
                                {message.content}
                            </div>
                        </div>
                    ) : (
                        <div key={message.id} className="flex gap-2.5">
                            <div
                                className="axiom-chat-assistant-mark mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-primary"
                                title={`Generated by ${message.modelId}`}
                            >
                                <Bot size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="axiom-chat-message-assistant rounded-2xl rounded-tl-sm border border-app-border bg-app-bg p-3">
                                    <div className="cursor-text select-text whitespace-pre-wrap text-xs leading-relaxed text-text-main">{message.content}</div>
                                </div>
                                <div className="axiom-chat-sources mt-2 rounded-xl border border-app-border bg-app-bg/60 p-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Sources cited</div>
                                        <div className="text-[9px] text-text-faint">
                                            {message.retrieval
                                                ? `${message.retrieval.returnedSourceCount} retrieved from ${message.retrieval.indexedSourceCount}`
                                                : `${message.sharedSourceCount} shared`}
                                            {message.omittedSourceCount > 0
                                                ? ` · ${message.omittedSourceCount} omitted`
                                                : ''}
                                        </div>
                                    </div>
                                    <div className="mt-1.5 space-y-1">
                                        {message.citations.map(citation => {
                                            const sourceState = getSourceReferenceState(portfolio, citation.reference);
                                            return (
                                                <button
                                                    key={citation.sourceId}
                                                    className="axiom-chat-citation group flex w-full items-start gap-2 rounded-lg border border-transparent p-1.5 text-left transition-colors enabled:hover:border-app-border enabled:hover:bg-app-surface disabled:cursor-not-allowed disabled:opacity-60"
                                                    type="button"
                                                    disabled={!sourceState.navigable}
                                                    title={sourceState.navigable
                                                        ? 'Show this source in Nemoto'
                                                        : sourceState.exists
                                                            ? 'This source is available, but has no direct view yet'
                                                            : 'This saved source is no longer available'}
                                                    onClick={() => navigateToSource(citation.reference)}
                                                >
                                                    {sourceState.exists
                                                        ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-accent-success" />
                                                        : <CircleAlert size={12} className="mt-0.5 shrink-0 text-accent-warning" />}
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-[10px] font-semibold text-text-main">{citation.label}</span>
                                                        {citation.note && (
                                                            <span className="mt-0.5 block cursor-text select-text text-[9px] leading-relaxed text-text-muted">
                                                                <span className="mr-1 text-[7px] font-bold uppercase tracking-wider text-text-faint">Why cited</span>
                                                                {citation.note}
                                                            </span>
                                                        )}
                                                        {!sourceState.exists && <span className="mt-0.5 block text-[8px] text-accent-warning">Source changed or was removed</span>}
                                                        {sourceState.exists && !sourceState.navigable && <span className="mt-0.5 block text-[8px] text-text-faint">Available in the portfolio · no direct view yet</span>}
                                                    </span>
                                                    {sourceState.navigable && <ExternalLink size={11} className="mt-0.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {message.retrieval && (
                                        <details className="mt-2 border-t border-app-border pt-2">
                                            <summary className="axiom-chat-inspect cursor-pointer select-none text-[9px] font-semibold text-accent-primary">
                                                Inspect retrieved context
                                            </summary>
                                            <div className="mt-2 rounded-lg border border-app-border bg-app-surface/50 p-2">
                                                <div className="text-[9px] leading-relaxed text-text-muted">
                                                    Nemoto searched {message.retrieval.indexedSourceCount} indexed sources,
                                                    found {message.retrieval.matchedSourceCount} lexical matches, and shared
                                                    {' '}{message.retrieval.returnedSourceCount} bounded sources with the model.
                                                    {message.retrieval.fallbackUsed && ' No direct match was found, so a portfolio overview was used.'}
                                                </div>
                                                <div className="mt-2 max-h-44 space-y-1 overflow-y-auto app-scroll">
                                                    {message.retrieval.sources.map(source => {
                                                        const sourceState = getSourceReferenceState(portfolio, source.reference);
                                                        const content = (
                                                            <>
                                                                {sourceState.exists
                                                                    ? <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-accent-success" />
                                                                    : <CircleAlert size={11} className="mt-0.5 shrink-0 text-accent-warning" />}
                                                                <span className="min-w-0 flex-1 truncate text-[9px] font-medium text-text-main">{source.label}</span>
                                                                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide ${source.reason === 'match'
                                                                    ? 'bg-accent-primary/10 text-accent-primary'
                                                                    : 'bg-app-bg text-text-faint'}`}>
                                                                    {source.reason === 'match' ? 'Match' : 'Related'}
                                                                </span>
                                                                {sourceState.navigable && <ExternalLink size={9} className="shrink-0 text-text-faint" />}
                                                            </>
                                                        );
                                                        return sourceState.navigable ? (
                                                            <button
                                                                key={source.sourceId}
                                                                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-app-bg"
                                                                type="button"
                                                                title="Show this source in Nemoto"
                                                                onClick={() => navigateToSource(source.reference)}
                                                            >
                                                                {content}
                                                            </button>
                                                        ) : (
                                                            <div
                                                                key={source.sourceId}
                                                                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1"
                                                                title={sourceState.exists
                                                                    ? 'Available in the portfolio; no direct view yet'
                                                                    : 'This saved source is no longer available'}
                                                            >
                                                                {content}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </details>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}

                    {running && (
                        <div className="flex items-center gap-2.5 text-[10px] text-text-muted">
                            <div className="axiom-chat-thinking-mark flex h-7 w-7 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10">
                                <Loader2 size={14} className="animate-spin text-accent-primary" />
                            </div>
                            <div>
                                <div className="font-semibold text-text-main">Thinking locally…</div>
                                <div className="text-[9px] text-text-faint">Large models can take several minutes.</div>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 rounded-lg border border-accent-danger/20 bg-accent-danger/5 p-3 text-[10px] leading-relaxed text-accent-danger">
                            <CircleAlert size={14} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    <div ref={transcriptEndRef} />
                </div>
            </section>

            <section className="axiom-portfolio-chat-composer shrink-0 border-t border-app-border bg-app-bg/70 p-3">
                <AxiomTextarea
                    ref={promptRef}
                    aria-label="Message Portfolio Chat"
                    className="min-h-20 w-full resize-none"
                    controlSize="sm"
                    disabled={running || !canContinueConversation || !configured}
                    maxLength={4000}
                    placeholder={evidenceChanged
                        ? 'Start a new conversation with the current portfolio to continue…'
                        : scope === 'portfolio'
                            ? 'Ask across the entire portfolio…'
                            : contextProcess
                            ? 'Ask about the pinned Nemoto context…'
                            : 'Open a process to start chatting…'}
                    value={prompt}
                    onChange={event => setPrompt(event.target.value)}
                    onKeyDown={handlePromptKeyDown}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <AxiomButton
                            aria-label="Clear chat"
                            icon
                            size="sm"
                            variant="ghost"
                            disabled={running || messages.length === 0}
                            title="Clear the messages in this saved conversation"
                            onClick={clearConversation}
                        >
                            <Eraser size={14} />
                        </AxiomButton>
                        <span className="text-[9px] text-text-faint">{prompt.length}/4000 · Ctrl+Enter</span>
                    </div>
                    <AxiomButton
                        size="sm"
                        variant="primary"
                        disabled={!configured || !canContinueConversation || !prompt.trim() || running}
                        onClick={() => { void run(); }}
                    >
                        {running ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {running ? 'Thinking…' : 'Send'}
                    </AxiomButton>
                </div>
            </section>

            <footer className="axiom-portfolio-chat-footer flex min-h-9 shrink-0 items-center border-t border-app-border px-3 text-[9px] text-text-faint">
                <LockKeyhole size={10} className="mr-1.5 shrink-0 text-accent-success" />
                Nemoto owns this local archive · it is not stored in the portfolio.
            </footer>
        </aside>
    );
}
