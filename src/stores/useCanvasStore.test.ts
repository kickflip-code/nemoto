import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from './useCanvasStore';

describe('canvas session state', () => {
    beforeEach(() => {
        useCanvasStore.setState({
            graph: {
                nodes: [{ id: 'node-1', type: 'action', label: 'A', position: { x: 0, y: 0 } }],
                edges: [{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-1', style: 'solid' }],
                swimlanes: [],
            },
            viewport: { x: 0, y: 0, zoom: 1 },
            selectedNodeIds: [],
            selectedEdgeIds: [],
        });
        useCanvasStore.temporal.getState().clear();
    });

    it('keeps selection outside the durable graph object', () => {
        const graphBeforeSelection = useCanvasStore.getState().graph;

        useCanvasStore.getState().selectNodes(['node-1']);
        useCanvasStore.getState().selectEdges(['edge-1']);

        const state = useCanvasStore.getState();
        expect(state.graph).toBe(graphBeforeSelection);
        expect(state.selectedNodeIds).toEqual(['node-1']);
        expect(state.selectedEdgeIds).toEqual(['edge-1']);
        expect(state.graph.nodes[0].selected).toBeUndefined();
        expect(state.graph.edges[0].selected).toBeUndefined();
    });

    it('strips legacy serialized selection when a graph is hydrated', () => {
        useCanvasStore.getState().loadGraph({
            nodes: [{ id: 'node-1', type: 'action', label: 'A', position: { x: 0, y: 0 }, selected: true }],
            edges: [{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-1', style: 'solid', selected: true }],
            swimlanes: [],
        });

        const state = useCanvasStore.getState();
        expect(state.selectedNodeIds).toEqual([]);
        expect(state.selectedEdgeIds).toEqual([]);
        expect(state.graph.nodes[0].selected).toBeUndefined();
        expect(state.graph.edges[0].selected).toBeUndefined();
    });

    it('starts a clean undo session whenever a different graph is loaded', () => {
        useCanvasStore.getState().loadGraph({
            nodes: [{ id: 'process-a-node', type: 'action', label: 'A', position: { x: 0, y: 0 } }],
            edges: [],
            swimlanes: [],
        });
        useCanvasStore.getState().updateNode('process-a-node', { label: 'Edited A' });
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);

        const revisionBeforeLoad = useCanvasStore.getState().graphLoadRevision;
        useCanvasStore.getState().loadGraph({
            nodes: [{ id: 'process-b-node', type: 'action', label: 'B', position: { x: 100, y: 0 } }],
            edges: [],
            swimlanes: [],
        });

        expect(useCanvasStore.getState().graphLoadRevision).toBe(revisionBeforeLoad + 1);
        expect(useCanvasStore.temporal.getState().pastStates).toEqual([]);
        expect(useCanvasStore.temporal.getState().futureStates).toEqual([]);

        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.nodes).toMatchObject([
            { id: 'process-b-node', label: 'B' },
        ]);
    });

    it('updates node and edge selection atomically and ignores identical selections', () => {
        let notifications = 0;
        const unsubscribe = useCanvasStore.subscribe(() => { notifications += 1; });

        useCanvasStore.getState().selectElements(['node-1'], ['edge-1']);
        expect(useCanvasStore.getState()).toMatchObject({
            selectedNodeIds: ['node-1'],
            selectedEdgeIds: ['edge-1'],
        });
        expect(notifications).toBe(1);

        useCanvasStore.getState().selectElements(['node-1'], ['edge-1']);
        expect(notifications).toBe(1);
        unsubscribe();
    });

    it('commits a paused multi-node drag as one undoable update', () => {
        useCanvasStore.setState({
            graph: {
                nodes: [
                    { id: 'node-1', type: 'action', label: 'A', position: { x: 0, y: 0 } },
                    { id: 'node-2', type: 'system', label: 'B', position: { x: 64, y: 0 } },
                ],
                edges: [],
                swimlanes: [],
            },
        });
        const temporal = useCanvasStore.temporal.getState();
        temporal.clear();
        temporal.pause();

        useCanvasStore.getState().onNodesChange([
            { id: 'node-1', type: 'position', position: { x: 0, y: 96 } },
            { id: 'node-2', type: 'position', position: { x: 64, y: 96 } },
        ]);
        useCanvasStore.getState().updateNodes([
            { id: 'node-1', updates: { position: { x: 0, y: 0 } } },
            { id: 'node-2', updates: { position: { x: 64, y: 0 } } },
        ]);

        temporal.resume();
        useCanvasStore.getState().updateNodes([
            { id: 'node-1', updates: { position: { x: 0, y: 96 } } },
            { id: 'node-2', updates: { position: { x: 64, y: 96 } } },
        ]);

        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.nodes.map(node => node.position)).toEqual([
            { x: 0, y: 0 },
            { x: 64, y: 0 },
        ]);
    });

    it('removes selected nodes and their connected edges in one undo step', () => {
        useCanvasStore.setState({
            graph: {
                nodes: [
                    { id: 'node-1', type: 'action', label: 'A', position: { x: 0, y: 0 } },
                    { id: 'node-2', type: 'system', label: 'B', position: { x: 64, y: 0 } },
                ],
                edges: [{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', style: 'solid' }],
                swimlanes: [],
            },
            selectedNodeIds: ['node-1', 'node-2'],
            selectedEdgeIds: [],
        });
        useCanvasStore.temporal.getState().clear();

        useCanvasStore.getState().removeElements(['node-1', 'node-2'], []);

        expect(useCanvasStore.getState()).toMatchObject({
            graph: { nodes: [], edges: [] },
            selectedNodeIds: [],
            selectedEdgeIds: [],
        });
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);

        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.nodes).toHaveLength(2);
        expect(useCanvasStore.getState().graph.edges).toHaveLength(1);
    });

    it.each([
        ['type', { type: 'decision' as const }],
        ['dimensions', { width: 280, height: 140 }],
        ['parent relation', { parentId: 'group-1' }],
        ['swimlane relation', { swimlaneId: 'lane-1' }],
        ['resource links', { assetIds: ['asset-1'] }],
        ['drilldown relation', { subGraphId: 'subgraph-1' }],
        ['extensions', { extensions: { 'example.plugin': { status: 'reviewed' } } }],
        ['Event semantics', {
            type: 'event' as const,
            event: {
                kind: 'condition' as const,
                behavior: 'observed' as const,
                timing: { start: { kind: 'date' as const, precision: 'day' as const, value: '2026-09-05' } },
            },
        }],
    ])('makes a node %s change undoable', (_name, updates) => {
        const before = structuredClone(useCanvasStore.getState().graph.nodes[0]);
        useCanvasStore.getState().updateNode('node-1', updates);

        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject(updates);

        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.nodes[0]).toEqual(before);

        useCanvasStore.temporal.getState().redo();
        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject(updates);
    });

    it.each([
        ['handles', { sourceHandleId: 's-right', targetHandleId: 't-left' }],
        ['shape', { type: 'straight' as const }],
        ['label formatting', { labelPosition: 0.25, labelOrientation: 'vertical' as const, labelSize: 'lg' as const, labelColor: '#ef4444' }],
        ['routing', { routingPoints: [{ x: 100, y: 20 }], routingMargin: 72 }],
        ['extensions', { extensions: { 'example.plugin': { reviewed: true } } }],
    ])('makes an edge %s change undoable', (_name, updates) => {
        const before = structuredClone(useCanvasStore.getState().graph.edges[0]);
        useCanvasStore.getState().updateEdge('edge-1', updates);

        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        expect(useCanvasStore.getState().graph.edges[0]).toMatchObject(updates);

        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.edges[0]).toEqual(before);
    });

    it.each([
        ['width', { width: 480 }],
        ['color', { color: 'purple' }],
        ['extensions', { extensions: { 'example.plugin': { locked: true } } }],
    ])('makes a swimlane %s change undoable', (_name, updates) => {
        useCanvasStore.setState({
            graph: {
                nodes: [],
                edges: [],
                swimlanes: [{ id: 'lane-1', label: 'Lane', color: 'blue', order: 0, height: 300 }],
            },
        });
        useCanvasStore.temporal.getState().clear();
        const before = structuredClone(useCanvasStore.getState().graph.swimlanes[0]);

        useCanvasStore.getState().updateSwimlane('lane-1', updates);

        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        expect(useCanvasStore.getState().graph.swimlanes[0]).toMatchObject(updates);

        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.swimlanes[0]).toEqual(before);
    });

    it('releases imported routing when the user changes the edge shape', () => {
        useCanvasStore.getState().updateEdge('edge-1', {
            routingPoints: [{ x: 400, y: 0 }, { x: 400, y: 300 }],
        });
        useCanvasStore.getState().updateEdge('edge-1', { color: '#3b82f6' });
        expect(useCanvasStore.getState().graph.edges[0].routingPoints).toHaveLength(2);

        useCanvasStore.getState().updateEdge('edge-1', { type: 'straight' });

        expect(useCanvasStore.getState().graph.edges[0]).toMatchObject({
            type: 'straight',
            color: '#3b82f6',
        });
        expect(useCanvasStore.getState().graph.edges[0].routingPoints).toBeUndefined();
    });

    it('releases imported routing when an edge endpoint is reconnected', () => {
        useCanvasStore.getState().updateEdge('edge-1', {
            routingPoints: [{ x: 400, y: 0 }, { x: 400, y: 300 }],
        });

        useCanvasStore.getState().updateEdge('edge-1', { targetHandleId: 't-left' });

        expect(useCanvasStore.getState().graph.edges[0].targetHandleId).toBe('t-left');
        expect(useCanvasStore.getState().graph.edges[0].routingPoints).toBeUndefined();
    });

    it('stores semantic routing while releasing imported bend points', () => {
        useCanvasStore.getState().updateEdge('edge-1', {
            routingPoints: [{ x: 400, y: 0 }, { x: 400, y: 300 }],
        });

        useCanvasStore.getState().updateEdge('edge-1', {
            routingMode: 'outside-right',
            routingMargin: 80,
            sourceHandleId: 's-right',
            targetHandleId: 't-right',
        });

        expect(useCanvasStore.getState().graph.edges[0]).toMatchObject({
            routingMode: 'outside-right',
            routingMargin: 80,
            sourceHandleId: 's-right',
            targetHandleId: 't-right',
        });
        expect(useCanvasStore.getState().graph.edges[0].routingPoints).toBeUndefined();
    });
});
