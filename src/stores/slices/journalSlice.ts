import { PortfolioSlice, JournalSlice } from './types';
import {
    createJournalFolderLogic,
    deleteJournalFolderLogic,
    moveJournalItemLogic,
    renameJournalItemLogic,
    createNotebookLogic,
    deleteNotebookLogic,
    createEntryLogic,
    updateEntryLogic,
    deleteEntryLogic,
    createTagLogic,
    deleteTagLogic,
    purgeTagLogic,
    linkContextLogic,
    unlinkContextLogic,
    moveEntryLogic
} from '../actions/journalActions';

export const createJournalSlice: PortfolioSlice<JournalSlice> = (set) => ({
    createJournalFolder: (title, parentId) => {
        let newId = '';
        set((state) => {
            const { portfolio, newFolderId } = createJournalFolderLogic(state.portfolio, title, parentId);
            newId = newFolderId;
            return { portfolio };
        });
        return newId;
    },

    deleteJournalFolder: (id) => set((state) => ({
        portfolio: deleteJournalFolderLogic(state.portfolio, id)
    })),

    moveJournalItem: (itemId, itemType, targetFolderId) => set((state) => ({
        portfolio: moveJournalItemLogic(state.portfolio, itemId, itemType, targetFolderId)
    })),

    renameJournalItem: (itemId, itemType, newTitle) => set((state) => ({
        portfolio: renameJournalItemLogic(state.portfolio, itemId, itemType, newTitle)
    })),

    createNotebook: (title, folderId) => {
        let newId = '';
        set((state) => {
            const { portfolio, newNotebookId } = createNotebookLogic(state.portfolio, title, folderId);
            newId = newNotebookId;
            return { portfolio };
        });
        return newId;
    },

    deleteNotebook: (id) => set((state) => ({
        portfolio: deleteNotebookLogic(state.portfolio, id)
    })),

    createEntry: (notebookId, title) => {
        let newId = '';
        set((state) => {
            const { portfolio, newEntryId } = createEntryLogic(state.portfolio, notebookId, title);
            newId = newEntryId;
            return { portfolio };
        });
        return newId;
    },

    updateEntry: (id, updates) => set((state) => ({
        portfolio: updateEntryLogic(state.portfolio, id, updates)
    })),

    deleteEntry: (id) => set((state) => ({
        portfolio: deleteEntryLogic(state.portfolio, id)
    })),

    moveEntry: (entryId, targetNotebookId) => set((state) => ({
        portfolio: moveEntryLogic(state.portfolio, entryId, targetNotebookId)
    })),

    createTag: (label, color) => set((state) => ({
        portfolio: createTagLogic(state.portfolio, label, color)
    })),

    deleteTag: (id) => set((state) => ({
        portfolio: deleteTagLogic(state.portfolio, id)
    })),

    purgeTag: (id) => set((state) => ({
        portfolio: purgeTagLogic(state.portfolio, id)
    })),

    linkContext: (entryId, entityRef) => set((state) => ({
        portfolio: linkContextLogic(state.portfolio, entryId, entityRef)
    })),

    unlinkContext: (entryId, entityId) => set((state) => ({
        portfolio: unlinkContextLogic(state.portfolio, entryId, entityId)
    }))
});
