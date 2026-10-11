import { describe, expect, it, vi } from 'vitest';
import {
    PluginDeviceStorageAdminError,
    createPluginDeviceStorageAdmin,
} from './pluginDeviceStorageAdmin';

describe('plugin device-storage administration adapter', () => {
    it('validates and freezes metadata-only inventory results', async () => {
        const list = vi.fn(async () => [{
            pluginId: 'org.axiom.declarative-conformance',
            hasSettings: true,
            settingsDocumentCount: 2,
            settingsBytes: 512,
            hasSecretIndex: true,
            secretCount: 1,
        }]);
        const admin = createPluginDeviceStorageAdmin({
            list,
            clear: vi.fn(),
        });

        const inventory = await admin.list();
        expect(inventory).toEqual([expect.objectContaining({
            pluginId: 'org.axiom.declarative-conformance',
            settingsDocumentCount: 2,
            secretCount: 1,
        })]);
        expect(JSON.stringify(inventory)).not.toContain('value');
        expect(Object.isFrozen(inventory)).toBe(true);
        expect(Object.isFrozen(inventory[0])).toBe(true);
    });

    it('binds clear results to the requested namespace and hides native failures', async () => {
        const clear = vi.fn(async () => ({
            pluginId: 'org.axiom.declarative-conformance',
            settingsRemoved: true,
            settingsDocumentsCleared: 2,
            secretIndexRemoved: true,
            secretsCleared: 1,
        }));
        const admin = createPluginDeviceStorageAdmin({
            list: vi.fn(),
            clear,
        });

        await expect(admin.clear('org.axiom.declarative-conformance')).resolves.toMatchObject({
            settingsDocumentsCleared: 2,
            secretsCleared: 1,
        });
        expect(clear).toHaveBeenCalledWith('org.axiom.declarative-conformance');

        const mismatched = createPluginDeviceStorageAdmin({
            list: vi.fn(),
            clear: vi.fn(async () => ({
                pluginId: 'org.example.foreign',
                settingsRemoved: false,
                settingsDocumentsCleared: 0,
                secretIndexRemoved: false,
                secretsCleared: 0,
            })),
        });
        await expect(mismatched.clear('org.axiom.declarative-conformance'))
            .rejects.toBeInstanceOf(PluginDeviceStorageAdminError);
    });

    it('fails closed when inventory data is malformed', async () => {
        const admin = createPluginDeviceStorageAdmin({
            list: vi.fn(async () => [{
                pluginId: '../escape',
                secretValue: 'must-not-pass',
            }]),
            clear: vi.fn(),
        });

        await expect(admin.list()).rejects.toBeInstanceOf(PluginDeviceStorageAdminError);
    });
});
