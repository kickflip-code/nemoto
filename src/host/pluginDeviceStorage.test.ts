import { describe, expect, it, vi } from 'vitest';
import {
    PluginDeviceStorageRevisionConflictError,
    PluginDeviceSecretStoreError,
    PluginDeviceStorageDataError,
} from '../plugins/deviceStorageContracts';
import {
    createPluginDeviceStorage,
    type PluginDeviceStorageNativeBridge,
} from './pluginDeviceStorage';

const pluginId = 'org.axiom.declarative-conformance';
const timestamp = '2026-08-27T10:00:00.000Z';

const settingsState = {
    schema: 'axiom.plugin-device-settings-state',
    schemaVersion: 1,
    pluginId,
    revision: 2,
    documents: {
        'ui/theme': {
            documentVersion: 1,
            updatedAt: timestamp,
            value: { mode: 'dark' },
        },
    },
};

const secretIndex = {
    schema: 'axiom.plugin-device-secret-index',
    schemaVersion: 1,
    pluginId,
    revision: 3,
    entries: {
        'providers/example/token': {
            secretVersion: 2,
            updatedAt: timestamp,
        },
    },
};

const bridge = (overrides: Partial<PluginDeviceStorageNativeBridge> = {}) => ({
    readSettingsState: vi.fn(async () => settingsState),
    transactSettings: vi.fn(async () => ({
        schema: 'axiom.plugin-device-settings-transaction-result',
        schemaVersion: 1,
        scope: 'device-settings',
        namespaceRevision: 3,
        operations: [],
    })),
    readSecretIndex: vi.fn(async () => secretIndex),
    getSecret: vi.fn(async () => ({
        schema: 'axiom.plugin-device-secret',
        schemaVersion: 1,
        scope: 'device-secrets',
        namespaceRevision: 3,
        key: 'providers/example/token',
        secretVersion: 2,
        updatedAt: timestamp,
        value: 'secret-value',
    })),
    setSecret: vi.fn(async (_pluginId: string, input: unknown) => ({
        schema: 'axiom.plugin-device-secret-mutation-result',
        schemaVersion: 1,
        scope: 'device-secrets',
        namespaceRevision: 4,
        key: (input as { key: string }).key,
        secretVersion: 3,
    })),
    deleteSecret: vi.fn(async (_pluginId: string, input: unknown) => ({
        schema: 'axiom.plugin-device-secret-mutation-result',
        schemaVersion: 1,
        scope: 'device-secrets',
        namespaceRevision: 4,
        key: (input as { key: string }).key,
        secretVersion: null,
    })),
    ...overrides,
}) satisfies PluginDeviceStorageNativeBridge;

describe('native plugin device-storage adapter', () => {
    it('derives safe public settings views from the bound native namespace', async () => {
        const native = bridge();
        const storage = createPluginDeviceStorage(native);

        await expect(storage.settings.get(pluginId, 'ui/theme')).resolves.toMatchObject({
            scope: 'device-settings',
            namespaceRevision: 2,
            key: 'ui/theme',
            value: { mode: 'dark' },
        });
        await expect(storage.settings.usage(pluginId)).resolves.toMatchObject({
            exportedWithPortfolio: false,
            backedUpByAxiom: false,
            documentCount: 1,
        });
        expect(native.readSettingsState).toHaveBeenCalledWith(pluginId);
    });

    it('keeps secret values out of metadata while using the credential bridge for values', async () => {
        const native = bridge();
        const storage = createPluginDeviceStorage(native);

        const page = await storage.secrets.list(pluginId, {
            schema: 'axiom.plugin-device-secrets-list',
            schemaVersion: 1,
            scope: 'device-secrets',
        });
        expect(page.items).toEqual([expect.objectContaining({
            key: 'providers/example/token',
            secretVersion: 2,
        })]);
        expect(JSON.stringify(page)).not.toContain('secret-value');

        await expect(storage.secrets.get(pluginId, 'providers/example/token'))
            .resolves.toMatchObject({ value: 'secret-value' });
        expect(native.getSecret).toHaveBeenCalledWith(pluginId, 'providers/example/token');
    });

    it('rejects mismatched namespaces and malformed native results', async () => {
        const wrongNamespace = createPluginDeviceStorage(bridge({
            readSettingsState: vi.fn(async () => ({
                ...settingsState,
                pluginId: 'org.example.foreign',
            })),
        }));
        await expect(wrongNamespace.settings.usage(pluginId))
            .rejects.toBeInstanceOf(PluginDeviceStorageDataError);

        const mismatchedSecret = createPluginDeviceStorage(bridge({
            getSecret: vi.fn(async () => ({
                schema: 'axiom.plugin-device-secret',
                schemaVersion: 1,
                scope: 'device-secrets',
                namespaceRevision: 3,
                key: 'providers/other/token',
                secretVersion: 2,
                updatedAt: timestamp,
                value: 'secret-value',
            })),
        }));
        await expect(mismatchedSecret.secrets.get(pluginId, 'providers/example/token'))
            .rejects.toBeInstanceOf(PluginDeviceStorageDataError);
    });

    it('normalizes an unavailable OS credential store without exposing native details', async () => {
        const storage = createPluginDeviceStorage(bridge({
            getSecret: vi.fn(async () => {
                throw {
                    code: 'PLUGIN_SECRET_STORE_UNAVAILABLE',
                    message: 'hidden native detail',
                };
            }),
        }));

        const error = await storage.secrets.get(pluginId, 'providers/example/token')
            .catch(candidate => candidate);
        expect(error).toBeInstanceOf(PluginDeviceSecretStoreError);
        expect(error.message).not.toContain('INTERNAL_ERROR');
    });

    it('maps structured native conflicts to the stable public error contract', async () => {
        const storage = createPluginDeviceStorage(bridge({
            transactSettings: vi.fn(async () => {
                throw {
                    code: 'PLUGIN_DEVICE_STORAGE_REVISION_CONFLICT',
                    message: 'native message is not exposed',
                    expectedRevision: 2,
                    actualRevision: 4,
                };
            }),
        }));

        const error = await storage.settings.transact(pluginId, {
            schema: 'axiom.plugin-device-settings-transaction',
            schemaVersion: 1,
            scope: 'device-settings',
            expectedNamespaceRevision: 2,
            operations: [{
                operationId: 'put-theme',
                kind: 'put',
                key: 'ui/theme',
                expectedDocumentVersion: null,
                value: { mode: 'dark' },
            }],
        }).catch(candidate => candidate);
        expect(error).toBeInstanceOf(PluginDeviceStorageRevisionConflictError);
        expect(error).toMatchObject({ expectedRevision: 2, actualRevision: 4 });
        expect(error.message).not.toContain('native message');
    });
});
