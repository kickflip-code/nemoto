import { usePortfolioStore } from '../stores/usePortfolioStore';
import { projectContextualRecords } from '../plugins/contextualRecordPortability';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useJournalStore } from '../stores/useJournalStore';
import { useUIStore } from '../stores/useUIStore';
import {
    createPortfolioEnvelope,
    decodePortfolioValue,
    preparePortfolioForPersistence,
    assertPortfolioIntegrity,
} from '../lib/portfolioCodec';
import {
    createSharedProcessProjection,
    type SharedProcessExportSummary,
} from '../export/shareablePortfolio';
import { savePortfolio as saveMainPortfolio, writeAxiomFileAtomic } from '../lib/tauri';
import { createAppearanceBackup } from '../theme/themeBackup';


export class BackupService {
    /**
     * Creates a full portfolio archive of the application state.
     * This is the canonical `.nemoto` long-term storage format.
     */
    static createBackupSnapshot() {
        // Portfolio contains EVERYTHING: Assets, Journal, Processes, etc.
        const portfolio = usePortfolioStore.getState().portfolio;
        const { theme, activeThemeId, customThemes } = useSettingsStore.getState();
        return {
            ...createPortfolioEnvelope(portfolio, { kind: 'portfolio' }),
            appearance: createAppearanceBackup({ theme, activeThemeId, customThemes }),
        };
    }

    /**
     * Saves the full portfolio archive using native file dialog.
     */
    static async downloadBackup() {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const { backupPath } = useSettingsStore.getState();

            const snapshot = this.createBackupSnapshot();
            const json = JSON.stringify(snapshot, null, 2);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const defaultFilename = `nemoto-portfolio-${timestamp}.nemoto`;

            // Open native Save dialog
            const path = await save({
                filters: [{ name: 'Nemoto Portfolio', extensions: ['nemoto'] }],
                defaultPath: backupPath ? `${backupPath}/${defaultFilename}` : defaultFilename
            });

            if (path) {
                await writeAxiomFileAtomic(path, json, true);
                // Update last backup time
                useSettingsStore.getState().setLastBackupTime(new Date().toISOString());
                return true;
            }
            return false;
        } catch (error) {
            console.error('[BackupService] Backup failed:', error);
            throw error;
        }
    }

    /**
     * Restores a portfolio archive from a JSON object.
     * WARNING: This overwrites current state.
     */
    static async restoreBackup(snapshot: unknown) {
        const decoded = decodePortfolioValue(snapshot);
        if (decoded.kind !== 'portfolio') {
            throw new Error('A process fragment can be imported, but cannot replace the full portfolio.');
        }
        assertPortfolioIntegrity(decoded.portfolio);
        const restoredAt = new Date().toISOString();
        const portfolio = { ...decoded.portfolio, lastModified: restoredAt };

        if (usePortfolioStore.getState().isRestoring) {
            throw new Error('A Portfolio restore is already in progress.');
        }
        // Reserve the save path before waiting, so no new autosave/manual save
        // can start between the previous write and this restore transaction.
        usePortfolioStore.setState({ isRestoring: true });
        try {
            if (usePortfolioStore.getState().isSaving) {
                await new Promise<void>(resolve => {
                    const unsubscribe = usePortfolioStore.subscribe(state => {
                        if (!state.isSaving) {
                            unsubscribe();
                            resolve();
                        }
                    });
                });
            }
            const current = usePortfolioStore.getState();
            const assertUnchanged = () => {
                const latest = usePortfolioStore.getState();
                if (latest.changeRevision !== current.changeRevision || latest.portfolio !== current.portfolio) {
                    // A plugin or other asynchronous action may still edit while
                    // the modal is open. Keep that work, never hydrate over it.
                    usePortfolioStore.setState({ isDirty: true });
                    throw new Error('The Portfolio changed during restore. Your current work is still open and unsaved. Save it, then retry Restore.');
                }
            };
            if (current.isDirty) {
                assertPortfolioIntegrity(current.portfolio);
                await saveMainPortfolio({
                    ...preparePortfolioForPersistence(current.portfolio),
                    lastModified: new Date().toISOString(),
                });
            }
            assertUnchanged();
            // The target now contains the current working version, including
            // unsaved edits, so native replacement retains that version as .bak.
            await saveMainPortfolio(portfolio);
            assertUnchanged();

            usePortfolioStore.getState().hydratePortfolio(portfolio, false);
            const activeProcess = portfolio.processes[0];
            useCanvasStore.getState().loadGraph(structuredClone(
                activeProcess?.graph || { nodes: [], edges: [], swimlanes: [] },
            ));
            useCanvasStore.temporal.getState().clear();
            useJournalStore.setState({ selectedNotebookId: null, selectedEntryId: null, expandedItems: {} });
            useUIStore.getState().selectAsset(null);
            useUIStore.getState().selectSwimlane(null);
            console.log('[BackupService] Restore complete');
            return decoded.migration;
        } finally {
            usePortfolioStore.setState({ isRestoring: false });
        }
    }

    /**
     * Creates a partial JSON snapshot containing a specific process and its dependencies.
     */
    static createPartialExport(processId: string, withDependencies: boolean = true, includeLinkedRecords = false) {
        const { portfolio } = usePortfolioStore.getState();
        const projection = createSharedProcessProjection(portfolio, processId, withDependencies);
        const envelope = createPortfolioEnvelope(projection.portfolio, {
            kind: 'process-fragment',
            sourceId: processId,
        });
        // Canonical persistence adds an empty plugin container during migration.
        // Shared fragments intentionally carry no portfolio-wide plugin payload.
        delete envelope.data.plugins;
        delete envelope.data.extensions;
        if (includeLinkedRecords) Object.assign(envelope.data, projectContextualRecords(portfolio, processId, new Set(projection.portfolio.processes.flatMap(process => [process.graph, ...Object.values(process.subGraphs ?? {})]).flatMap(graph => graph.nodes.map(node => node.id)))));
        return envelope;
    }

    static getPartialExportSummary(
        processId: string,
        withDependencies: boolean = true,
    ): SharedProcessExportSummary {
        const { portfolio } = usePortfolioStore.getState();
        return createSharedProcessProjection(portfolio, processId, withDependencies).summary;
    }

    /**
     * Saves a partial export for a specific process using native file dialog.
     */
    static async downloadPartialExport(processId: string, withDependencies: boolean = true, includeLinkedRecords = false): Promise<boolean> {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const { backupPath } = useSettingsStore.getState();

            const snapshot = this.createPartialExport(processId, withDependencies, includeLinkedRecords);
            const processTitle = snapshot.data.processes[0].title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const json = JSON.stringify(snapshot, null, 2);

            const timestamp = new Date().toISOString().slice(0, 10);
            const defaultFilename = `${processTitle}_process_${timestamp}.nemoto-process`;

            const path = await save({
                filters: [{ name: 'Nemoto Process', extensions: ['nemoto-process'] }],
                defaultPath: backupPath ? `${backupPath}/${defaultFilename}` : defaultFilename
            });

            if (path) {
                await writeAxiomFileAtomic(path, json, true);
                return true;
            }
            return false;
        } catch (err) {
            console.error('Export failed', err);
            throw err;
        }
    }
}
