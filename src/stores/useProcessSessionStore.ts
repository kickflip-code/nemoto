import { create } from 'zustand';

interface ProcessSessionState {
    portfolioGeneration: number;
    activeProcessId: string | null;
    breadcrumbStack: string[];
    setActiveProcess: (id: string | null) => void;
    pushBreadcrumb: (nodeId: string) => void;
    popBreadcrumb: () => void;
    setBreadcrumbStack: (stack: string[]) => void;
    resetBreadcrumb: () => void;
    resetForPortfolio: (firstProcessId: string | null) => void;
}

/**
 * Ephemeral navigation state for the currently open process.
 * This state is intentionally excluded from persisted portfolio data.
 */
export const useProcessSessionStore = create<ProcessSessionState>((set) => ({
    portfolioGeneration: 0,
    activeProcessId: null,
    breadcrumbStack: [],
    setActiveProcess: (id) => set({ activeProcessId: id, breadcrumbStack: [] }),
    pushBreadcrumb: (nodeId) => set((state) => ({
        breadcrumbStack: [...state.breadcrumbStack, nodeId],
    })),
    popBreadcrumb: () => set((state) => ({
        breadcrumbStack: state.breadcrumbStack.slice(0, -1),
    })),
    setBreadcrumbStack: (stack) => set({ breadcrumbStack: [...stack] }),
    resetBreadcrumb: () => set({ breadcrumbStack: [] }),
    resetForPortfolio: (firstProcessId) => set(state => ({
        activeProcessId: firstProcessId,
        breadcrumbStack: [],
        portfolioGeneration: state.portfolioGeneration + 1,
    })),
}));
