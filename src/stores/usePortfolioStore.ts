import { create } from 'zustand';
import { withDirtyTracking } from './middleware/dirtyMiddleware';
import type { PortfolioStore } from './slices/types';

import { createCoreSlice } from './slices/coreSlice';
import { createProcessSlice } from './slices/processSlice';
import { createFolderSlice } from './slices/folderSlice';
import { createAssetSlice } from './slices/assetSlice';
import { createIncidentSlice } from './slices/incidentSlice';
import { createImportSlice } from './slices/importSlice';
import { createJournalSlice } from './slices/journalSlice';

export type PortfolioState = PortfolioStore;

export const usePortfolioStore = create<PortfolioStore>()(withDirtyTracking((...a) => ({
    ...createCoreSlice(...a),
    ...createProcessSlice(...a),
    ...createFolderSlice(...a),
    ...createAssetSlice(...a),
    ...createIncidentSlice(...a),
    ...createImportSlice(...a),
    ...createJournalSlice(...a),
})));
