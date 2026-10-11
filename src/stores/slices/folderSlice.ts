import type { PortfolioSlice, FolderSlice } from './types';
import { addFolderLogic, updateFolderLogic, deleteFolderLogic, moveItemLogic } from '../actions/folderActions';

export const createFolderSlice: PortfolioSlice<FolderSlice> = (set) => ({
    addFolder: (title, parentId) => set((state) => ({
        portfolio: addFolderLogic(state.portfolio, title, parentId),
    })),

    updateFolder: (id, updates) => set((state) => ({
        portfolio: updateFolderLogic(state.portfolio, id, updates),
    })),

    deleteFolder: (id) => set((state) => ({
        portfolio: deleteFolderLogic(state.portfolio, id),
    })),

    moveItem: (itemId, itemType, targetFolderId) => set((state) => {
        const updatedPortfolio = moveItemLogic(state.portfolio, itemId, itemType, targetFolderId);
        if (updatedPortfolio !== state.portfolio) {
            return { portfolio: updatedPortfolio };
        }
        return {};
    }),
});
