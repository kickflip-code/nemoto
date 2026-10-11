import { describe, expect, it } from 'vitest';
import { createPluginTextBuffer } from './pluginTextBuffer';

describe('instance-owned report preparation', () => {
    it('assembles pages across the 64 KiB guest-state boundary without touching storage', () => {
        const buffer = createPluginTextBuffer(); buffer.reset(7);
        const fragment = 'å'.repeat(32 * 1024);
        expect(buffer.append(fragment, 7)).toBe(64 * 1024);
        expect(buffer.append(fragment, 7)).toBe(128 * 1024);
        expect(buffer.read(7)).toBe(fragment + fragment);
        expect(() => buffer.append('x', 7)).toThrow(/128 KiB/);
        expect(() => buffer.read(7)).toThrow(/stale/);
    });
    it('refuses stale data, isolates sessions and destroys prepared text on disposal', () => {
        const first = createPluginTextBuffer(); const second = createPluginTextBuffer();
        first.reset(1); first.append('First report', 1);
        expect(() => second.read(1)).toThrow();
        expect(() => first.read(2)).toThrow(/stale/);
        first.dispose(); expect(() => first.read(1)).toThrow();
        first.reset(3); expect(first.read(3)).toBe('');
    });
});
