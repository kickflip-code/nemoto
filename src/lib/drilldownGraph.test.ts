import { describe, expect, it } from 'vitest';
import type { CanvasGraph, CanvasNode, Process } from '../types';
import {
    buildDrilldownTree,
    removeDrilldownNodeAtPath,
    renameDrilldownNodeAtPath,
    resolveDrilldownNodeAtPath,
} from './drilldownGraph';

const node = (id: string, label: string, subGraphId?: string): CanvasNode => ({
    id,
    type: 'action',
    label,
    position: { x: 0, y: 0 },
    ...(subGraphId ? { subGraphId } : {}),
});

const graph = (nodes: CanvasNode[], edges: CanvasGraph['edges'] = []): CanvasGraph => ({
    nodes,
    edges,
    swimlanes: [],
    mode: 'blank',
});

const processWith = (
    root: CanvasGraph,
    subGraphs: Record<string, CanvasGraph>,
): Process => ({
    id: 'process-1',
    title: 'Process',
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    mode: 'blank',
    graph: root,
    subGraphs,
});

describe('drilldown graph integrity', () => {
    it('stops a cyclic branch while keeping the cycle-closing node visible', () => {
        const process = processWith(
            graph([node('node-a', 'A', 'sg-a')]),
            {
                'sg-a': graph([node('node-b', 'B', 'sg-b')]),
                'sg-b': graph([node('node-c', 'C', 'sg-a')]),
            },
        );

        const tree = buildDrilldownTree(process);

        expect(tree).toHaveLength(1);
        expect(tree[0].breadcrumbPath).toEqual(['node-a']);
        expect(tree[0].children[0].breadcrumbPath).toEqual(['node-a', 'node-b']);
        expect(tree[0].children[0].children[0]).toMatchObject({
            breadcrumbPath: ['node-a', 'node-b', 'node-c'],
            cyclic: true,
            children: [],
        });
    });

    it('can delete the visible cycle-closing node and repair the branch', () => {
        const process = processWith(
            graph([node('node-a', 'A', 'sg-a')]),
            {
                'sg-a': graph([node('node-b', 'B', 'sg-b')]),
                'sg-b': graph([node('node-c', 'C', 'sg-a')]),
            },
        );

        const result = removeDrilldownNodeAtPath(
            process,
            ['node-a', 'node-b', 'node-c'],
        );
        const repairedTree = buildDrilldownTree(result.process);

        expect(result.removed).toBe(true);
        expect(result.process.subGraphs?.['sg-b'].nodes).toEqual([]);
        expect(repairedTree[0].children[0].children).toEqual([]);
    });

    it('resolves duplicate node ids by their exact breadcrumb path', () => {
        const process = processWith(
            graph([node('duplicate', 'Root copy', 'sg-a')]),
            { 'sg-a': graph([node('duplicate', 'Nested copy')]) },
        );

        expect(resolveDrilldownNodeAtPath(process, ['duplicate'])?.node.label).toBe('Root copy');
        expect(resolveDrilldownNodeAtPath(process, ['duplicate', 'duplicate'])?.node.label).toBe('Nested copy');
    });

    it('removes a nested node, its incident edges, and its now-unreachable descendants', () => {
        const process = processWith(
            graph([node('node-a', 'A', 'sg-a')]),
            {
                'sg-a': graph(
                    [node('node-b', 'B', 'sg-b'), node('node-peer', 'Peer')],
                    [{ id: 'edge-b', sourceId: 'node-b', targetId: 'node-peer', style: 'solid' }],
                ),
                'sg-b': graph([node('node-child', 'Child')]),
            },
        );

        const result = removeDrilldownNodeAtPath(process, ['node-a', 'node-b']);

        expect(result.removed).toBe(true);
        expect(result.process.subGraphs?.['sg-a'].nodes.map(item => item.id)).toEqual(['node-peer']);
        expect(result.process.subGraphs?.['sg-a'].edges).toEqual([]);
        expect(result.process.subGraphs).not.toHaveProperty('sg-b');
        expect(result.removedSubGraphIds).toEqual(['sg-b']);
    });

    it('preserves a child graph that remains reachable through another node', () => {
        const process = processWith(
            graph([
                node('node-a', 'A', 'sg-shared'),
                node('node-b', 'B', 'sg-shared'),
            ]),
            { 'sg-shared': graph([node('node-child', 'Child')]) },
        );

        const result = removeDrilldownNodeAtPath(process, ['node-a']);

        expect(result.process.graph.nodes.map(item => item.id)).toEqual(['node-b']);
        expect(result.process.subGraphs).toHaveProperty('sg-shared');
        expect(result.removedSubGraphIds).toEqual([]);
    });

    it('renames only the node addressed by the breadcrumb path', () => {
        const process = processWith(
            graph([node('duplicate', 'Root copy', 'sg-a')]),
            { 'sg-a': graph([node('duplicate', 'Nested copy')]) },
        );

        const renamed = renameDrilldownNodeAtPath(
            process,
            ['duplicate', 'duplicate'],
            'Nested renamed',
        );

        expect(renamed?.graph.nodes[0].label).toBe('Root copy');
        expect(renamed?.subGraphs?.['sg-a'].nodes[0].label).toBe('Nested renamed');
    });
});
