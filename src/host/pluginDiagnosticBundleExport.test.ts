import { describe, expect, it, vi } from 'vitest';
import {
    createSanitizedPluginDiagnosticBundle,
    type PluginDeveloperDiagnosticSnapshot,
    type SanitizedPluginDiagnosticBundle,
} from '../plugins/developerDiagnostics';
import {
    preparePluginDiagnosticBundleExport,
    writePreparedPluginDiagnosticBundleExport,
} from './pluginDiagnosticBundleExport';

const createBundle = (): SanitizedPluginDiagnosticBundle => {
    const snapshot: PluginDeveloperDiagnosticSnapshot = {
        enabled: true,
        hostPluginApiVersion: '1.0.0',
        limits: {
            maxEntries: 500,
            maxContextBytes: 4_096,
            eventSampleEvery: 5,
            maxPackageBytes: 10_485_760,
            maxExpandedPackageBytes: 26_214_400,
            maxPackageEntries: 1_000,
            maxPackageEntryBytes: 2_097_152,
            maxPluginDataBytes: 2_097_152,
            maxPluginCollectionItems: 5_000,
        },
        packages: [{
            pluginId: 'org.example.private-plugin',
            installed: true,
            installedVersion: '1.2.3',
            installedDataVersion: 1,
            requirement: 'none',
            activation: 'not-requested',
            compatibility: 'compatible',
            declaredCapabilities: [],
            effectiveGrants: [],
            contributionCounts: { commands: 1 },
        }],
        entries: [{
            schema: 'axiom.plugin-diagnostic',
            schemaVersion: 1,
            sequence: 1,
            timestamp: '2026-08-25T08:01:00.000Z',
            source: 'command',
            severity: 'info',
            code: 'command.succeeded',
            pluginId: 'org.example.private-plugin',
            contributionId: 'org.example.private-plugin/open',
            context: { outcome: 'succeeded' },
        }],
    };
    return createSanitizedPluginDiagnosticBundle(snapshot, '2026-08-25T08:02:03.456Z');
};

describe('plugin diagnostic bundle export boundary', () => {
    it('prepares one immutable, byte-counted JSON preview with a portable filename', () => {
        const bundle = createBundle();
        const prepared = preparePluginDiagnosticBundleExport(bundle);

        expect(Object.isFrozen(prepared)).toBe(true);
        expect(JSON.parse(prepared.json)).toEqual(bundle);
        expect(prepared.json.endsWith('\n')).toBe(true);
        expect(prepared.byteLength).toBe(new TextEncoder().encode(prepared.json).byteLength);
        expect(prepared.suggestedFileName).toBe(
            'axiom-plugin-diagnostics-2026-08-25T08-02-03-456Z.json',
        );
        expect(prepared).toMatchObject({ packageCount: 1, entryCount: 1, schemaVersion: 1 });
        expect(prepared.json).not.toContain('org.example.private-plugin');
    });

    it('rejects a bundle that does not use aliased support identifiers', () => {
        const bundle = createBundle();
        const unsafe = {
            ...bundle,
            packages: [{ ...bundle.packages[0], pluginId: 'org.example.private-plugin' }],
        } as SanitizedPluginDiagnosticBundle;

        expect(() => preparePluginDiagnosticBundleExport(unsafe)).toThrow(/support redaction profile/i);
    });

    it('does not write when the user cancels the save dialog', async () => {
        const prepared = preparePluginDiagnosticBundleExport(createBundle());
        const writeTextFile = vi.fn();

        await expect(writePreparedPluginDiagnosticBundleExport(prepared, {
            save: vi.fn().mockResolvedValue(null),
            writeTextFile,
        })).resolves.toBe(false);
        expect(writeTextFile).not.toHaveBeenCalled();
    });

    it('writes the exact prepared preview after an explicit location is selected', async () => {
        const prepared = preparePluginDiagnosticBundleExport(createBundle());
        const save = vi.fn().mockResolvedValue('C:\\support\\diagnostics.json');
        const writeTextFile = vi.fn().mockResolvedValue(undefined);

        await expect(writePreparedPluginDiagnosticBundleExport(prepared, {
            save,
            writeTextFile,
        })).resolves.toBe(true);
        expect(save).toHaveBeenCalledWith({
            defaultPath: prepared.suggestedFileName,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        expect(writeTextFile).toHaveBeenCalledWith(
            'C:\\support\\diagnostics.json',
            prepared.json,
        );
    });
});
