import type { PortfolioSlice, CoreSlice } from './types';
import {
    hasPortfolioBackup,
    loadPortfolioBackup,
    loadPortfolio as loadPortfolioApi,
    restorePortfolioBackup,
    savePortfolio as savePortfolioApi,
} from '../../lib/tauri';
import { assertPortfolioIntegrity, decodePortfolioValue, preparePortfolioForPersistence } from '../../lib/portfolioCodec';
import { formatError } from '../../lib/errorUtils';
import { toast } from 'sonner';
import type { AssetCategory, Portfolio } from '../../types';
import { createEmptyPortfolioPluginState } from '../../plugins/portfolioData';
import { useProcessSessionStore } from '../useProcessSessionStore';
import { CURRENT_PORTFOLIO_SCHEMA_VERSION } from '../../lib/import/migrate';

const DEFAULT_CATEGORIES: AssetCategory[] = [
    { id: 'start', label: 'Start / End', icon: 'Circle', color: 'gray', baseType: 'process' },
    { id: 'computers', label: 'Computers', icon: 'Laptop', color: 'blue', baseType: 'hardware' },
    { id: 'printers', label: 'Printers', icon: 'Printer', color: 'gray', baseType: 'hardware' },
    { id: 'vr-ar', label: 'VR / AR', icon: 'Glasses', color: 'purple', baseType: 'hardware' },
    { id: 'office', label: 'Office Peripherals', icon: 'Keyboard', color: 'gray', baseType: 'hardware' },
    { id: 'medical', label: 'Medical Devices', icon: 'HeartPulse', color: 'red', baseType: 'hardware' },
    { id: 'hardware', label: 'Other Hardware', icon: 'Box', color: 'gray', baseType: 'hardware' },
    { id: 'servers', label: 'Servers & Infra', icon: 'Server', color: 'amber', baseType: 'system' },
    { id: 'systems', label: 'Systems', icon: 'Database', color: 'blue', baseType: 'system' },
    { id: 'services', label: 'Services', icon: 'Cloud', color: 'green', baseType: 'system' },
    { id: 'roles', label: 'Roles', icon: 'User', color: 'green', baseType: 'role' },
    { id: 'documents', label: 'Documents', icon: 'FileText', color: 'blue', baseType: 'document' },
];

export const emptyPortfolio: Portfolio = {
    schemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
    version: '1.0',
    lastModified: new Date().toISOString(),
    processes: [],
    processFolders: [],
    assets: [],
    assetCategories: DEFAULT_CATEGORIES,
    journal: {
        notebooks: [],
        entries: [],
        tags: [],
        folders: []
    },
    incidents: [],
    plugins: createEmptyPortfolioPluginState(),
};

export const createCoreSlice: PortfolioSlice<CoreSlice> = (set, get) => ({
    portfolio: emptyPortfolio,
    isLoading: false,
    isDirty: false,
    isSaving: false,
    isRestoring: false,
    lastSavedAt: null,
    saveError: null,
    loadError: null,
    recoveryAvailable: false,
    changeRevision: 0,
    importedPortfolios: [],

    loadPortfolio: async () => {
        set({ isLoading: true, loadError: null, recoveryAvailable: false });
        try {
            const loadedPortfolio = await loadPortfolioApi();
            const decoded = decodePortfolioValue(loadedPortfolio);
            const portfolio = decoded.portfolio;
            assertPortfolioIntegrity(portfolio);

            if (!portfolio.assetCategories) {
                if (portfolio.processes.length === 0) {
                    portfolio.assetCategories = DEFAULT_CATEGORIES;
                } else {
                    portfolio.assetCategories = [];
                }
            }

            if (!portfolio.journal) {
                portfolio.journal = { notebooks: [], entries: [], tags: [], folders: [] };
            }

            if (!portfolio.processFolders) {
                portfolio.processFolders = [];
            }

            set({
                portfolio,
                isLoading: false,
                isDirty: decoded.migration.migrated,
                isSaving: false,
                lastSavedAt: portfolio.lastModified || null,
                saveError: null,
                loadError: null,
                recoveryAvailable: false,
                changeRevision: decoded.migration.migrated ? 1 : 0,
            });
            useProcessSessionStore.getState().resetForPortfolio(portfolio.processes[0]?.id || null);
            if (!decoded.integrity.valid) {
                toast.warning(`Portfolio opened with ${decoded.integrity.errors.length} reference or ID issue(s). Existing data was preserved.`);
            }
        } catch (error: any) {
            console.error('Failed to load portfolio:', error);
            const errorMessage = formatError(error);
            const recoveryAvailable = await hasPortfolioBackup().catch(() => false);
            toast.error(`Critical: Failed to load portfolio data. ${errorMessage}`);
            set({
                isLoading: false,
                loadError: errorMessage,
                recoveryAvailable,
            });
        }
    },

    recoverPortfolioBackup: async () => {
        set({ isLoading: true, loadError: null, recoveryAvailable: false });
        try {
            // Validate the recovery candidate before the backend is allowed to
            // replace the primary user file.
            const recoveryCandidate = await loadPortfolioBackup();
            const recovered = decodePortfolioValue(recoveryCandidate).portfolio;
            assertPortfolioIntegrity(recovered);
            await restorePortfolioBackup(recoveryCandidate);
            set({
                portfolio: recovered,
                importedPortfolios: [],
                isLoading: false,
                isDirty: false,
                isSaving: false,
                lastSavedAt: recovered.lastModified || null,
                saveError: null,
                loadError: null,
                recoveryAvailable: false,
                changeRevision: 0,
            });
            useProcessSessionStore.getState().resetForPortfolio(recovered.processes[0]?.id || null);
            toast.success('Recovered the last known-good portfolio');
        } catch (error) {
            const errorMessage = formatError(error);
            const recoveryAvailable = await hasPortfolioBackup().catch(() => false);
            set({
                isLoading: false,
                loadError: `Recovery failed. ${errorMessage}`,
                recoveryAvailable,
            });
            toast.error(`Recovery failed. ${errorMessage}`);
        }
    },

    savePortfolio: async () => {
        const stateAtStart = get();
        if (!stateAtStart.isDirty || stateAtStart.isSaving || stateAtStart.isRestoring || stateAtStart.isLoading || stateAtStart.loadError) return;

        const revisionAtStart = stateAtStart.changeRevision;
        const saveStartedAt = new Date().toISOString();
        set({ isSaving: true, saveError: null });

        try {
            const portfolioSnapshot = preparePortfolioForPersistence(stateAtStart.portfolio);
            assertPortfolioIntegrity(portfolioSnapshot);
            await savePortfolioApi({
                ...portfolioSnapshot,
                lastModified: saveStartedAt,
            });
            const completedAt = new Date().toISOString();
            const caughtUp = get().changeRevision === revisionAtStart;
            set((current) => ({
                isDirty: current.changeRevision === revisionAtStart ? false : current.isDirty,
                isSaving: false,
                lastSavedAt: completedAt,
                saveError: null,
            }));
            toast.success(caughtUp
                ? 'Project saved successfully'
                : 'Saved snapshot; newer changes remain unsaved');
        } catch (error: any) {
            console.error('Failed to save portfolio:', error);
            const errorMessage = formatError(error);
            set({
                isDirty: true,
                isSaving: false,
                saveError: errorMessage,
            });
            toast.error(`Failed to save project. ${errorMessage}`);
        }
    },

    markDirty: () => set((state) => ({
        isDirty: true,
        changeRevision: state.changeRevision + 1,
    })),
    markClean: () => set({ isDirty: false }),

    setPortfolio: (portfolio) => set({ portfolio, isDirty: true }),

    hydratePortfolio: (portfolio, dirty = false) => {
        // Dirty middleware treats loading as the sole clean replacement path.
        set({ isLoading: true });
        set({
            portfolio,
            importedPortfolios: [],
            isLoading: false,
            isDirty: dirty,
            isSaving: false,
            lastSavedAt: portfolio.lastModified || null,
            saveError: null,
            loadError: null,
            recoveryAvailable: false,
            changeRevision: dirty ? 1 : 0,
        });
        useProcessSessionStore.getState().resetForPortfolio(portfolio.processes[0]?.id || null);
    },

    updateCustomThemes: (themes) => set((state) => ({
        portfolio: { ...state.portfolio, customThemes: themes },
        isDirty: true
    })),

    setActiveThemeId: (id) => set((state) => ({
        portfolio: { ...state.portfolio, activeThemeId: id },
        isDirty: true
    })),
});
