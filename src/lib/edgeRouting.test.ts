import { describe, expect, it } from 'vitest';
import {
    getDynamicRoutingPoints,
    getDefaultRoutingNodeSize,
    getRoutedEdgePath,
    getRoutingCorridor,
    normalizeRoutingMargin,
    resolveRoutingNodeSize,
} from './edgeRouting';

describe('durable edge routing', () => {
    it('uses the rendered Resource-card footprint and upgrades legacy compact bounds', () => {
        expect(getDefaultRoutingNodeSize('resource')).toEqual({ width: 224, height: 96 });
        expect(resolveRoutingNodeSize({
            type: 'resource',
            position: { x: 0, y: 0 },
            width: 200,
            height: 72,
        })).toEqual({ width: 224, height: 96 });
    });

    it('builds a polyline through imported routing points', () => {
        expect(getRoutedEdgePath(0, 0, 100, 100, [
            { x: 140, y: 0 },
            { x: 140, y: 100 },
        ])).toEqual([
            'M 0 0 L 140 0 L 140 100 L 100 100',
            140,
            0,
            140,
            0,
        ]);
    });

    it('ignores malformed and duplicate points', () => {
        const result = getRoutedEdgePath(0, 0, 100, 0, [
            { x: 0, y: 0 },
            { x: Number.NaN, y: 10 },
            { x: 50, y: 0 },
            { x: 50, y: 0 },
        ]);

        expect(result?.[0]).toBe('M 0 0 L 50 0 L 100 0');
    });

    it('calculates an outside-right corridor from all node bounds', () => {
        const corridor = getRoutingCorridor('outside-right', [
            { type: 'action', position: { x: 20, y: 40 }, width: 200, height: 80 },
            { type: 'decision', position: { x: 400, y: 200 }, width: 224, height: 160 },
        ], 80);

        expect(corridor).toBe(704);
        expect(getDynamicRoutingPoints('outside-right', corridor, 100, 80, 500, 300)).toEqual([
            { x: 704, y: 80 },
            { x: 704, y: 300 },
        ]);
    });

    it('recalculates the route corridor after a node moves', () => {
        const nodes = [
            { type: 'action', position: { x: 0, y: 0 }, width: 200, height: 80 },
            { type: 'action', position: { x: 300, y: 0 }, width: 200, height: 80 },
        ];

        expect(getRoutingCorridor('outside-right', nodes, 80)).toBe(580);
        nodes[1].position.x = 700;
        expect(getRoutingCorridor('outside-right', nodes, 80)).toBe(980);
    });

    it('supports all four outside directions and clamps unsafe margins', () => {
        const nodes = [{ type: 'action', position: { x: 100, y: 200 }, width: 200, height: 80 }];

        expect(getRoutingCorridor('outside-left', nodes, 40)).toBe(60);
        expect(getRoutingCorridor('above', nodes, 40)).toBe(160);
        expect(getRoutingCorridor('below', nodes, 40)).toBe(320);
        expect(normalizeRoutingMargin(-100)).toBe(24);
        expect(normalizeRoutingMargin(1000)).toBe(320);
    });

    it('can round dynamic route corners without changing imported-route defaults', () => {
        const points = [{ x: 140, y: 0 }, { x: 140, y: 100 }];

        expect(getRoutedEdgePath(0, 0, 100, 100, points)?.[0])
            .toBe('M 0 0 L 140 0 L 140 100 L 100 100');
        expect(getRoutedEdgePath(0, 0, 100, 100, points, { cornerRadius: 10 })?.[0])
            .toContain('Q 140 0');
    });
});
