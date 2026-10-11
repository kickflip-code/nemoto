import { beforeEach, describe, expect, it } from 'vitest';
import type { CanvasGraph, ImportedPortfolio, Portfolio } from '../../types';
import { usePortfolioStore } from '../usePortfolioStore';
import { createEmptyPluginDataEnvelope } from '../../plugins/collectionStorage';

const targetPortfolio = (): Portfolio => ({
    version: '1.0',
    lastModified: '2026-08-01T00:00:00.000Z',
    processes: [],
    processFolders: [],
    assets: [],
    assetCategories: [],
    incidents: [],
    journal: { notebooks: [], folders: [], entries: [], tags: [] },
});

const importedPortfolio = (): ImportedPortfolio => ({
    id: 'temporary-import',
    sourceName: 'temporary.axiom',
    importedAt: '2026-08-01T00:00:00.000Z',
    isReadOnly: true,
    data: {
        ...targetPortfolio(),
        assets: [{ id: 'source-asset', name: 'Imported system', type: 'systems' }],
        assetCategories: [{ id: 'systems', label: 'Systems', color: 'blue', icon: 'Database' }],
    },
});

describe('importSlice atomic merge', () => {
    it('requires review for plugin exclusions and commits one prepared candidate', () => {
        const source = importedPortfolio();
        source.data.extensions = { 'org.example.notes': { ...createEmptyPluginDataEnvelope(),
            documents: { opaque: { documentVersion: 1, value: { title: 'Preserve in source' } } } } };
        usePortfolioStore.setState({ importedPortfolios: [source] });
        expect(() => usePortfolioStore.getState().mergeImportedPortfolio(source)).toThrow(/preview/);
        const before = usePortfolioStore.getState().portfolio;
        const plan = usePortfolioStore.getState().preparePluginImport(source);
        expect(plan.rows[0].status).toBe('excluded');
        expect(usePortfolioStore.getState().portfolio).toBe(before);
        usePortfolioStore.getState().commitPluginImport(plan);
        expect(usePortfolioStore.getState().portfolio.assets).toHaveLength(1);
        expect(usePortfolioStore.getState().isDirty).toBe(true);
        expect(usePortfolioStore.getState().importedPortfolios).toHaveLength(0);
    });
    it('keeps the source and destination when the review becomes stale', () => {
        const source = usePortfolioStore.getState().importedPortfolios[0];
        const plan = usePortfolioStore.getState().preparePluginImport(source);
        usePortfolioStore.getState().markDirty();
        const before = usePortfolioStore.getState().portfolio;
        expect(() => usePortfolioStore.getState().commitPluginImport(plan)).toThrow(/stale/);
        expect(usePortfolioStore.getState().portfolio).toBe(before);
        expect(usePortfolioStore.getState().importedPortfolios).toHaveLength(1);
    });
    beforeEach(() => {
        usePortfolioStore.getState().hydratePortfolio(targetPortfolio(), false);
        usePortfolioStore.setState({ importedPortfolios: [importedPortfolio()] });
    });

    it('commits the portfolio and removes the temporary reference together', () => {
        const source = usePortfolioStore.getState().importedPortfolios[0];

        const result = usePortfolioStore.getState().mergeImportedPortfolio(source);

        expect(result.mergedItemCount).toBe(1);
        expect(usePortfolioStore.getState().portfolio.assets).toHaveLength(1);
        expect(usePortfolioStore.getState().importedPortfolios).toHaveLength(0);
        expect(usePortfolioStore.getState().isDirty).toBe(true);
    });

    it('keeps both current data and the temporary reference when preparation fails', () => {
        const source = importedPortfolio();
        source.data.processes = [{
            id: 'broken-process',
            title: 'Broken process',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            mode: 'blank',
            graph: null as unknown as CanvasGraph,
        }];
        usePortfolioStore.setState({ importedPortfolios: [source] });
        const portfolioBefore = usePortfolioStore.getState().portfolio;

        expect(() => usePortfolioStore.getState().mergeImportedPortfolio(source)).toThrow();

        expect(usePortfolioStore.getState().portfolio).toBe(portfolioBefore);
        expect(usePortfolioStore.getState().importedPortfolios).toEqual([source]);
    });
});
