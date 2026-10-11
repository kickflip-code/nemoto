import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow, useStoreApi, type OnMove, type Viewport } from 'reactflow';
import { constrainCanvasPan } from '../../lib/canvasPanBounds';

/** Render resistance without feeding it back into the gesture's raw pointer delta. */
export function useElasticCanvasPan(origin: { x: number; y: number }, save: (viewport: Viewport) => void, scope: string) {
    const store = useStoreApi();
    const flow = useReactFlow();
    const frame = useRef<number | null>(null);
    const springUpdate = useRef(false);
    const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const current = useRef({ origin, save, flow });
    current.current = { origin, save, flow };
    const cancel = useCallback(() => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        if (settleTimer.current !== null) clearTimeout(settleTimer.current);
        settleTimer.current = null;
    }, []);
    useEffect(() => { cancel(); return cancel; }, [cancel, scope]);
    const onMove: OnMove = useCallback((event, viewport) => {
        // d3 may retain the last input event during a programmatic transform.
        if (springUpdate.current) return;
        // Toolbar zoom and Fit View are intentional framing operations.
        if (!event) { cancel(); return; }
        cancel();
        const display = constrainCanvasPan(viewport, current.current.origin, true);
        store.setState({ transform: [display.x, display.y, display.zoom] });
    }, [cancel, store]);
    const onMoveEnd: OnMove = useCallback((event) => {
        cancel();
        const { flow, origin, save } = current.current;
        const update = (viewport: Viewport) => {
            springUpdate.current = true;
            try {
                // React Flow 11 setViewport schedules even zero-duration transitions.
                // Apply synchronously so a spring update cannot cancel its own next frame.
                const { d3Zoom, d3Selection } = store.getState();
                if (d3Zoom && d3Selection) {
                    const transform = d3Selection.property('__zoom');
                    d3Zoom.transform(d3Selection, transform.translate((viewport.x - transform.x) / transform.k,
                        (viewport.y - transform.y) / transform.k).scale(viewport.zoom / transform.k));
                } else current.current.flow.setViewport(viewport);
            } finally { springUpdate.current = false; }
        };
        const from = flow.getViewport();
        const to = event ? constrainCanvasPan(from, origin) : from;
        if (from.x === to.x && from.y === to.y) { save(to); return; }
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reducedMotion) { update(to); save(to); return; }
        // Synchronize the gesture engine before returning from its displayed overscroll.
        update(from);
        const start = performance.now();
        const finish = () => { cancel(); update(to); current.current.save(to); };
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / 320);
            const remaining = (1 - t) ** 3;
            update({ ...to, x: to.x + (from.x - to.x) * remaining, y: to.y + (from.y - to.y) * remaining });
            if (t < 1) frame.current = requestAnimationFrame(tick);
            else finish();
        };
        frame.current = requestAnimationFrame(tick);
        // Hidden WebViews can suspend animation frames; never persist overscroll.
        settleTimer.current = setTimeout(finish, 360);
    }, [cancel, store]);
    return { onMoveStart: cancel, onMove, onMoveEnd };
}
