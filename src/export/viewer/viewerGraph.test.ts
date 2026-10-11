import { describe, expect, it } from 'vitest';
import { toViewerEdge } from './viewerGraph';

describe('HTML viewer edge mapping', () => {
    it('preserves animation and label formatting independently of line style', () => {
        const dashed = toViewerEdge({
            id: 'edge-dashed',
            sourceId: 'a',
            targetId: 'b',
            style: 'dashed',
            animated: false,
            label: 'Review',
            labelSize: 'lg',
            labelColor: '#ef4444',
        }, []);
        const animatedSolid = toViewerEdge({
            id: 'edge-solid',
            sourceId: 'a',
            targetId: 'b',
            style: 'solid',
            animated: true,
        }, []);

        expect(dashed.animated).toBe(false);
        expect(dashed.style?.strokeDasharray).toBe('5,5');
        expect(dashed.data).toMatchObject({ labelSize: 'lg', labelColor: '#ef4444' });
        expect(animatedSolid.animated).toBe(true);
        expect(animatedSolid.style?.strokeDasharray).toBeUndefined();
    });
});
