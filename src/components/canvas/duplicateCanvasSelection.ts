import { useCanvasStore } from '../../stores/useCanvasStore';
import { useUIStore } from '../../stores/useUIStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { captureCanvasClipboard, cloneCanvasClipboard, type CanvasClipboard } from '../../lib/canvasClipboard';
import { toast } from 'sonner';

function capture(contextNodeId?: string): CanvasClipboard {
    const state = useCanvasStore.getState();
    const processId = useProcessSessionStore.getState().activeProcessId;
    const process = usePortfolioStore.getState().portfolio.processes.find(item => item.id === processId);
    const ids = contextNodeId && !state.selectedNodeIds.includes(contextNodeId) ? [contextNodeId] : state.selectedNodeIds;
    return captureCanvasClipboard(state.graph, ids, { ...process?.subGraphs, ...state.copiedSubGraphs });
}

function insert(clipboard: CanvasClipboard): void {
    if (!clipboard.nodes.length) return;
    const copied = cloneCanvasClipboard(clipboard, useCanvasStore.getState().graph);
    // One history entry; autosave projects graphs and drilldowns into the
    // Portfolio together, including when undoing or redoing this edit.
    useCanvasStore.setState(state => ({
        graph: { ...state.graph, nodes: [...state.graph.nodes, ...copied.nodes], edges: [...state.graph.edges, ...copied.edges] },
        copiedSubGraphs: Object.keys(copied.subGraphs).length
            ? { ...state.copiedSubGraphs, ...copied.subGraphs } : state.copiedSubGraphs,
        selectedNodeIds: copied.nodes.map(node => node.id),
        selectedEdgeIds: copied.edges.map(edge => edge.id),
    }));
    useUIStore.getState().inspectCanvasSelection();
}

export function copyCanvasSelection(): void {
    if (useCanvasStore.getState().previewGraph) return;
    try {
        const clipboard = capture();
        if (clipboard.nodes.length) useUIStore.getState().setClipboard(clipboard);
    } catch (error) {
        useUIStore.getState().setClipboard(null);
        toast.error(error instanceof Error ? error.message : 'Could not copy selection');
    }
}

export function pasteCanvasSelection(): void {
    if (useCanvasStore.getState().previewGraph) return;
    const clipboard = useUIStore.getState().clipboard;
    if (!clipboard) return;
    try { insert(clipboard); } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not paste selection');
    }
}

export function duplicateCanvasSelection(contextNodeId?: string): void {
    if (useCanvasStore.getState().previewGraph) return;
    try {
        const clipboard = capture(contextNodeId);
        if (!clipboard.nodes.length) return;
        insert(clipboard);
        toast.success(`Duplicated ${clipboard.nodes.length === 1 ? clipboard.nodes[0].label || 'node' : `${clipboard.nodes.length} nodes`}`);
    } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not duplicate selection');
    }
}
