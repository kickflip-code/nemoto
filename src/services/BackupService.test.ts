import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '../types';
import { CURRENT_PORTFOLIO_SCHEMA_VERSION } from '../lib/import/migrate';
import { createEmptyPortfolioPluginState } from '../plugins/portfolioData';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useJournalStore } from '../stores/useJournalStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createThemeConfig } from '../theme/themeFiles';

const { saveMainPortfolio, saveDialog, writeExport } = vi.hoisted(() => ({
    saveMainPortfolio: vi.fn<(value: Portfolio) => Promise<void>>(),
    saveDialog: vi.fn(),
    writeExport: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: saveDialog }));
vi.mock('../lib/tauri', () => ({
    savePortfolio: saveMainPortfolio,
    writeNemotoFileAtomic: writeExport,
}));

import { BackupService } from './BackupService';

function portfolio(id: string): Portfolio {
    return {
        schemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
        version: '1.0',
        lastModified: '2026-08-12T12:00:00.000Z',
        processes: [{
            id,
            title: id,
            createdAt: '2026-08-12T12:00:00.000Z',
            updatedAt: '2026-08-12T12:00:00.000Z',
            graph: {
                mode: 'blank',
                division: { version: 1, rowsVisible: false, columnsVisible: false },
                nodes: [{ id: `${id}-node`, type: 'action', label: 'A', position: { x: 1, y: 2 } }],
                edges: [],
                swimlanes: [],
            },
            subGraphs: {},
            mode: 'blank',
        }],
        processFolders: [],
        assets: [],
        assetCategories: [],
        incidents: [],
        journal: { notebooks: [], folders: [], entries: [], tags: [] },
        plugins: createEmptyPortfolioPluginState(),
    };
}

describe('BackupService restore', () => {
    it('exports new suffixes while retaining canonical document kinds and custom backup paths', async () => {
        usePortfolioStore.getState().hydratePortfolio(portfolio('exported'), false);
        const oldPath = useSettingsStore.getState().backupPath;
        useSettingsStore.setState({ backupPath: 'C:/AxiomBackups' });
        try {
            saveDialog.mockResolvedValueOnce('C:/AxiomBackups/full.nemoto');
            await BackupService.downloadBackup();
            expect(saveDialog).toHaveBeenLastCalledWith({
                filters: [{ name: 'Nemoto Portfolio', extensions: ['nemoto'] }],
                defaultPath: expect.stringMatching(/^C:\/AxiomBackups\/nemoto-portfolio-.*\.nemoto$/),
            });
            expect(JSON.parse(writeExport.mock.lastCall![1])).toMatchObject({ format: 'axiom', kind: 'portfolio', schemaVersion: 4 });
            saveDialog.mockResolvedValueOnce('C:/AxiomBackups/part.nemoto-process');
            await BackupService.downloadPartialExport('exported');
            expect(saveDialog).toHaveBeenLastCalledWith({
                filters: [{ name: 'Nemoto Process', extensions: ['nemoto-process'] }],
                defaultPath: expect.stringMatching(/\.nemoto-process$/),
            });
            expect(JSON.parse(writeExport.mock.lastCall![1])).toMatchObject({ format: 'axiom', kind: 'process-fragment', type: 'partial' });
        } finally {
            useSettingsStore.setState({ backupPath: oldPath });
            saveDialog.mockReset();
            writeExport.mockReset();
        }
    });

    beforeEach(() => {
        saveMainPortfolio.mockReset();
        saveMainPortfolio.mockResolvedValue(undefined);
        usePortfolioStore.getState().hydratePortfolio(portfolio('current'), false);
        useCanvasStore.getState().loadGraph(portfolio('current').processes[0].graph);
        useJournalStore.setState({ selectedNotebookId: 'old-notebook', selectedEntryId: 'old-entry' });
    });

    it('persists atomically before switching all in-memory sessions', async () => {
        const restored = portfolio('restored');
        const migration = await BackupService.restoreBackup({
            format: 'axiom',
            kind: 'portfolio',
            schemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
            version: '1.0.0',
            appVersion: '0.13.1',
            timestamp: '2026-08-12T12:00:00.000Z',
            data: restored,
        });

        expect(saveMainPortfolio).toHaveBeenCalledOnce();
        expect(useProcessSessionStore.getState()).toMatchObject({
            activeProcessId: 'restored',
            breadcrumbStack: [],
        });
        expect(usePortfolioStore.getState().isDirty).toBe(false);
        expect(usePortfolioStore.getState().portfolio.processes[0].id).toBe('restored');
        expect(useCanvasStore.getState().graph.nodes[0].id).toBe('restored-node');
        expect(useJournalStore.getState()).toMatchObject({
            selectedNotebookId: null,
            selectedEntryId: null,
        });
        expect(migration.migrated).toBe(false);
    });

    it('waits for an older save, preserves newer edits, and excludes competing saves', async () => {
        let disk = portfolio('previous');
        let backup = disk;
        let finishOlderSave!: () => void;
        let finishPreservation!: () => void;
        saveMainPortfolio.mockImplementationOnce(async value => {
            await new Promise<void>(resolve => { finishOlderSave = resolve; });
            backup = disk;
            disk = value;
        }).mockImplementationOnce(async value => {
            await new Promise<void>(resolve => { finishPreservation = resolve; });
            backup = disk;
            disk = value;
        }).mockImplementation(async value => {
            backup = disk;
            disk = value;
        });
        usePortfolioStore.getState().setPortfolio(portfolio('older-edit'));
        const olderSave = usePortfolioStore.getState().savePortfolio();
        usePortfolioStore.getState().setPortfolio(portfolio('newer-edit'));
        const restore = BackupService.restoreBackup(portfolio('restored'));
        expect(usePortfolioStore.getState().isRestoring).toBe(true);
        expect(saveMainPortfolio).toHaveBeenCalledTimes(1);
        await expect(BackupService.restoreBackup(portfolio('second-restore'))).rejects.toThrow('already in progress');
        finishOlderSave();
        await olderSave;
        // Preservation is pending; manual/automatic saves share this entry point.
        await usePortfolioStore.getState().savePortfolio();
        expect(saveMainPortfolio).toHaveBeenCalledTimes(2);
        finishPreservation();
        await restore;
        expect(backup.processes[0].id).toBe('newer-edit');
        expect(disk.processes[0].id).toBe('restored');
        expect(usePortfolioStore.getState()).toMatchObject({ isDirty: false, isRestoring: false, isSaving: false });
        expect(usePortfolioStore.getState().portfolio).toEqual(disk);
    });

    it.each([1, 2])('keeps dirty work open if restore write phase %s fails', async phase => {
        usePortfolioStore.getState().setPortfolio(portfolio('unsaved'));
        let disk = portfolio('previous');
        saveMainPortfolio.mockImplementation(async value => {
            if (saveMainPortfolio.mock.calls.length === phase) throw new Error('disk full');
            disk = value;
        });
        await expect(BackupService.restoreBackup(portfolio('restored'))).rejects.toThrow('disk full');
        expect(disk.processes[0].id).toBe(phase === 1 ? 'previous' : 'unsaved');
        expect(usePortfolioStore.getState().portfolio.processes[0].id).toBe('unsaved');
        expect(usePortfolioStore.getState()).toMatchObject({ isDirty: true, isRestoring: false });
        expect(useJournalStore.getState().selectedEntryId).toBe('old-entry');
    });

    it.each([1, 2])('does not hydrate over edits arriving during write phase %s', async phase => {
        usePortfolioStore.getState().setPortfolio(portfolio('unsaved'));
        saveMainPortfolio.mockImplementation(async () => {
            if (saveMainPortfolio.mock.calls.length === phase) {
                usePortfolioStore.getState().setPortfolio(portfolio('late-edit'));
            }
        });
        await expect(BackupService.restoreBackup(portfolio('restored'))).rejects.toThrow('changed during restore');
        expect(saveMainPortfolio).toHaveBeenCalledTimes(phase);
        expect(usePortfolioStore.getState().portfolio.processes[0].id).toBe('late-edit');
        expect(usePortfolioStore.getState()).toMatchObject({ isDirty: true, isRestoring: false });
    });

    it('keeps current state untouched when the atomic save fails', async () => {
        saveMainPortfolio.mockRejectedValueOnce(new Error('disk full'));

        await expect(BackupService.restoreBackup({
            version: '1.0.0',
            appVersion: '0.13.1',
            data: portfolio('restored'),
        })).rejects.toThrow('disk full');

        expect(usePortfolioStore.getState().portfolio.processes[0].id).toBe('current');
        expect(useCanvasStore.getState().graph.nodes[0].id).toBe('current-node');
        expect(useJournalStore.getState().selectedEntryId).toBe('old-entry');
    });

    it('rejects a process fragment before writing or switching state', async () => {
        await expect(BackupService.restoreBackup({
            format: 'axiom',
            kind: 'process-fragment',
            schemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
            version: '1.0.0',
            appVersion: '0.13.1',
            timestamp: '2026-08-12T12:00:00.000Z',
            data: portfolio('fragment'),
        })).rejects.toThrow('cannot replace the full portfolio');

        expect(saveMainPortfolio).not.toHaveBeenCalled();
        expect(usePortfolioStore.getState().portfolio.processes[0].id).toBe('current');
    });

    it('backs up and restores complete Event nodes', async () => {
        const source = portfolio('events');
        source.processes[0].graph.nodes = [{
            id: 'event-1',
            type: 'event',
            label: 'Release',
            position: { x: 10, y: 20 },
            event: {
                kind: 'milestone',
                behavior: 'neutral',
                timing: {
                    start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                    allDay: true,
                },
                extensions: { 'org.example.process': { id: '42' } },
            },
        }];
        usePortfolioStore.getState().hydratePortfolio(source, false);
        const snapshot = BackupService.createBackupSnapshot();

        await BackupService.restoreBackup(snapshot);

        expect(useCanvasStore.getState().graph.nodes[0]).toEqual(source.processes[0].graph.nodes[0]);
        expect(saveMainPortfolio).toHaveBeenCalledWith(expect.objectContaining({
            processes: [expect.objectContaining({
                graph: expect.objectContaining({ nodes: [expect.objectContaining({ type: 'event' })] }),
            })],
        }));
    });

    it('rolls back before persistence when plugin data fails schema validation', async () => {
        const invalid = {
            ...portfolio('restored'),
            plugins: {
                schemaVersion: 999,
                requirements: [],
                semanticData: { records: [], relations: [], annotations: [] },
            },
        };

        await expect(BackupService.restoreBackup(invalid)).rejects.toThrow('Portfolio validation failed');

        expect(saveMainPortfolio).not.toHaveBeenCalled();
        expect(usePortfolioStore.getState().portfolio.processes[0].id).toBe('current');
        expect(useCanvasStore.getState().graph.nodes[0].id).toBe('current-node');
        expect(useJournalStore.getState().selectedEntryId).toBe('old-entry');
    });
});

describe('BackupService shared exports', () => {
    beforeEach(() => {
        useSettingsStore.setState({
            theme: 'void',
            activeThemeId: null,
            customThemes: [],
        });
    });

    it('includes only the active appearance in full backups and never in process fragments', () => {
        const activeTheme = createThemeConfig('Backup Brand', 'polar', 'org.example.backup-brand');
        activeTheme.sourceDocument = {
            ...activeTheme.sourceDocument,
            extensions: { 'org.example.publisher': { retained: true } },
        };
        useSettingsStore.setState({
            theme: 'void',
            activeThemeId: activeTheme.id,
            customThemes: [activeTheme],
        });
        usePortfolioStore.getState().hydratePortfolio(portfolio('shared'), false);

        const fullBackup = BackupService.createBackupSnapshot();
        const sharedFragment = BackupService.createPartialExport('shared', true);

        expect(fullBackup.appearance).toMatchObject({
            schema: 'axiom.appearance',
            version: 1,
            activeTheme: {
                kind: 'custom',
                id: activeTheme.id,
                document: {
                    id: activeTheme.id,
                    extensions: { 'org.example.publisher': { retained: true } },
                },
            },
        });
        expect(sharedFragment).not.toHaveProperty('appearance');
    });

    it('keeps internal notes in full backups but removes them from shared fragments', () => {
        const source = portfolio('shared');
        source.extensions = { private: 'PORTFOLIO_PRIVATE_VALUE' };
        source.journal.notebooks = [{
            id: 'notebook-1',
            title: 'Notebook',
            createdAt: '2026-08-12T12:00:00.000Z',
            updatedAt: '2026-08-12T12:00:00.000Z',
        }];
        source.journal.entries = [
            {
                id: 'entry-shareable',
                notebookId: 'notebook-1',
                title: 'Shareable note',
                content: '<p>Shared</p>',
                contentFormat: 'html',
                contentVersion: 1,
                tags: [],
                linkedContext: [{ id: 'shared', type: 'process' }],
                sharePolicy: 'shareable',
                createdAt: '2026-08-12T12:00:00.000Z',
                updatedAt: '2026-08-12T12:00:00.000Z',
            },
            {
                id: 'entry-internal',
                notebookId: 'notebook-1',
                title: 'Internal note',
                content: '<p>INTERNAL_PRIVATE_VALUE</p>',
                contentFormat: 'html',
                contentVersion: 1,
                tags: [],
                linkedContext: [{ id: 'shared', type: 'process' }],
                sharePolicy: 'internal',
                createdAt: '2026-08-12T12:00:00.000Z',
                updatedAt: '2026-08-12T12:00:00.000Z',
            },
        ];
        usePortfolioStore.getState().hydratePortfolio(source, false);

        const fullBackup = BackupService.createBackupSnapshot();
        const sharedFragment = BackupService.createPartialExport('shared', true);

        expect(fullBackup.data.journal.entries.map(entry => entry.id)).toContain('entry-internal');
        expect(JSON.stringify(fullBackup)).toContain('INTERNAL_PRIVATE_VALUE');
        expect(sharedFragment.data.journal.entries.map(entry => entry.id)).toEqual(['entry-shareable']);
        expect(JSON.stringify(sharedFragment)).not.toContain('INTERNAL_PRIVATE_VALUE');
        expect(JSON.stringify(sharedFragment)).not.toContain('PORTFOLIO_PRIVATE_VALUE');
        expect(sharedFragment.data.plugins).toBeUndefined();
        expect(BackupService.getPartialExportSummary('shared', true)).toMatchObject({
            includedJournalEntries: 1,
            excludedInternalJournalEntries: 1,
        });
    });
});
