import { describe, expect, it } from 'vitest';
import { getAutoBackupFilesToPrune } from './autoBackupRetention';

describe('automatic backup retention', () => {
    it('orders both generations together without pruning other Nemoto files', () => {
        const entries = [
            'auto-backup-2026-10-10T10-00-00.axiom',
            'auto-backup-2026-10-10T11-00-00.nemoto',
            'auto-backup-2026-10-10T12-00-00.nemoto',
            'manual.nemoto',
            'auto-backup-2026-10-10T09-00-00.nemoto-process',
            'auto-backup-before-rename.nemoto',
            'auto-backup-2026-10-10T08-00-00.nemoto.bak',
        ].map(name => ({ name, isFile: true }));
        expect(getAutoBackupFilesToPrune(entries, 2)).toEqual([
            'auto-backup-2026-10-10T10-00-00.axiom',
        ]);
    });

    const automaticBackups = [
        'auto-backup-2026-08-09T10-00-00.axiom',
        'auto-backup-2026-08-09T11-00-00.axiom',
        'auto-backup-2026-08-09T12-00-00.axiom',
    ];

    it('keeps the newest automatic backups within the configured limit', () => {
        const entries = automaticBackups.map(name => ({ name, isFile: true }));

        expect(getAutoBackupFilesToPrune(entries, 2)).toEqual([
            'auto-backup-2026-08-09T10-00-00.axiom',
        ]);
    });

    it('never selects manual exports, unrelated files, or directories', () => {
        const entries = [
            ...automaticBackups.map(name => ({ name, isFile: true })),
            { name: 'axiom-portfolio-2026-08-09T09-00-00.axiom', isFile: true },
            { name: 'auto-backup-not-a-timestamp.axiom', isFile: true },
            { name: 'auto-backup-2026-08-08T10-00-00.axiom', isFile: false },
        ];

        expect(getAutoBackupFilesToPrune(entries, 1)).toEqual([
            'auto-backup-2026-08-09T11-00-00.axiom',
            'auto-backup-2026-08-09T10-00-00.axiom',
        ]);
    });

    it('does not prune when retention is unlimited', () => {
        const entries = automaticBackups.map(name => ({ name, isFile: true }));

        expect(getAutoBackupFilesToPrune(entries, 0)).toEqual([]);
    });
});
