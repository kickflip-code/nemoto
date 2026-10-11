import { beforeEach, describe, expect, it } from 'vitest';
import type { CanvasGraph, CanvasMode, Portfolio } from '../types';
import { divisionLanes, membershipAt, migrateDivision } from './canvasDivision';
import { decodePortfolioJson, serializePortfolioEnvelope } from './portfolioCodec';
import { inspectPortfolioIntegrity } from './portfolioIntegrity';
import { cloneCanvasClipboard, captureCanvasClipboard } from './canvasClipboard';
import { cloneProcessForMerge } from './import/merge';
import { useCanvasStore } from '../stores/useCanvasStore';
import { createSharedProcessProjection } from '../export/shareablePortfolio';

const legacy = (mode: CanvasMode): CanvasGraph => ({ mode,
    swimlanes: [{ id: 'lane', label: 'Original', color: '#123456', order: 0, height: 240, width: 420 }],
    nodes: [{ id: 'a', type: 'action', label: 'A', position: { x: 120, y: 100 }, swimlaneId: 'lane' },
        { id: 'b', type: 'action', label: 'B', position: { x: 240, y: 160 } }],
    edges: [{ id: 'e', sourceId: 'a', targetId: 'b', style: 'solid', routingManual: true, routingPoints: [{ x: 200, y: 100 }] }],
});
const combined = (): CanvasGraph => {
    const graph = migrateDivision(legacy('swimlane'));
    graph.division!.columnsVisible = true;
    graph.swimlanes.push({ id: 'column', axis: 'column', label: 'Column', color: 'green', order: 0, height: 300, width: 320 });
    graph.nodes[0].columnId = 'column';
    return graph;
};
const portfolio = (graph: CanvasGraph): Portfolio => ({ version: '1', lastModified: '', processes: [{
    id: 'p', title: 'Map', createdAt: '', updatedAt: '', mode: 'blank', graph,
}], processFolders: [], assets: [], assetCategories: [], incidents: [], journal: { notebooks: [], folders: [], entries: [], tags: [] } });

describe('unified canvas division lifecycle', () => {
    beforeEach(() => useCanvasStore.getState().loadGraph(combined()));
    it.each(['blank', 'swimlane', 'swimlane-vertical'] as const)('migrates and reopens %s without moving or losing content', mode => {
        const original = legacy(mode);
        const decoded = decodePortfolioJson(serializePortfolioEnvelope(portfolio(original))).portfolio;
        const graph = decoded.processes[0].graph;
        expect(decoded.schemaVersion).toBe(4);
        expect(graph.nodes[0].position).toEqual(original.nodes[0].position);
        expect(graph.edges).toEqual(original.edges);
        expect(graph.swimlanes[0]).toMatchObject(original.swimlanes[0]);
        expect(graph.division).toEqual({ version: 1, rowsVisible: mode === 'swimlane', columnsVisible: mode === 'swimlane-vertical' });
        expect(graph.nodes[0][mode === 'swimlane-vertical' ? 'columnId' : 'rowId']).toBe('lane');
        expect(migrateDivision(graph)).toEqual(graph);
    });
    it('hides, resizes, reorders and removes without changing steps or manual bends; undo and redo restore both axes', () => {
        const state = useCanvasStore.getState();
        const original = structuredClone(state.graph);
        state.setDivisionVisible('row', false);
        expect(useCanvasStore.getState().graph.nodes).toEqual(original.nodes);
        expect(membershipAt(useCanvasStore.getState().graph, { x: 20, y: 600 })).toEqual({ columnId: 'column' });
        state.setDivisionVisible('row', true);
        state.addSwimlane('Second', 'blue', 'row');
        state.updateSwimlane('lane', { height: 400, label: 'Renamed' });
        state.moveSwimlane('lane', 'down');
        expect(divisionLanes(useCanvasStore.getState().graph, 'row')[1].id).toBe('lane');
        expect(useCanvasStore.getState().graph.nodes).toEqual(original.nodes);
        expect(useCanvasStore.getState().graph.edges).toEqual(original.edges);
        state.removeSwimlane('lane');
        expect(useCanvasStore.getState().graph.nodes).toHaveLength(2);
        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject({ rowId: null, columnId: 'column' });
        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.nodes).toEqual(original.nodes);
        useCanvasStore.temporal.getState().redo();
        expect(useCanvasStore.getState().graph.nodes[0].rowId).toBeNull();
    });
    it('assigns both directions independently and preserves hidden memberships', () => {
        const graph = combined();
        expect(membershipAt(graph, { x: 20, y: 30 })).toEqual({ rowId: 'lane', columnId: 'column' });
        expect(membershipAt(graph, { x: -20, y: 30 })).toEqual({ rowId: 'lane', columnId: null });
        graph.division!.rowsVisible = false;
        graph.division!.columnsVisible = false;
        expect(membershipAt(graph, { x: 900, y: 900 })).toEqual({});
    });
    it('migrates legacy parent-based membership and detaches it safely on deletion', () => {
        const graph = legacy('swimlane-vertical');
        delete graph.nodes[0].swimlaneId;
        graph.nodes[0].parentId = 'lane';
        useCanvasStore.getState().loadGraph(migrateDivision(graph));
        expect(useCanvasStore.getState().graph.nodes[0].columnId).toBe('lane');
        useCanvasStore.getState().removeSwimlane('lane');
        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject({ parentId: null, columnId: null, position: graph.nodes[0].position });
        expect(inspectPortfolioIntegrity(portfolio(useCanvasStore.getState().graph)).valid).toBe(true);
    });
    it('round trips combined and hidden divisions, validates axis references, and projects HTML data', () => {
        const graph = combined();
        graph.division!.rowsVisible = false;
        const reopened = decodePortfolioJson(serializePortfolioEnvelope(portfolio(graph))).portfolio;
        expect(reopened.processes[0].graph).toEqual(graph);
        const projected = createSharedProcessProjection(reopened, 'p');
        expect(projected.portfolio.processes[0].graph).toMatchObject(graph);
        reopened.processes[0].graph.nodes[0].rowId = 'column';
        expect(inspectPortfolioIntegrity(reopened).valid).toBe(false);
    });
    it('preserves same-canvas assignments and remaps nested graphs and merged imports', () => {
        const graph = combined();
        const copied = cloneCanvasClipboard(captureCanvasClipboard(graph, ['a']), graph);
        expect(copied.nodes[0]).toMatchObject({ rowId: 'lane', columnId: 'column' });
        expect(cloneCanvasClipboard(captureCanvasClipboard(graph, ['a'])).nodes[0].rowId).toBeUndefined();
        const root: CanvasGraph = { nodes: [{ id: 'root', type: 'action', label: 'Root', position: { x: 0, y: 0 }, subGraphId: 'sg' }], edges: [], swimlanes: [] };
        const nested = cloneCanvasClipboard(captureCanvasClipboard(root, ['root'], { sg: graph }));
        const child = nested.subGraphs[nested.nodes[0].subGraphId!];
        expect(child.nodes[0].rowId).toBe(child.swimlanes.find(lane => lane.axis === 'row')!.id);
        expect(child.nodes[0].columnId).toBe(child.swimlanes.find(lane => lane.axis === 'column')!.id);
        expect(child.edges[0].routingPoints).toEqual(graph.edges[0].routingPoints);
        const process = portfolio(graph).processes[0];
        const merged = cloneProcessForMerge(process, { assetIds: new Map(), processIds: new Map(), nodeIds: new Map() });
        expect(merged.graph.nodes[0].rowId).toBe(merged.graph.swimlanes.find(lane => lane.axis === 'row')!.id);
        expect(merged.graph.division).toEqual(graph.division);
    });
});
