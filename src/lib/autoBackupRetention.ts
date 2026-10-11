export interface BackupDirectoryEntry {
    name: string;
    isFile: boolean;
}

export const DEFAULT_AUTO_BACKUP_RETENTION = 25;

const AUTO_BACKUP_FILE_PATTERN = /^auto-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(?:axiom|nemoto)$/;

export const getAutoBackupFilesToPrune = (
    entries: readonly BackupDirectoryEntry[],
    retentionLimit: number,
): string[] => {
    if (!Number.isFinite(retentionLimit) || retentionLimit <= 0) return [];

    const normalizedLimit = Math.floor(retentionLimit);

    return entries
        .filter(entry => entry.isFile && AUTO_BACKUP_FILE_PATTERN.test(entry.name))
        .map(entry => entry.name)
        .sort((a, b) => b.localeCompare(a))
        .slice(normalizedLimit);
};
