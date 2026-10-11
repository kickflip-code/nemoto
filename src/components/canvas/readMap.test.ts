import { describe, expect, it } from 'vitest';
import type { Asset, CanvasGraph, Process } from '../../types';
import { buildReadMap, readMapPath } from './readMap';

const graph: CanvasGraph = {
    nodes: [
        { id: 'a', type: 'action', label: 'Review', position: { x: 0, y: 0 }, swimlaneId: 'lane' },
        { id: 'b', type: 'action', label: 'Review', position: { x: 100, y: 0 }, subGraphId: 'child' },
        { id: 'c', type: 'resource', label: 'Imported name', position: { x: 200, y: 0 }, assetIds: ['canonical'], data: { assetId: 'legacy' } },
        { id: 'd', type: 'event', label: null, position: { x: 300, y: 0 }, event: { kind: 'timer', behavior: 'observed' } },
    ],
    edges: [
        { id: 'edge', sourceId: 'a', targetId: 'b', style: 'solid', label: 'Approved' },
        { id: 'loop', sourceId: 'b', targetId: 'b', style: 'solid' },
        { id: 'broken', sourceId: 'missing', targetId: 'c', style: 'solid' },
    ],
    swimlanes: [{ id: 'lane', label: 'Owner', order: 0, height: 100, color: 'blue' }],
};
const assets: Asset[] = [{ id: 'canonical', type: 'system', name: 'Current system' }, { id: 'legacy', type: 'system', name: 'Wrong system' }];

describe('Read map contract', () => {
    it('distinguishes duplicate names, directed links, loops, lanes, Events and selection without modifying input', () => {
        const before = structuredClone({ graph, assets });
        const map = buildReadMap(graph, assets, ['b', 'stale-id'], ['edge'], false);
        expect(map.nodes[0].title).not.toBe(map.nodes[1].title);
        expect(map.nodes[0]).toMatchObject({ incoming: [], outgoing: [0], lane: 'Owner', selected: false });
        expect(map.nodes[1]).toMatchObject({ incoming: [0, 1], outgoing: [1], selected: true, hasDrilldown: true });
        expect(map.nodes[2].label).toBe('Current system');
        expect(map.nodes[3].label).toBe('Untitled event');
        expect(map.nodes[3].event).toMatch(/Timer.*Observed/i);
        expect(map.connections[0]).toMatchObject({ source: { id: 'a' }, target: { id: 'b' }, label: 'Approved', selected: true });
        expect(map.connections[2].source).toBeUndefined();
        expect(map.summary).toBe('4 nodes. 3 connections. 1 node and 1 connection selected.');
        expect({ graph, assets }).toEqual(before);
    });

    it('does not resolve preview names or selection through the open Portfolio', () => {
        const map = buildReadMap(graph, assets, ['c'], ['edge'], true);
        expect(map.nodes[2].label).toBe('Imported name');
        expect(map.nodes.every(node => !node.selected)).toBe(true);
        expect(map.connections.every(edge => !edge.selected)).toBe(true);
        expect(map.summary).toContain('Read-only preview; no selection');
    });

    it('keeps complete long labels and uses current display-label overrides', () => {
        const label = '<script>plain text</script> ' + 'Long note '.repeat(30);
        const map = buildReadMap({ ...graph, nodes: [{ ...graph.nodes[0], data: { label } }] }, [], [], [], false);
        expect(map.nodes[0].label).toBe(label.trim());
        expect(map.nodes[0].title.length).toBeLessThan(130);
    });

    it('describes a valid subprocess path and stops at broken or cyclic paths', () => {
        const process = { title: 'Lifecycle', graph, subGraphs: { child: graph } } as unknown as Process;
        expect(readMapPath(process, ['b', 'b', 'b'], false)).toBe('Lifecycle / Review');
        expect(readMapPath(process, ['missing'], false)).toBe('Lifecycle');
        expect(readMapPath(process, ['b'], true)).toBe('Imported process — read-only');
        expect(readMapPath(undefined, [], false)).toBe('Process map');
    });
});
