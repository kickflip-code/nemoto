import { describe, expect, it } from 'vitest';
import { captureCanvasClipboard, cloneCanvasClipboard } from './canvasClipboard';
import type { CanvasGraph, CanvasNode } from '../types';

const node = (id: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, label: id, type: 'action', position: { x: 10, y: 20 }, ...extra });
const graph = (nodes: CanvasNode[]): CanvasGraph => ({ nodes, edges: [], swimlanes: [] });

describe('canvas clipboard integrity', () => {
    it('copies manual bends independently and offsets them with the pasted nodes', () => {
        const source = graph([node('a'), node('b')]);
        source.edges = [{ id: 'route', sourceId: 'a', targetId: 'b', style: 'solid', routingManual: true,
            routingPoints: [{ x: 300, y: 200 }, { x: 300, y: 400 }] }];
        const copy = cloneCanvasClipboard(captureCanvasClipboard(source, ['a', 'b']));
        expect(copy.edges[0].routingManual).toBe(true);
        expect(copy.edges[0].routingPoints).toEqual([{ x: 332, y: 232 }, { x: 332, y: 432 }]);
        copy.edges[0].routingPoints![0].x = 999;
        expect(source.edges[0].routingPoints![0].x).toBe(300);
    });

    it('includes group descendants and internal edges, but detaches a partial selection', () => {
        const source = graph([node('group', { type: 'group' }), node('child', { parentId: 'group', swimlaneId: 'old-lane' }), node('outside')]);
        source.edges = [{ id: 'inside', sourceId: 'group', targetId: 'child', style: 'solid' }, { id: 'outside-edge', sourceId: 'child', targetId: 'outside', style: 'solid' }];
        const copied = cloneCanvasClipboard(captureCanvasClipboard(source, ['group']));
        expect(copied.nodes).toHaveLength(2);
        expect(copied.nodes[1].parentId).toBe(copied.nodes[0].id);
        expect(copied.nodes[1].position).toEqual({ x: 10, y: 20 });
        expect(copied.edges).toHaveLength(1);
        expect(copied.edges[0].targetId).toBe(copied.nodes[1].id);
        const partial = cloneCanvasClipboard(captureCanvasClipboard(source, ['child']));
        expect(partial.nodes[0].parentId).toBeUndefined();
        expect(partial.nodes[0].swimlaneId).toBeUndefined();
        expect(partial.nodes[0].position).toEqual({ x: 52, y: 72 });
        expect(partial.edges).toEqual([]);
    });

    it('remaps child lanes and edges, preserves resources and opaque extension data', () => {
        const child = graph([node('a', { parentId: 'lane', swimlaneId: 'lane', assetIds: ['resource'], extensions: { 'org.example': { text: 'keep' } } }), node('b')]);
        child.swimlanes = [{ id: 'lane', label: 'IT', color: 'blue', order: 0, height: 300 }];
        child.edges = [{ id: 'edge', sourceId: 'a', targetId: 'b', style: 'solid' }];
        const copy = cloneCanvasClipboard(captureCanvasClipboard(graph([node('root', { subGraphId: 'child' })]), ['root'], { child }));
        const cloned = copy.subGraphs[copy.nodes[0].subGraphId!];
        expect(cloned.swimlanes[0].id).not.toBe('lane');
        expect(cloned.nodes[0].parentId).toBe(cloned.swimlanes[0].id);
        expect(cloned.nodes[0].swimlaneId).toBe(cloned.swimlanes[0].id);
        expect(cloned.nodes[0].assetIds).toEqual(['resource']);
        expect(cloned.nodes[0].extensions).toEqual(child.nodes[0].extensions);
        expect(cloned.nodes[0].extensions).not.toBe(child.nodes[0].extensions);
        expect(cloned.edges[0].sourceId).toBe(cloned.nodes[0].id);
    });

    it('rejects missing or cyclic drilldowns before changing any data', () => {
        const root = graph([node('root', { subGraphId: 'child' })]);
        expect(() => captureCanvasClipboard(root, ['root'])).toThrow('missing');
        expect(() => captureCanvasClipboard(root, ['root'], { child: graph([node('cycle', { subGraphId: 'child' })]) })).toThrow('cyclic');
    });
});
