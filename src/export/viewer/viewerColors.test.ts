import { describe, expect, it } from 'vitest';
import { resolveViewerColor, withViewerColorAlpha } from './viewerColors';

describe('viewer colors', () => {
    it('resolves palette ids before adding alpha', () => {
        expect(resolveViewerColor('green')).toBe('var(--palette-green, #22c55e)');
        expect(withViewerColorAlpha(resolveViewerColor('green')!, 'B3'))
            .toBe('color-mix(in srgb, var(--palette-green, #22c55e) 70%, transparent)');
    });

    it('uses color-mix for CSS variables instead of creating invalid color strings', () => {
        expect(withViewerColorAlpha(resolveViewerColor('default')!, 'B3'))
            .toBe('color-mix(in srgb, var(--color-app-active) 70%, transparent)');
    });

    it('preserves literal custom colors', () => {
        expect(resolveViewerColor('#123456')).toBe('#123456');
        expect(resolveViewerColor('oklch(70% 0.2 40)')).toBe('oklch(70% 0.2 40)');
    });
});
