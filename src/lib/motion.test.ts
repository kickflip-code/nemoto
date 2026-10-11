import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMotionDurationMs, motionDuration, motionDurationMs } from './motion';

describe('motion system', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps CSS/Framer timings on the same scale', () => {
        expect(motionDuration.fast * 1000).toBe(motionDurationMs.fast);
        expect(motionDuration.base * 1000).toBe(motionDurationMs.base);
        expect(motionDuration.slow * 1000).toBe(motionDurationMs.slow);
    });

    it('removes camera motion when the user prefers reduced motion', () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));

        expect(getMotionDurationMs(motionDurationMs.camera)).toBe(0);
    });

    it('keeps camera motion when reduced motion is not requested', () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));

        expect(getMotionDurationMs(motionDurationMs.camera)).toBe(motionDurationMs.camera);
    });

    it('falls back safely when matchMedia is unavailable', () => {
        vi.stubGlobal('matchMedia', undefined);

        expect(getMotionDurationMs(motionDurationMs.camera)).toBe(motionDurationMs.camera);
    });
});
