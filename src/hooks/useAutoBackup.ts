import { useEffect, useRef } from 'react';
import { useSettingsStore, type AutoBackupStatus } from '../stores/useSettingsStore';
import { toast } from 'sonner';
import { formatError } from '../lib/errorUtils';
import { BackupService } from '../services/BackupService';
import { getAutoBackupFilesToPrune } from '../lib/autoBackupRetention';
import { writeNemotoFileAtomic } from '../lib/tauri';

function reportBackupStatus(status: AutoBackupStatus) {
    const previous = useSettingsStore.getState().autoBackupStatus;
    useSettingsStore.getState().setAutoBackupStatus(status);
    if (previous?.kind === status.kind && previous.path === status.path) return;
    if (status.kind === 'backup-failed') {
        toast.error('Scheduled backup failed. Check Data & Backup in Settings for details.');
    } else if (status.kind === 'cleanup-failed') {
        toast.warning('Backup saved, but old snapshots could not be cleaned up. Check Data & Backup in Settings.');
    } else if (previous && previous.kind !== 'saved') {
        toast.success('Scheduled backup is working again.');
    }
}

/**
 * Hook to handle automatic periodic backups (snapshots) of the entire portfolio.
 * Unlike auto-save (which saves to the current file), auto-backup creates a new
 * snapshot file in the configured backup directory.
 */
export function useAutoBackup() {
    const {
        autoBackupInterval,
        autoBackupRetention,
        backupPath,
        setLastBackupTime,
    } = useSettingsStore();
    const intervalRef = useRef<number | null>(null);
    const runningRef = useRef(false);

    useEffect(() => {
        // Clear existing interval if any
        if (intervalRef.current) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        // If auto-backup is disabled (0), do nothing
        if (autoBackupInterval <= 0) return;

        // Convert minutes to milliseconds
        const intervalMs = autoBackupInterval * 60 * 1000;

        intervalRef.current = window.setInterval(async () => {
            if (runningRef.current) return;
            runningRef.current = true;
            let resolvedBackupPath = backupPath || 'Default (Documents/NemotoBackups)';
            const attemptedAt = new Date().toISOString();
            try {
                if (!backupPath) {
                    const { documentDir, join } = await import('@tauri-apps/api/path');
                    const { mkdir } = await import('@tauri-apps/plugin-fs');
                    resolvedBackupPath = await join(await documentDir(), 'NemotoBackups');
                    await mkdir(resolvedBackupPath, { recursive: true });
                }
                const snapshot = BackupService.createBackupSnapshot();
                const json = JSON.stringify(snapshot, null, 2);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const filename = `auto-backup-${timestamp}.nemoto`;
                const fullPath = `${resolvedBackupPath}/${filename}`;

                const { readDir, remove } = await import('@tauri-apps/plugin-fs');
                await writeNemotoFileAtomic(fullPath, json, false);

                const now = new Date().toISOString();
                setLastBackupTime(now);
                console.log(`[AutoBackup] Snapshot saved to ${fullPath} at ${new Date(now).toLocaleTimeString()}`);

                try {
                    const entries = await readDir(resolvedBackupPath);
                    const filesToPrune = getAutoBackupFilesToPrune(entries, autoBackupRetention);

                    for (const oldFilename of filesToPrune) {
                        await remove(`${resolvedBackupPath}/${oldFilename}`);
                    }

                    if (filesToPrune.length > 0) {
                        console.log(`[AutoBackup] Removed ${filesToPrune.length} expired snapshot(s).`);
                    }
                    reportBackupStatus({ kind: 'saved', attemptedAt, path: resolvedBackupPath });
                } catch (cleanupError) {
                    // The newly written backup is still valid even if retention cleanup fails.
                    console.warn('[AutoBackup] Backup saved, but old snapshots could not be cleaned up:', cleanupError);
                    reportBackupStatus({ kind: 'cleanup-failed', attemptedAt, path: resolvedBackupPath, message: formatError(cleanupError) });
                }
            } catch (error) {
                console.error('[AutoBackup] Failed to create automatic backup:', error);
                reportBackupStatus({ kind: 'backup-failed', attemptedAt, path: resolvedBackupPath, message: formatError(error) });
            } finally {
                runningRef.current = false;
            }
        }, intervalMs);

        return () => {
            if (intervalRef.current) window.clearInterval(intervalRef.current);
        };
    }, [autoBackupInterval, autoBackupRetention, backupPath, setLastBackupTime]);
}
