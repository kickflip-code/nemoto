import { useEffect, useRef } from 'react';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { canvasLocationMatchesSession } from '../stores/canvasLocation';
import { getConfig } from '../lib/tauri';
import { useShallow } from 'zustand/react/shallow';

export function useAutoSave() {
    const { savePortfolio, updateProcessGraph } = usePortfolioStore(
        useShallow((state) => ({
            savePortfolio: state.savePortfolio,
            updateProcessGraph: state.updateProcessGraph,
        }))
    );

    // Ref to access latest savePortfolio without restarting interval
    const savePortfolioRef = useRef(savePortfolio);
    useEffect(() => {
        savePortfolioRef.current = savePortfolio;
    }, [savePortfolio]);

    // Guard: suppress auto-save while a native HTML5 drag is in flight.
    // A save mid-drag can trigger React re-renders that invalidate the drag
    // source node reference in Chromium/Windows, producing a forbidden cursor.
    const isDraggingRef = useRef(false);
    useEffect(() => {
        const onDragStart = () => { isDraggingRef.current = true; };
        const onDragEnd = () => { isDraggingRef.current = false; };
        document.addEventListener('dragstart', onDragStart, true);
        document.addEventListener('dragend', onDragEnd, true);
        return () => {
            document.removeEventListener('dragstart', onDragStart, true);
            document.removeEventListener('dragend', onDragEnd, true);
        };
    }, []);

    // 1. Subscribe to Canvas Changes: mark dirty AND sync graph to process
    useEffect(() => {
        const unsub = useCanvasStore.subscribe((state, prevState) => {
            // Loading or navigating establishes a new clean canvas session. It is
            // never an edit and must not be written into the destination process.
            if (state.graphLoadRevision !== prevState.graphLoadRevision) return;
            // Navigation may change its destination before the React effect loads
            // that canvas. Never project the old graph (even a viewport write)
            // into the new process/path or a newly restored Portfolio.
            if (state.previewGraph || !canvasLocationMatchesSession(
                state.loadedLocation, useProcessSessionStore.getState(),
            )) return;

            const graphChanged = state.graph !== prevState.graph;
            const viewportChanged = state.viewport !== prevState.viewport;

            if (graphChanged || viewportChanged) {
                // Sync canvas graph to active process, including viewport
                const processId = useProcessSessionStore.getState().activeProcessId;
                if (processId) {
                    const graphWithViewport = {
                        ...state.graph,
                        viewport: state.viewport,
                    };
                    if (state.copiedSubGraphs !== prevState.copiedSubGraphs) {
                        updateProcessGraph(processId, graphWithViewport, {
                            add: state.copiedSubGraphs,
                            remove: Object.keys(prevState.copiedSubGraphs).filter(id => !state.copiedSubGraphs[id]),
                        });
                    } else {
                        updateProcessGraph(processId, graphWithViewport);
                    }
                }
            }
        });
        return unsub;
    }, [updateProcessGraph]);

    // 2. Auto-Save Interval
    useEffect(() => {
        let intervalId: number | null = null;

        const initAutoSave = async () => {
            try {
                const config = await getConfig();
                const intervalSeconds = config.autoSaveInterval;

                if (!intervalSeconds || intervalSeconds <= 0) return;

                intervalId = window.setInterval(async () => {
                    // Skip the save tick while a DnD drag is in flight to avoid
                    // re-renders that invalidate the drag source on Windows.
                    if (isDraggingRef.current) return;

                    const { isDirty } = usePortfolioStore.getState();
                    if (isDirty) {
                        await savePortfolioRef.current();
                    }
                }, intervalSeconds * 1000);
            } catch (e) {
                console.warn('Could not load auto-save config', e);
            }
        };

        initAutoSave();

        return () => {
            if (intervalId) window.clearInterval(intervalId);
        };
    }, []);
}
