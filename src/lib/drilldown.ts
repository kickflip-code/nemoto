import { useCanvasStore } from '../stores/useCanvasStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import type { CanvasGraph, CanvasNode, NodeType } from '../types';
import { createEmptyDrilldownGraph, resolveDrilldownNodeAtPath } from './drilldownGraph';

const DRILLDOWN_NODE_TYPES: NodeType[] = ['start', 'end', 'action', 'decision', 'system'];

export function canOpenNodeDrilldown(node: Pick<CanvasNode, 'type' | 'subGraphId'> | undefined): boolean {
    if (!node || node.type === 'resource') return false;
    return !!node.subGraphId || DRILLDOWN_NODE_TYPES.includes(node.type);
}

export function openOrCreateNodeDrilldown(nodeId: string, graph: CanvasGraph): {
    ok: boolean;
    created: boolean;
    draft?: boolean;
    reason?: string;
} {
    const canvasNode = graph.nodes.find(n => n.id === nodeId);
    if (!canvasNode) return { ok: false, created: false, reason: 'Node not found' };

    if (!canOpenNodeDrilldown(canvasNode)) {
        return { ok: false, created: false, reason: 'Node type does not support drilldown' };
    }

    const portfolioStore = usePortfolioStore.getState();
    const processId = useProcessSessionStore.getState().activeProcessId;
    if (!processId) return { ok: false, created: false, reason: 'No active process' };

    const process = portfolioStore.portfolio.processes.find(p => p.id === processId);
    if (!process) return { ok: false, created: false, reason: 'Active process not found' };

    const breadcrumbStack = useProcessSessionStore.getState().breadcrumbStack;
    const location = resolveDrilldownNodeAtPath(process, [...breadcrumbStack, nodeId]);
    const persistedNode = location?.node || canvasNode;
    const targetSubGraphId = persistedNode.subGraphId;
    const childGraph = targetSubGraphId && process.subGraphs?.[targetSubGraphId];

    if (
        targetSubGraphId
        && (
            location?.ancestorSubGraphIds.includes(targetSubGraphId)
            || childGraph === graph
        )
    ) {
        return {
            ok: false,
            created: false,
            reason: 'This drilldown link is cyclic and cannot be opened.',
        };
    }

    useProcessSessionStore.getState().pushBreadcrumb(canvasNode.id);
    if (childGraph) {
        useCanvasStore.getState().loadGraph(childGraph);
        return { ok: true, created: false, draft: false };
    }

    // New drilldowns are drafts until their first structural edit. Merely
    // opening and leaving an empty child canvas must not change the portfolio.
    useCanvasStore.getState().loadGraph(createEmptyDrilldownGraph());
    return { ok: true, created: false, draft: true };
}
