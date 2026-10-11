import { describe, expect, it } from 'vitest';
import {
    PluginDeviceDocumentConflictError,
    PluginDeviceStorageContractError,
    PluginDeviceStorageCursorError,
    PluginDeviceStorageRevisionConflictError,
} from './deviceStorageContracts';
import {
    createEmptyPluginDeviceSettingsState,
    createMemoryPluginDeviceStorageBroker,
    getPluginDeviceSettingsUsage,
    listPluginDeviceSettings,
    readPluginDeviceSetting,
    transactPluginDeviceSettings,
} from './deviceStorageModel';

const pluginId = 'org.axiom.declarative-conformance';
const transaction = (expectedNamespaceRevision: number, operations: unknown[]) => ({
    schema: 'axiom.plugin-device-settings-transaction',
    schemaVersion: 1,
    scope: 'device-settings',
    expectedNamespaceRevision,
    operations,
});
const put = (
    operationId: string,
    key: string,
    value: unknown,
    expectedDocumentVersion: number | null = null,
) => ({ operationId, kind: 'put', key, expectedDocumentVersion, value });

describe('device-local plugin storage model', () => {
    it('commits bounded settings atomically with namespace and document CAS', () => {
        const initial = createEmptyPluginDeviceSettingsState(pluginId);
        const first = transactPluginDeviceSettings(initial, transaction(0, [
            put('layout', 'ui/layout', { density: 'compact' }),
            put('endpoint', 'runtime/endpoint', 'http://127.0.0.1:11434'),
        ]), '2026-08-27T10:00:00.000Z');

        expect(first.result).toMatchObject({
            namespaceRevision: 1,
            operations: [
                { key: 'ui/layout', documentVersion: 1 },
                { key: 'runtime/endpoint', documentVersion: 1 },
            ],
        });
        expect(readPluginDeviceSetting(first.state, 'ui/layout')).toMatchObject({
            namespaceRevision: 1,
            documentVersion: 1,
            updatedAt: '2026-08-27T10:00:00.000Z',
            value: { density: 'compact' },
        });
        expect(getPluginDeviceSettingsUsage(first.state)).toMatchObject({
            documentCount: 2,
            exportedWithPortfolio: false,
            backedUpByAxiom: false,
        });

        expect(() => transactPluginDeviceSettings(first.state, transaction(0, [
            put('stale-namespace', 'ui/layout', {}, 1),
        ]), '2026-08-27T10:01:00.000Z')).toThrow(PluginDeviceStorageRevisionConflictError);
        expect(() => transactPluginDeviceSettings(first.state, transaction(1, [
            put('stale-document', 'ui/layout', {}, null),
        ]), '2026-08-27T10:01:00.000Z')).toThrow(PluginDeviceDocumentConflictError);
    });

    it('lists settings with revision-bound cursors and rejects unsafe contracts', () => {
        const stored = transactPluginDeviceSettings(
            createEmptyPluginDeviceSettingsState(pluginId),
            transaction(0, [
                put('a', 'ui/a', true),
                put('b', 'ui/b', false),
                put('c', 'cache/c', 3),
            ]),
            '2026-08-27T10:00:00.000Z',
        ).state;
        const first = listPluginDeviceSettings(stored, {
            schema: 'axiom.plugin-device-settings-list',
            schemaVersion: 1,
            scope: 'device-settings',
            prefix: 'ui/',
            limit: 1,
        });
        expect(first.items[0].key).toBe('ui/a');
        expect(first.nextCursor).not.toBeNull();
        expect(() => listPluginDeviceSettings({ ...stored, revision: 2 }, {
            schema: 'axiom.plugin-device-settings-list',
            schemaVersion: 1,
            scope: 'device-settings',
            prefix: 'ui/',
            cursor: first.nextCursor!,
        })).toThrow(PluginDeviceStorageCursorError);
        expect(() => transactPluginDeviceSettings(stored, transaction(1, [
            put('unsafe', '../escape', true),
        ]), '2026-08-27T10:01:00.000Z')).toThrow(PluginDeviceStorageContractError);
    });

    it('keeps secret values separate from enumerable metadata', async () => {
        const broker = createMemoryPluginDeviceStorageBroker(
            () => new Date('2026-08-27T10:00:00.000Z'),
        );
        const stored = await broker.secrets.set(pluginId, {
            schema: 'axiom.plugin-device-secret-set',
            schemaVersion: 1,
            scope: 'device-secrets',
            key: 'providers/example/token',
            expectedSecretVersion: null,
            value: 'super-secret-token',
        });

        expect(stored).toMatchObject({ namespaceRevision: 1, secretVersion: 1 });
        expect(await broker.secrets.get(pluginId, 'providers/example/token')).toMatchObject({
            secretVersion: 1,
            value: 'super-secret-token',
        });
        const listed = await broker.secrets.list(pluginId, {
            schema: 'axiom.plugin-device-secrets-list',
            schemaVersion: 1,
            scope: 'device-secrets',
        });
        expect(listed.items).toEqual([expect.objectContaining({
            key: 'providers/example/token',
            secretVersion: 1,
        })]);
        expect(JSON.stringify(listed)).not.toContain('super-secret-token');
        expect(await broker.secrets.usage(pluginId)).toMatchObject({
            secretCount: 1,
            provider: 'os-credential-store',
            exportedWithPortfolio: false,
            backedUpByAxiom: false,
        });

        await expect(broker.secrets.set(pluginId, {
            schema: 'axiom.plugin-device-secret-set',
            schemaVersion: 1,
            scope: 'device-secrets',
            key: 'providers/example/token',
            expectedSecretVersion: null,
            value: 'replacement',
        })).rejects.toThrow(PluginDeviceDocumentConflictError);
        const deleted = await broker.secrets.delete(pluginId, {
            schema: 'axiom.plugin-device-secret-delete',
            schemaVersion: 1,
            scope: 'device-secrets',
            key: 'providers/example/token',
            expectedSecretVersion: 1,
        });
        expect(deleted.secretVersion).toBeNull();
        expect(await broker.secrets.get(pluginId, 'providers/example/token')).toBeNull();
    });
});
