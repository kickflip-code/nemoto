import { useLayoutEffect } from 'react';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { canvasLocationMatchesSession } from '../stores/canvasLocation';
import type { CanvasGraph } from '../types';
import { createEmptyDrilldownGraph, resolveDrilldownNodeAtPath } from '../lib/drilldownGraph';

export function loadCanvasGraphFromPortfolio(graph: CanvasGraph) {
    useCanvasStore.getState().loadGraph(graph);
}

export function useCanvasSync() {
    const activeProcessId = useProcessSessionStore(s => s.activeProcessId);
    const breadcrumbStack = useProcessSessionStore(s => s.breadcrumbStack);
    const portfolioGeneration = useProcessSessionStore(s => s.portfolioGeneration);

    useLayoutEffect(() => {
        const session = useProcessSessionStore.getState();
        const canvas = useCanvasStore.getState();
        // Explicit synchronous navigation has already loaded this exact target.
        // Preserve its selection/history instead of loading it a second time.
        if (canvasLocationMatchesSession(canvas.loadedLocation, session)) return;
        if (!session.activeProcessId) {
            if (canvas.loadedLocation) canvas.loadGraph(createEmptyDrilldownGraph(), null);
            return;
        }
        const process = usePortfolioStore.getState().portfolio.processes.find(p => p.id === session.activeProcessId);
        if (!process) {
            canvas.loadGraph(createEmptyDrilldownGraph(), null);
            return;
        }
        if (session.breadcrumbStack.length === 0) {
            loadCanvasGraphFromPortfolio(process.graph);
            return;
        }
        const location = resolveDrilldownNodeAtPath(process, session.breadcrumbStack);
        const childId = location?.node.subGraphId;
        if (!location || (childId && (location.ancestorSubGraphIds.includes(childId) || !process.subGraphs?.[childId]))) {
            // An invalid path must never fall back to a parent graph under the
            // requested child's identity. Leave the empty canvas unbound.
            canvas.loadGraph(createEmptyDrilldownGraph(), null);
            return;
        }
        loadCanvasGraphFromPortfolio(childId ? process.subGraphs![childId] : createEmptyDrilldownGraph());
    }, [activeProcessId, breadcrumbStack, portfolioGeneration]);
}
