import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '../stores/useCanvasStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import { useAutoSave } from './useAutoSave';

vi.mock('../lib/tauri', () => ({
    getConfig: vi.fn().mockResolvedValue({ autoSaveInterval: 0 }),
}));

const originalPortfolioActions = {
    markDirty: usePortfolioStore.getState().markDirty,
    savePortfolio: usePortfolioStore.getState().savePortfolio,
    updateProcessGraph: usePortfolioStore.getState().updateProcessGraph,
};

describe('useAutoSave canvas synchronization', () => {
    const markDirty = vi.fn();
    const savePortfolio = vi.fn().mockResolvedValue(undefined);
    const updateProcessGraph = vi.fn();

    beforeEach(() => {
        markDirty.mockReset();
        savePortfolio.mockReset();
        savePortfolio.mockResolvedValue(undefined);
        updateProcessGraph.mockReset();

        useCanvasStore.temporal.getState().resume();
        useCanvasStore.temporal.getState().clear();
        useCanvasStore.setState({
            graph: { nodes: [], edges: [], swimlanes: [] },
            viewport: { x: 0, y: 0, zoom: 1 },
            selectedNodeIds: [],
            selectedEdgeIds: [],
            graphLoadRevision: 0,
        });
        useProcessSessionStore.setState({ activeProcessId: 'process-b', breadcrumbStack: [] });
        usePortfolioStore.setState({ markDirty, savePortfolio, updateProcessGraph });
    });

    afterEach(() => {
        usePortfolioStore.setState(originalPortfolioActions);
    });

    it('does not dirty or persist the destination process when a graph is loaded', () => {
        renderHook(() => useAutoSave());

        act(() => {
            useCanvasStore.getState().loadGraph({
                nodes: [{ id: 'process-b-node', type: 'action', label: 'B', position: { x: 0, y: 0 } }],
                edges: [],
                swimlanes: [],
                viewport: { x: 32, y: 48, zoom: 0.8 },
            });
        });

        expect(markDirty).not.toHaveBeenCalled();
        expect(updateProcessGraph).not.toHaveBeenCalled();
    });

    it('persists the first semantic edit after loading to the active process', () => {
        renderHook(() => useAutoSave());
        act(() => {
            useCanvasStore.getState().loadGraph({
                nodes: [{ id: 'process-b-node', type: 'action', label: 'B', position: { x: 0, y: 0 } }],
                edges: [],
                swimlanes: [],
            });
            useCanvasStore.getState().updateNode('process-b-node', { label: 'Edited B' });
        });

        expect(markDirty).not.toHaveBeenCalled();
        expect(updateProcessGraph).toHaveBeenCalledTimes(1);
        expect(updateProcessGraph).toHaveBeenCalledWith(
            'process-b',
            expect.objectContaining({
                nodes: [expect.objectContaining({ id: 'process-b-node', label: 'Edited B' })],
            }),
        );
    });

    it('synchronizes Event timing edits into the active portfolio graph', () => {
        renderHook(() => useAutoSave());
        act(() => {
            useCanvasStore.getState().loadGraph({
                nodes: [{
                    id: 'event-1',
                    type: 'event',
                    label: 'Review',
                    position: { x: 0, y: 0 },
                    event: {
                        kind: 'timer',
                        behavior: 'observed',
                        timing: { start: { kind: 'date', precision: 'day', value: '2026-09-05' } },
                    },
                }],
                edges: [],
                swimlanes: [],
            });
            useCanvasStore.getState().updateNode('event-1', {
                event: {
                    kind: 'timer',
                    behavior: 'observed',
                    timing: {
                        start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                        end: { kind: 'date', precision: 'day', value: '2026-09-07' },
                        allDay: true,
                    },
                },
            });
        });

        expect(updateProcessGraph).toHaveBeenCalledWith('process-b', expect.objectContaining({
            nodes: [expect.objectContaining({
                type: 'event',
                event: expect.objectContaining({
                    kind: 'timer',
                    behavior: 'observed',
                    timing: expect.objectContaining({ allDay: true }),
                }),
            })],
        }));
    });

    it('advances the portfolio revision once for one semantic canvas edit', () => {
        const portfolio = structuredClone(emptyPortfolio);
        portfolio.processes = [{
            id: 'process-b',
            title: 'B',
            createdAt: '2026-08-31T00:00:00.000Z',
            updatedAt: '2026-08-31T00:00:00.000Z',
            mode: 'blank',
            graph: {
                nodes: [{ id: 'process-b-node', type: 'action', label: 'B', position: { x: 0, y: 0 } }],
                edges: [],
                swimlanes: [],
            },
        }];
        usePortfolioStore.setState({
            ...originalPortfolioActions,
            portfolio,
            isDirty: false,
            changeRevision: 0,
        });
        renderHook(() => useAutoSave());

        act(() => {
            useCanvasStore.getState().loadGraph(portfolio.processes[0].graph);
        });
        expect(usePortfolioStore.getState()).toMatchObject({ isDirty: false, changeRevision: 0 });

        act(() => {
            useCanvasStore.getState().updateNode('process-b-node', { label: 'Edited once' });
        });

        expect(usePortfolioStore.getState()).toMatchObject({ isDirty: true, changeRevision: 1 });
        expect(usePortfolioStore.getState().portfolio.processes[0].graph.nodes[0].label).toBe('Edited once');
    });

    it('cannot undo process A into process B after navigation', () => {
        const portfolio = structuredClone(emptyPortfolio);
        portfolio.processes = ['a', 'b'].map(id => ({
            id: `process-${id}`,
            title: id.toUpperCase(),
            createdAt: '2026-08-31T00:00:00.000Z',
            updatedAt: '2026-08-31T00:00:00.000Z',
            mode: 'blank' as const,
            graph: {
                nodes: [{ id: `node-${id}`, type: 'action' as const, label: id.toUpperCase(), position: { x: 0, y: 0 } }],
                edges: [],
                swimlanes: [],
            },
        }));
        usePortfolioStore.setState({
            ...originalPortfolioActions,
            portfolio,
            isDirty: false,
            changeRevision: 0,
        });
        useProcessSessionStore.setState({ activeProcessId: 'process-a', breadcrumbStack: [] });
        renderHook(() => useAutoSave());

        act(() => {
            useCanvasStore.getState().loadGraph(portfolio.processes[0].graph);
            useCanvasStore.getState().updateNode('node-a', { label: 'Edited A' });
        });
        expect(usePortfolioStore.getState().portfolio.processes[0].graph.nodes[0].label).toBe('Edited A');

        act(() => {
            useProcessSessionStore.getState().setActiveProcess('process-b');
            useCanvasStore.getState().loadGraph(portfolio.processes[1].graph);
            useCanvasStore.temporal.getState().undo();
        });

        expect(useCanvasStore.getState().graph.nodes).toMatchObject([{ id: 'node-b', label: 'B' }]);
        expect(usePortfolioStore.getState().portfolio.processes[0].graph.nodes[0].label).toBe('Edited A');
        expect(usePortfolioStore.getState().portfolio.processes[1].graph.nodes[0].label).toBe('B');
        expect(usePortfolioStore.getState().changeRevision).toBe(1);
    });
});
