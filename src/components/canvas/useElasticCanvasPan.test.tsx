import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useElasticCanvasPan } from './useElasticCanvasPan';
import { canvasPanOrigin, constrainCanvasPan } from '../../lib/canvasPanBounds';

const state = vi.hoisted(() => ({ viewport: { x: 0, y: 0, zoom: 1 } }));
vi.mock('reactflow', () => ({
    useStoreApi: () => ({ getState: () => ({}), setState: ({ transform }: { transform: number[] }) => {
        state.viewport = { x: transform[0], y: transform[1], zoom: transform[2] };
    } }),
    useReactFlow: () => ({ getViewport: () => state.viewport, setViewport: (viewport: typeof state.viewport) => { state.viewport = viewport; } }),
}));

describe('elastic canvas navigation', () => {
    beforeEach(() => { vi.useFakeTimers(); state.viewport = { x: 0, y: 0, zoom: 1 }; });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
    it('preserves free movement and resists only the axis crossing the origin', () => {
        const result = constrainCanvasPan({ x: -200, y: 500, zoom: 1 }, { x: 0, y: -48 }, true);
        expect(result.x).toBe(-200);
        expect(result.y).toBeGreaterThan(64);
        expect(result.y).toBeLessThan(144);
        expect(constrainCanvasPan(result, { x: 0, y: -48 })).toEqual({ x: -200, y: 64, zoom: 1 });
    });
    it('keeps headers and legacy negative coordinates accessible at different zooms', () => {
        const origin = canvasPanOrigin({ nodes: [{ id: 'a', label: '', type: 'action', position: { x: -120, y: -90 } }], edges: [], swimlanes: [] });
        expect(origin).toEqual({ x: -120, y: -90 });
        expect(constrainCanvasPan({ x: 900, y: 900, zoom: 2 }, origin)).toEqual({ x: 256, y: 196, zoom: 2 });
        expect(canvasPanOrigin({ nodes: [], edges: [], swimlanes: [{ id: 'c', axis: 'column', label: '', color: 'gray', order: 0, height: 300 }], division: { version: 1, columnsVisible: true, rowsVisible: false } }).y).toBe(-48);
    });
    it('renders resistance then returns smoothly and saves only the final viewport', () => {
        const save = vi.fn();
        const { result } = renderHook(() => useElasticCanvasPan({ x: 0, y: -48 }, save, 'a'));
        act(() => result.current.onMove(new MouseEvent('mousemove'), { x: 900, y: -30, zoom: 1 }));
        const stretched = state.viewport.x;
        expect(stretched).toBeGreaterThan(16); expect(stretched).toBeLessThan(96);
        act(() => result.current.onMoveEnd(new MouseEvent('mouseup'), state.viewport));
        act(() => vi.advanceTimersByTime(160));
        expect(state.viewport.x).toBeGreaterThan(16); expect(state.viewport.x).toBeLessThan(stretched);
        expect(save).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(200));
        expect(save).toHaveBeenCalledExactlyOnceWith({ x: 16, y: -30, zoom: 1 });
    });
    it('cancels spring animation when navigation changes', () => {
        const save = vi.fn();
        const { result, rerender } = renderHook(({ scope }) => useElasticCanvasPan({ x: 0, y: 0 }, save, scope), { initialProps: { scope: 'a' } });
        act(() => result.current.onMove(new WheelEvent('wheel'), { x: 500, y: 500, zoom: 1 }));
        act(() => result.current.onMoveEnd(new WheelEvent('wheel'), state.viewport));
        rerender({ scope: 'b' });
        act(() => vi.advanceTimersByTime(500));
        expect(save).not.toHaveBeenCalled();
    });
    it('respects reduced motion and leaves programmatic Fit View alone', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        const save = vi.fn();
        const { result } = renderHook(() => useElasticCanvasPan({ x: 0, y: 0 }, save, 'a'));
        state.viewport = { x: 500, y: 500, zoom: 0.5 };
        act(() => result.current.onMove(null as unknown as MouseEvent, state.viewport));
        expect(state.viewport.x).toBe(500);
        act(() => result.current.onMoveEnd(new MouseEvent('mouseup'), state.viewport));
        expect(state.viewport).toEqual({ x: 16, y: 16, zoom: 0.5 });
        expect(save).toHaveBeenCalledOnce();
    });
});
