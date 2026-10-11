import { create } from 'zustand';
import { usePortfolioStore } from './usePortfolioStore';
import { JournalEntry, EntityReference } from '../types/journal';

interface JournalState {
    // Selection
    selectedNotebookId: string | null;
    selectedEntryId: string | null;

    // UI State
    expandedItems: Record<string, boolean>;
    toggleExpanded: (id: string, force?: boolean) => void;

    // Actions - Selection
    selectNotebook: (id: string | null) => void;
    selectEntry: (id: string | null) => void;

    // Actions - Folders
    createFolder: (title: string, parentId?: string) => string;
    deleteFolder: (id: string) => void;
    moveItem: (itemId: string, itemType: 'notebook' | 'folder' | 'variable', targetFolderId?: string) => void;

    renameItem: (itemId: string, itemType: 'notebook' | 'folder', newTitle: string) => void;
    renameEntry: (id: string, newTitle: string) => void;

    // Actions - Data (Proxy to PortfolioStore to ensure persistence)
    createNotebook: (title: string, folderId?: string) => string; // Returns new ID
    deleteNotebook: (id: string) => void;

    createEntry: (notebookId: string, title?: string) => string; // Returns new ID
    updateEntry: (id: string, updates: Partial<JournalEntry>) => void;
    deleteEntry: (id: string) => void;

    createTag: (label: string, color: string) => void;
    deleteTag: (id: string) => void;
    purgeTag: (id: string) => void;

    linkContext: (entryId: string, entityRef: EntityReference) => void;
    unlinkContext: (entryId: string, entityId: string) => void;
    createQuickNote: () => void;
    selectMostRecentEntry: () => void;
    moveEntry: (entryId: string, targetNotebookId: string) => void;
}

export const useJournalStore = create<JournalState>((set, get) => ({
    selectedNotebookId: null,
    selectedEntryId: null,
    expandedItems: {},

    toggleExpanded: (id, force) => set((state) => ({
        expandedItems: {
            ...state.expandedItems,
            [id]: force !== undefined ? force : !state.expandedItems[id]
        }
    })),

    selectNotebook: (id) => {
        set({ selectedNotebookId: id });
        if (id) {
            set({ selectedEntryId: null });
        }
    },

    selectEntry: (id) => set({ selectedEntryId: id }),

    createFolder: (title, parentId) => {
        return usePortfolioStore.getState().createJournalFolder(title, parentId);
    },

    deleteFolder: (id) => {
        usePortfolioStore.getState().deleteJournalFolder(id);
    },

    moveItem: (itemId, itemType, targetFolderId) => {
        usePortfolioStore.getState().moveJournalItem(itemId, itemType, targetFolderId);
    },

    renameItem: (itemId, itemType, newTitle) => {
        usePortfolioStore.getState().renameJournalItem(itemId, itemType, newTitle);
    },

    createNotebook: (title, folderId) => {
        const id = usePortfolioStore.getState().createNotebook(title, folderId);
        get().selectNotebook(id);
        return id;
    },

    createQuickNote: () => {
        const { portfolio, createNotebook, createEntry } = usePortfolioStore.getState();
        let targetNotebookId: string;

        const existing = (portfolio.journal?.notebooks || []).find(n => n.title.toLowerCase() === 'quick notes');
        if (existing) {
            targetNotebookId = existing.id;
        } else {
            targetNotebookId = createNotebook('Quick Notes');
        }

        get().selectNotebook(targetNotebookId);
        const entryId = createEntry(targetNotebookId, 'Quick Note');
        get().selectEntry(entryId);
    },

    deleteNotebook: (id) => {
        usePortfolioStore.getState().deleteNotebook(id);
        if (get().selectedNotebookId === id) {
            get().selectNotebook(null);
        }
    },

    createEntry: (notebookId, title = 'Untitled Note') => {
        const id = usePortfolioStore.getState().createEntry(notebookId, title);
        get().selectEntry(id);
        return id;
    },

    updateEntry: (id, updates) => {
        usePortfolioStore.getState().updateEntry(id, updates);
    },

    renameEntry: (id: string, newTitle: string) => {
        get().updateEntry(id, { title: newTitle });
    },

    deleteEntry: (id) => {
        usePortfolioStore.getState().deleteEntry(id);
        if (get().selectedEntryId === id) {
            get().selectEntry(null);
        }
    },

    createTag: (label, color) => usePortfolioStore.getState().createTag(label, color),
    deleteTag: (id) => usePortfolioStore.getState().deleteTag(id),
    purgeTag: (id) => usePortfolioStore.getState().purgeTag(id),

    linkContext: (entryId, entityRef) => usePortfolioStore.getState().linkContext(entryId, entityRef),
    unlinkContext: (entryId, entityId) => usePortfolioStore.getState().unlinkContext(entryId, entityId),

    selectMostRecentEntry: () => {
        const { portfolio } = usePortfolioStore.getState();
        const entries = portfolio.journal?.entries || [];
        if (entries.length === 0) return;

        const sorted = [...entries].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const mostRecent = sorted[0];

        if (mostRecent) {
            get().selectNotebook(mostRecent.notebookId);
            get().selectEntry(mostRecent.id);
        }
    },

    moveEntry: (entryId, targetNotebookId) => {
        usePortfolioStore.getState().moveEntry(entryId, targetNotebookId);
        get().selectNotebook(targetNotebookId);
    }
}));
