import type { PortfolioSlice, AssetSlice } from './types';
import { setAssetsLogic, addAssetLogic, importResourcesLogic, updateAssetLogic, purgeAssetLogic, deleteAssetsLogic, duplicateAssetLogic, addAssetCategoryLogic, updateAssetCategoryLogic, deleteAssetCategoryLogic } from '../actions/assetActions';

export const createAssetSlice: PortfolioSlice<AssetSlice> = (set, get) => ({
    setAssets: (assets) => set((state) => ({
        portfolio: setAssetsLogic(state.portfolio, assets),
    })),
    addAsset: (asset) => set((state) => ({
        portfolio: addAssetLogic(state.portfolio, asset),
    })),
    importResources: (resources) => set((state) => ({
        portfolio: importResourcesLogic(state.portfolio, resources),
    })),
    updateAsset: (id, updates) => set((state) => ({
        portfolio: updateAssetLogic(state.portfolio, id, updates),
    })),
    purgeAsset: (id) => set((state) => ({
        portfolio: purgeAssetLogic(state.portfolio, id),
    })),
    deleteAsset: (id) => get().deleteAssets([id]),
    deleteAssets: (ids) => set((state) => ({
        portfolio: deleteAssetsLogic(state.portfolio, ids),
    })),
    duplicateAsset: (id) => set((state) => ({
        portfolio: duplicateAssetLogic(state.portfolio, id),
    })),

    addAssetCategory: (category) => set((state) => ({
        portfolio: addAssetCategoryLogic(state.portfolio, category),
    })),
    updateAssetCategory: (id, updates) => set((state) => ({
        portfolio: updateAssetCategoryLogic(state.portfolio, id, updates),
    })),
    deleteAssetCategory: (id) => set((state) => ({
        portfolio: deleteAssetCategoryLogic(state.portfolio, id),
    })),
});
