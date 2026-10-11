import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '../../types';

const tauriMocks = vi.hoisted(() => ({
    hasPortfolioBackup: vi.fn(),
    loadPortfolio: vi.fn(),
    loadPortfolioBackup: vi.fn(),
    restorePortfolioBackup: vi.fn(),
    savePortfolio: vi.fn(),
}));

vi.mock('../../lib/tauri', () => tauriMocks);
vi.mock('sonner', () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
    },
}));

import { emptyPortfolio } from './coreSlice';
import { usePortfolioStore } from '../usePortfolioStore';

const makePortfolio = (): Portfolio => structuredClone(emptyPortfolio);

describe('portfolio startup recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePortfolioStore.setState({
            portfolio: makePortfolio(),
            importedPortfolios: [],
            isLoading: false,
            isDirty: false,
            isSaving: false,
            isRestoring: false,
            lastSavedAt: null,
            saveError: null,
            loadError: null,
            recoveryAvailable: false,
            changeRevision: 0,
        });
    });

    it('keeps the in-memory portfolio untouched when startup loading fails', async () => {
        const existingPortfolio = makePortfolio();
        existingPortfolio.extensions = { 'test.marker': { preserved: true } };
        usePortfolioStore.setState({ portfolio: existingPortfolio });
        tauriMocks.loadPortfolio.mockRejectedValue(new Error('portfolio.json is corrupt'));
        tauriMocks.hasPortfolioBackup.mockResolvedValue(true);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await usePortfolioStore.getState().loadPortfolio();

        const state = usePortfolioStore.getState();
        expect(state.portfolio).toBe(existingPortfolio);
        expect(state.isLoading).toBe(false);
        expect(state.loadError).toBe('portfolio.json is corrupt');
        expect(state.recoveryAvailable).toBe(true);
    });

    it('does not replace the primary file when the backup fails frontend validation', async () => {
        const existingPortfolio = makePortfolio();
        usePortfolioStore.setState({ portfolio: existingPortfolio, loadError: 'Primary file is corrupt' });
        tauriMocks.loadPortfolioBackup.mockResolvedValue('not a portfolio');
        tauriMocks.hasPortfolioBackup.mockResolvedValue(true);

        await usePortfolioStore.getState().recoverPortfolioBackup();

        const state = usePortfolioStore.getState();
        expect(tauriMocks.restorePortfolioBackup).not.toHaveBeenCalled();
        expect(state.portfolio).toBe(existingPortfolio);
        expect(state.loadError).toMatch(/^Recovery failed\./);
        expect(state.recoveryAvailable).toBe(true);
    });

    it('promotes a validated backup and leaves the recovered portfolio clean', async () => {
        const candidate = makePortfolio();
        candidate.extensions = { 'test.recovery': { restored: true } };
        tauriMocks.loadPortfolioBackup.mockResolvedValue(candidate);
        tauriMocks.restorePortfolioBackup.mockResolvedValue(candidate);

        await usePortfolioStore.getState().recoverPortfolioBackup();

        const state = usePortfolioStore.getState();
        expect(tauriMocks.restorePortfolioBackup).toHaveBeenCalledWith(candidate);
        expect(state.portfolio.extensions).toEqual(candidate.extensions);
        expect(state.isDirty).toBe(false);
        expect(state.loadError).toBeNull();
        expect(state.recoveryAvailable).toBe(false);
    });

    it('reports integrity validation failures through the normal save error state', async () => {
        const invalid = makePortfolio();
        invalid.assets = [
            { id: 'duplicate', name: 'One', type: 'systems' },
            { id: 'duplicate', name: 'Two', type: 'systems' },
        ];
        usePortfolioStore.setState({ portfolio: invalid, isDirty: true });

        await usePortfolioStore.getState().savePortfolio();

        expect(tauriMocks.savePortfolio).not.toHaveBeenCalled();
        expect(usePortfolioStore.getState().isSaving).toBe(false);
        expect(usePortfolioStore.getState().isDirty).toBe(true);
        expect(usePortfolioStore.getState().saveError).toMatch(/reference or ID error/i);
    });

    it('keeps a portfolio with hard integrity errors in startup safe mode', async () => {
        const invalid = makePortfolio();
        invalid.assets = [
            { id: 'duplicate', name: 'One', type: 'systems' },
            { id: 'duplicate', name: 'Two', type: 'systems' },
        ];
        tauriMocks.loadPortfolio.mockResolvedValue(invalid);
        tauriMocks.hasPortfolioBackup.mockResolvedValue(false);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await usePortfolioStore.getState().loadPortfolio();

        expect(usePortfolioStore.getState().loadError).toMatch(/reference or ID error/i);
        expect(usePortfolioStore.getState().isLoading).toBe(false);
    });

    it('blocks direct saves of in-memory data while startup recovery is active', async () => {
        usePortfolioStore.setState({ isDirty: true, loadError: 'Rejected process data' });
        await usePortfolioStore.getState().savePortfolio();
        expect(tauriMocks.savePortfolio).not.toHaveBeenCalled();
        expect(usePortfolioStore.getState().isDirty).toBe(true);
    });
});
