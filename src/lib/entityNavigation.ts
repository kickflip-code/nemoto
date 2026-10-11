import type { EntityReference } from '../types/journal';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useJournalStore } from '../stores/useJournalStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { useUIStore } from '../stores/useUIStore';
import { loadCanvasGraphFromPortfolio } from '../hooks/useCanvasSync';
import {
    findNodeLocationInPortfolio,
    getGraphAtPath,
    normalizeEntityReference,
    resolveEntityReference,
} from './entityResolver';
import {
    findGraphEntityLocation,
    graphLocationHint,
} from '../plugins/graphLocations';
import {
    coreEntityReference,
    parseUniversalEntityReference,
    type UniversalEntityReference,
} from '../plugins/universalReference';
import type { PluginNavigationAction } from '../plugins/workspaceContracts';

export type EntityNavigationIntent = 'navigate' | 'inspect';

export interface EntityNavigationResult {
    ok: boolean;
    reason?: string;
}

function prepareDesignerView(openInspector: boolean) {
    const ui = useUIStore.getState();
    ui.setActiveView('designer');
    ui.selectAsset(null);
    ui.selectSwimlane(null);
    if (openInspector) ui.setRightPanelMode('inspector');
}

export function navigateToEntityReference(
    input: EntityReference,
    intent: EntityNavigationIntent,
): EntityNavigationResult {
    const portfolioStore = usePortfolioStore.getState();
    const processSession = useProcessSessionStore.getState();
    const portfolio = portfolioStore.portfolio;
    const reference = normalizeEntityReference(input, portfolio);
    const resolved = resolveEntityReference(reference, portfolio);

    if (!resolved) {
        return { ok: false, reason: `The referenced ${reference.type} no longer exists.` };
    }

    if (reference.type === 'asset') {
        prepareDesignerView(true);
        useUIStore.getState().selectAsset(reference.id);
        return { ok: true };
    }

    if (reference.type === 'process') {
        const process = portfolio.processes.find(candidate => candidate.id === reference.id);
        if (!process) return { ok: false, reason: 'The referenced process no longer exists.' };

        processSession.setActiveProcess(process.id);
        loadCanvasGraphFromPortfolio(process.graph);
        prepareDesignerView(intent === 'inspect');
        return { ok: true };
    }

    if (reference.type === 'node') {
        const location = findNodeLocationInPortfolio(reference.id, portfolio, reference.processId);
        if (!location) return { ok: false, reason: 'The referenced node no longer exists.' };

        const childGraph = location.node.subGraphId
            ? location.process.subGraphs?.[location.node.subGraphId]
            : undefined;
        const targetPath = intent === 'navigate' && childGraph
            ? location.path
            : location.path.slice(0, -1);
        const targetGraph = getGraphAtPath(location.process, targetPath);
        if (!targetGraph) return { ok: false, reason: 'The referenced node path is no longer valid.' };

        processSession.setActiveProcess(location.processId);
        processSession.setBreadcrumbStack(targetPath);
        loadCanvasGraphFromPortfolio(targetGraph);
        prepareDesignerView(intent === 'inspect');

        if (intent === 'inspect' || !childGraph) {
            useCanvasStore.getState().selectNodes([reference.id]);
        }

        return { ok: true };
    }

    if (reference.type === 'journalEntry') {
        const entry = portfolio.journal?.entries.find(candidate => candidate.id === reference.id);
        if (!entry) return { ok: false, reason: 'The referenced journal entry no longer exists.' };

        const journalStore = useJournalStore.getState();
        journalStore.selectNotebook(entry.notebookId);
        journalStore.selectEntry(entry.id);
        useUIStore.getState().expandJournalPanel();
        return { ok: true };
    }

    return { ok: false, reason: `Navigation is not available for ${reference.type} references.` };
}

export interface UniversalEntityNavigationResult {
    readonly ok: boolean;
    readonly reference: UniversalEntityReference;
}

/**
 * Applies a pre-authorized public navigation intent. The reference is resolved
 * again against current Core state and only a fixed set of UI destinations is
 * supported. No caller-controlled view ID or store mutation callback is used.
 */
export function navigateToUniversalEntityReference(
    input: UniversalEntityReference,
    action: PluginNavigationAction,
): UniversalEntityNavigationResult {
    const reference = parseUniversalEntityReference(input);
    const portfolio = usePortfolioStore.getState().portfolio;
    const processSession = useProcessSessionStore.getState();
    const canvas = useCanvasStore.getState();
    const ui = useUIStore.getState();

    if (reference.kind === 'core.process') {
        const process = portfolio.processes.find(candidate => candidate.id === reference.id);
        if (!process) return { ok: false, reference };
        processSession.setActiveProcess(process.id);
        loadCanvasGraphFromPortfolio(process.graph);
        canvas.selectElements([], []);
        prepareDesignerView(action === 'inspect');
        return { ok: true, reference: coreEntityReference('core.process', process.id) };
    }

    if (reference.kind === 'core.asset') {
        const asset = portfolio.assets.find(candidate => candidate.id === reference.id);
        if (!asset) return { ok: false, reference };
        canvas.selectElements([], []);
        prepareDesignerView(false);
        ui.selectAsset(asset.id);
        if (action === 'reveal') ui.closeInspector();
        else ui.setRightPanelMode('inspector');
        return { ok: true, reference: coreEntityReference('core.asset', asset.id) };
    }

    if (
        reference.kind === 'core.node'
        || reference.kind === 'core.edge'
        || reference.kind === 'core.swimlane'
    ) {
        const located = findGraphEntityLocation(
            portfolio,
            reference.kind,
            reference.id,
            reference.location?.processId,
        );
        if (!located || !located.graphPath) return { ok: false, reference };
        processSession.setActiveProcess(located.process.id);
        processSession.setBreadcrumbStack([...located.graphPath]);
        loadCanvasGraphFromPortfolio(located.graph);
        prepareDesignerView(false);
        canvas.selectElements(
            reference.kind === 'core.node' ? [reference.id] : [],
            reference.kind === 'core.edge' ? [reference.id] : [],
        );
        ui.selectSwimlane(reference.kind === 'core.swimlane' ? reference.id : null);
        if (action === 'inspect') ui.setRightPanelMode('inspector');
        else ui.closeInspector();
        return {
            ok: true,
            reference: coreEntityReference(reference.kind, reference.id, graphLocationHint(located)),
        };
    }

    if (reference.kind === 'core.journal-entry') {
        const entry = portfolio.journal.entries.find(candidate => candidate.id === reference.id);
        if (!entry) return { ok: false, reference };
        const journal = useJournalStore.getState();
        journal.selectNotebook(entry.notebookId);
        journal.selectEntry(entry.id);
        ui.expandJournalPanel();
        return { ok: true, reference: coreEntityReference('core.journal-entry', entry.id) };
    }

    return { ok: false, reference };
}
