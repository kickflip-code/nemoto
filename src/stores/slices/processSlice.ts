import type { PortfolioSlice, ProcessSlice } from './types';
import { addProcessLogic, updateProcessLogic, deleteProcessLogic, duplicateProcessLogic, updateProcessGraphLogic, convertProcessLogic } from '../actions/processActions';
import { useCanvasStore } from '../useCanvasStore';
import { useProcessSessionStore } from '../useProcessSessionStore';

export const createProcessSlice: PortfolioSlice<ProcessSlice> = (set) => ({
    addProcess: (process) => {
        set((state) => ({ portfolio: addProcessLogic(state.portfolio, process) }));
        useProcessSessionStore.getState().setActiveProcess(process.id);
    },

    updateProcess: (id, updates) => set((state) => ({
        portfolio: updateProcessLogic(state.portfolio, id, updates),
    })),

    convertProcess: (id, newMode, subprocessId) => set((state) => {
        const session = useProcessSessionStore.getState();
        const result = convertProcessLogic(state.portfolio, id, newMode, subprocessId, session.activeProcessId, session.breadcrumbStack);
        if (!result) return state;

        if (result.syncGraph) {
            useCanvasStore.getState().loadGraph(result.syncGraph);
        }

        return {
            portfolio: result.portfolio,
        };
    }),

    deleteProcess: (ids, deleteOrphanedAssets) => {
        const session = useProcessSessionStore.getState();
        let nextActiveProcessId = session.activeProcessId;
        set((state) => {
            const result = deleteProcessLogic(state.portfolio, ids, session.activeProcessId, deleteOrphanedAssets);
            nextActiveProcessId = result.activeProcessId;
            return { portfolio: result.portfolio };
        });
        if (nextActiveProcessId !== session.activeProcessId) {
            useProcessSessionStore.getState().setActiveProcess(nextActiveProcessId);
        }
    },

    duplicateProcess: (id) => set((state) => ({
        portfolio: duplicateProcessLogic(state.portfolio, id),
    })),

    updateProcessGraph: (processId, graph, copiedGraphs) => set((state) => ({
        portfolio: updateProcessGraphLogic(
            copiedGraphs ? {
                ...state.portfolio,
                processes: state.portfolio.processes.map(process => {
                    if (process.id !== processId) return process;
                    const subGraphs = { ...process.subGraphs, ...copiedGraphs.add };
                    copiedGraphs.remove.forEach(id => delete subGraphs[id]);
                    return { ...process, subGraphs };
                }),
            } : state.portfolio,
            processId,
            graph,
            useProcessSessionStore.getState().breadcrumbStack,
        ),
    })),
});
