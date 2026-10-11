import { describe, expect, it } from 'vitest';
import { THEME_COMPACT_PREVIEW_NODES, THEME_PREVIEW_NODES } from './CanvasThemePreview';

describe('Theme Studio canvas fixtures', () => {
    it.each([
        ['full', THEME_PREVIEW_NODES],
        ['application', THEME_COMPACT_PREVIEW_NODES],
    ])('includes a representative process Event in the %s preview', (_scene, nodes) => {
        expect(nodes).toContainEqual(expect.objectContaining({
            type: 'event',
            event: expect.objectContaining({
                kind: expect.stringMatching(/^(message|timer)$/),
                behavior: 'observed',
            }),
        }));
    });

    it('keeps timing optional in the full preview and demonstrates it in the compact preview', () => {
        expect(THEME_PREVIEW_NODES.find(node => node.type === 'event')?.event?.timing).toBeUndefined();
        expect(THEME_COMPACT_PREVIEW_NODES.find(node => node.type === 'event')?.event?.timing)
            .toMatchObject({ start: expect.any(Object), allDay: true });
    });
});
