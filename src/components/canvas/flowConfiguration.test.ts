import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../types';
import { toFlowEdge, toFlowNode } from './flowConfiguration';

function node(overrides: Partial<CanvasNode>): CanvasNode {
    return {
        id: 'node-1',
        type: 'action',
        label: 'Node',
        position: { x: 0, y: 0 },
        ...overrides,
    };
}

describe('canvas flow-node configuration', () => {
    it('injects the canonical asset reference for placed resource rendering', () => {
        const flowNode = toFlowNode(node({
            type: 'resource',
            assetIds: ['canonical-asset'],
            data: { assetId: 'legacy-asset' },
        }));

        expect(flowNode.data.assetId).toBe('canonical-asset');
        expect(flowNode.data.assetIds).toEqual(['canonical-asset']);
    });

    it('does not overwrite data fields on ordinary process nodes', () => {
        const flowNode = toFlowNode(node({
            data: { assetId: 'legacy-process-metadata' },
        }));

        expect(flowNode.data.assetId).toBe('legacy-process-metadata');
    });

    it('injects Event semantics and uses the Event routing baseline', () => {
        const event = {
            kind: 'timer' as const,
            behavior: 'observed' as const,
            timing: {
                start: { kind: 'date' as const, precision: 'day' as const, value: '2026-09-05' },
                allDay: true,
            },
        };
        const flowNode = toFlowNode(node({ type: 'event', event }));

        expect(flowNode.data.event).toEqual(event);
        expect(flowNode.style).toMatchObject({ width: 240, height: 112 });
    });

    it('normalizes stale built-in dimensions while preserving custom sizes', () => {
        const staleSystem = toFlowNode(node({ type: 'system', width: 224, height: 160 }));
        const customSystem = toFlowNode(node({ type: 'system', width: 280, height: 140 }));

        expect(staleSystem.style).toMatchObject({ width: 224, height: 96 });
        expect(staleSystem.data).toMatchObject({ width: 224, height: 96 });
        expect(customSystem.style).toMatchObject({ width: 280, height: 140 });
    });

    it('passes durable routing points to the custom edge renderer', () => {
        const edge: CanvasEdge = {
            id: 'edge-1',
            sourceId: 'node-1',
            targetId: 'node-2',
            style: 'solid',
            routingPoints: [{ x: 400, y: 100 }, { x: 400, y: 300 }],
        };

        expect(toFlowEdge(edge).data?.routingPoints).toEqual(edge.routingPoints);
    });

    it('resolves a semantic outside route from the current node positions', () => {
        const edge: CanvasEdge = {
            id: 'edge-1',
            sourceId: 'node-1',
            targetId: 'node-2',
            style: 'solid',
            routingMode: 'outside-right',
            routingMargin: 64,
        };
        const nodes = [
            node({ id: 'node-1', position: { x: 0, y: 0 }, width: 200 }),
            node({ id: 'node-2', position: { x: 500, y: 300 }, width: 224 }),
        ];

        expect(toFlowEdge(edge, false, nodes).data).toMatchObject({
            routingMode: 'outside-right',
            routingCorridor: 788,
        });
    });
});
