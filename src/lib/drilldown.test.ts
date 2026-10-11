import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../stores/useCanvasStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import type { CanvasGraph, CanvasNode, Process } from '../types';
import { canOpenNodeDrilldown, openOrCreateNodeDrilldown } from './drilldown';

const graph = (nodes: CanvasNode[]): CanvasGraph => ({
    nodes,
    edges: [],
    swimlanes: [],
    mode: 'blank',
});

const actionNode = (id: string, subGraphId?: string): CanvasNode => ({
    id,
    type: 'action',
    label: id,
    position: { x: 0, y: 0 },
    ...(subGraphId ? { subGraphId } : {}),
});

const processWith = (
    root: CanvasGraph,
    subGraphs: Record<string, CanvasGraph> = {},
): Process => ({
    id: 'process-1',
    title: 'Process',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    mode: 'blank',
    graph: root,
    subGraphs,
});

const loadProcess = (process: Process, breadcrumbStack: string[] = []) => {
    const portfolio = structuredClone(emptyPortfolio);
    portfolio.processes = [process];
    usePortfolioStore.setState({ portfolio, isDirty: false, changeRevision: 0 });
    useProcessSessionStore.setState({
        activeProcessId: process.id,
        breadcrumbStack,
    });
};

beforeEach(() => {
    useCanvasStore.temporal.getState().resume();
    useCanvasStore.temporal.getState().clear();
    useCanvasStore.getState().loadGraph(graph([]));
    useProcessSessionStore.setState({ activeProcessId: null, breadcrumbStack: [] });
});

describe('drilldown - canOpenNodeDrilldown', () => {
    it('returns false for resource reference nodes', () => {
        const resourceNode: CanvasNode = {
            id: 'res-node-1',
            type: 'resource',
            label: null,
            position: { x: 0, y: 0 },
            data: { assetId: 'asset-1' },
            assetIds: ['asset-1'],
        };

        expect(canOpenNodeDrilldown(resourceNode)).toBe(false);
    });

    it('returns false for synthetic swimlane nodes', () => {
        const headerNode: CanvasNode = {
            id: 'process-header',
            type: 'swimlane',
            label: 'Header',
            position: { x: 0, y: 0 },
        };

        expect(canOpenNodeDrilldown(headerNode)).toBe(false);
    });

    it('returns true for action nodes', () => {
        const actionNode: CanvasNode = {
            id: 'action-1',
            type: 'action',
            label: 'Do Work',
            position: { x: 0, y: 0 },
        };

        expect(canOpenNodeDrilldown(actionNode)).toBe(true);
    });
});

describe('drilldown navigation', () => {
    it('opens a new drilldown as an unpersisted empty draft', () => {
        const process = processWith(graph([actionNode('node-a')]));
        loadProcess(process);
        useCanvasStore.getState().loadGraph(process.graph);
        const portfolioBefore = usePortfolioStore.getState().portfolio;

        const result = openOrCreateNodeDrilldown('node-a', useCanvasStore.getState().graph);

        expect(result).toEqual({ ok: true, created: false, draft: true });
        expect(usePortfolioStore.getState().portfolio).toBe(portfolioBefore);
        expect(usePortfolioStore.getState().portfolio.processes[0].graph.nodes[0].subGraphId).toBeUndefined();
        expect(useProcessSessionStore.getState().breadcrumbStack).toEqual(['node-a']);
        expect(useCanvasStore.getState().graph).toMatchObject({
            nodes: [],
            edges: [],
            swimlanes: [],
            mode: 'swimlane',
        });
    });

    it('loads an existing drilldown without changing the portfolio', () => {
        const childGraph = graph([actionNode('child-node')]);
        const process = processWith(
            graph([actionNode('node-a', 'sg-a')]),
            { 'sg-a': childGraph },
        );
        loadProcess(process);
        useCanvasStore.getState().loadGraph(process.graph);
        const portfolioBefore = usePortfolioStore.getState().portfolio;

        const result = openOrCreateNodeDrilldown('node-a', useCanvasStore.getState().graph);

        expect(result).toEqual({ ok: true, created: false, draft: false });
        expect(usePortfolioStore.getState().portfolio).toBe(portfolioBefore);
        expect(useProcessSessionStore.getState().breadcrumbStack).toEqual(['node-a']);
        expect(useCanvasStore.getState().graph.nodes.map(node => node.id)).toEqual(['child-node']);
    });

    it('refuses to enter a drilldown that points back to an ancestor graph', () => {
        const childGraph = graph([actionNode('node-b', 'sg-a')]);
        const process = processWith(
            graph([actionNode('node-a', 'sg-a')]),
            { 'sg-a': childGraph },
        );
        loadProcess(process, ['node-a']);
        useCanvasStore.getState().loadGraph(childGraph);
        const canvasBefore = useCanvasStore.getState().graph;

        const result = openOrCreateNodeDrilldown('node-b', canvasBefore);

        expect(result).toMatchObject({ ok: false, created: false });
        expect(result.reason).toContain('cyclic');
        expect(useProcessSessionStore.getState().breadcrumbStack).toEqual(['node-a']);
        expect(useCanvasStore.getState().graph).toBe(canvasBefore);
    });
});
