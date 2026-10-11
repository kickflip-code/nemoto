import { describe, expect, it } from 'vitest';
import type { CanvasGraph, CanvasNode, Portfolio, Process } from '../../types';
import { emptyPortfolio } from '../slices/coreSlice';
import { deleteProcessLogic, updateProcessGraphLogic } from './processActions';

const node = (id: string, subGraphId?: string): CanvasNode => ({
    id,
    type: 'action',
    label: id,
    position: { x: 0, y: 0 },
    ...(subGraphId ? { subGraphId } : {}),
});

const graph = (nodes: CanvasNode[]): CanvasGraph => ({
    nodes,
    edges: [],
    swimlanes: [],
    mode: 'blank',
});

const portfolioWith = (process: Process): Portfolio => ({
    ...structuredClone(emptyPortfolio),
    processes: [process],
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

describe('updateProcessGraphLogic drilldown persistence', () => {
    it('does not persist an untouched empty drilldown draft', () => {
        const portfolio = portfolioWith(processWith(graph([node('node-a')])));
        const emptyDraft: CanvasGraph = {
            nodes: [],
            edges: [],
            swimlanes: [],
            mode: 'swimlane',
            viewport: { x: 48, y: 32, zoom: 0.8 },
        };

        const result = updateProcessGraphLogic(portfolio, 'process-1', emptyDraft, ['node-a']);

        expect(result).toBe(portfolio);
        expect(result.processes[0].graph.nodes[0].subGraphId).toBeUndefined();
        expect(result.processes[0].subGraphs).toEqual({});
    });

    it('materializes a draft on its first structural edit', () => {
        const portfolio = portfolioWith(processWith(graph([node('node-a')])));
        const editedDraft = graph([node('child-node')]);

        const result = updateProcessGraphLogic(portfolio, 'process-1', editedDraft, ['node-a']);
        const process = result.processes[0];
        const subGraphId = process.graph.nodes[0].subGraphId;

        expect(subGraphId).toMatch(/^sg-/);
        expect(process.subGraphs?.[subGraphId!]).toBe(editedDraft);
    });

    it('links a nested draft in its actual containing subgraph', () => {
        const portfolio = portfolioWith(processWith(
            graph([node('node-a', 'sg-a')]),
            { 'sg-a': graph([node('node-b')]) },
        ));
        const editedDraft = graph([node('grandchild-node')]);

        const result = updateProcessGraphLogic(
            portfolio,
            'process-1',
            editedDraft,
            ['node-a', 'node-b'],
        );
        const process = result.processes[0];
        const nestedNode = process.subGraphs?.['sg-a'].nodes[0];

        expect(process.graph.nodes[0].subGraphId).toBe('sg-a');
        expect(nestedNode?.subGraphId).toMatch(/^sg-/);
        expect(process.subGraphs?.[nestedNode!.subGraphId!]).toBe(editedDraft);
    });

    it('refuses to write through a cyclic drilldown target', () => {
        const portfolio = portfolioWith(processWith(
            graph([node('node-a', 'sg-a')]),
            { 'sg-a': graph([node('node-b', 'sg-a')]) },
        ));

        const result = updateProcessGraphLogic(
            portfolio,
            'process-1',
            graph([node('replacement')]),
            ['node-a', 'node-b'],
        );

        expect(result).toBe(portfolio);
        expect(result.processes[0].subGraphs?.['sg-a'].nodes[0].id).toBe('node-b');
    });
});

describe('deleteProcessLogic related resource cleanup', () => {
    it('keeps resources still used as owners or hierarchy parents', () => {
        const deletedProcess = processWith(graph([node('deleted-node')]));
        deletedProcess.id = 'deleted-process';
        deletedProcess.graph.nodes[0].assetIds = ['owner-resource', 'parent-resource'];
        const keptProcess = processWith(graph([]));
        keptProcess.id = 'kept-process';
        keptProcess.ownerId = 'owner-resource';
        const portfolio: Portfolio = {
            ...structuredClone(emptyPortfolio),
            processes: [deletedProcess, keptProcess],
            assets: [
                { id: 'owner-resource', name: 'Owner', type: 'systems' },
                { id: 'parent-resource', name: 'Parent', type: 'systems' },
                { id: 'child-resource', name: 'Child', type: 'systems', parentId: 'parent-resource' },
            ],
        };

        const result = deleteProcessLogic(portfolio, ['deleted-process'], null, true).portfolio;

        expect(result.assets.map(asset => asset.id)).toEqual([
            'owner-resource',
            'parent-resource',
            'child-resource',
        ]);
        expect(result.processes[0].ownerId).toBe('owner-resource');
    });
});
