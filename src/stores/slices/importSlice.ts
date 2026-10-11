import type { PortfolioSlice, ImportSlice } from './types';
import { importProcessLogic, importAssetLogic, importAssetCategoryLogic, importNotebookLogic, importJournalTagLogic, importJournalEntryLogic, mergeImportedPortfolioLogic } from '../actions/importActions';
import { useCanvasStore } from '../useCanvasStore';
import { preparePluginImport, commitPluginImport } from '../actions/preparedPluginImport';

export const createImportSlice: PortfolioSlice<ImportSlice> = (set, get) => ({
    preparePluginImport: (source) => preparePluginImport(get().portfolio, source, get().changeRevision),
    commitPluginImport: (plan) => {
        set(state => {
            const source = state.importedPortfolios.find(item => item.id === plan.sourceId);
            if (!source) throw new Error('Import source was removed. Review the import again.');
            return { portfolio: commitPluginImport(plan, state.portfolio, source, state.changeRevision),
                importedPortfolios: state.importedPortfolios.filter(item => item.id !== plan.sourceId) };
        });
        useCanvasStore.getState().setPreviewGraph(null);
    },
    addImportedPortfolio: (imported) => set((state) => ({
        importedPortfolios: [...state.importedPortfolios, imported]
    })),

    removeImportedPortfolio: (id) => {
        useCanvasStore.getState().setPreviewGraph(null);
        set((state) => ({
            importedPortfolios: state.importedPortfolios.filter(p => p.id !== id)
        }));
    },

    importProcess: (process, source) => {
        let result = { processId: '', nodeMap: new Map<string, string>() };
        set((state) => {
            const importResult = importProcessLogic(state.portfolio, process, source);
            result = importResult.result;
            return {
                portfolio: importResult.portfolio,
            };
        });
        return result;
    },

    importAsset: (asset) => {
        let newAssetId = '';
        set((state) => {
            const result = importAssetLogic(state.portfolio, asset);
            newAssetId = result.newAssetId;
            return {
                portfolio: result.portfolio,
            };
        });
        return newAssetId;
    },

    importAssetCategory: (category) => set((state) => ({
        portfolio: importAssetCategoryLogic(state.portfolio, category),
    })),

    importNotebook: (notebook) => set((state) => ({
        portfolio: importNotebookLogic(state.portfolio, notebook),
    })),

    importJournalTag: (tag) => {
        let newTagId = '';
        set((state) => {
            const result = importJournalTagLogic(state.portfolio, tag);
            newTagId = result.newTagId;
            return {
                portfolio: result.portfolio,
            };
        });
        return newTagId;
    },

    importJournalEntry: (entry, source) => set((state) => ({
        portfolio: importJournalEntryLogic(state.portfolio, entry, source),
    })),

    mergeImportedPortfolio: (source) => {
        let mergedItemCount = 0;
        set((state) => {
            const result = mergeImportedPortfolioLogic(state.portfolio, source);
            if (result.pluginReview.length) throw new Error('Plugin data requires an import preview. Use Merge content and review the mapping.');
            mergedItemCount = result.mergedItemCount;
            return {
                portfolio: result.portfolio,
                importedPortfolios: state.importedPortfolios.filter(item => item.id !== source.id),
            };
        });
        useCanvasStore.getState().setPreviewGraph(null);
        return { mergedItemCount };
    },
});
