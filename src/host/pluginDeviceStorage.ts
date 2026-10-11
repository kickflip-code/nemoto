import {
    deletePluginDeviceSecretNative,
    getPluginDeviceSecretNative,
    readPluginDeviceSettingsState,
    readPluginSecretIndex,
    setPluginDeviceSecretNative,
    transactPluginDeviceSettingsNative,
} from '../lib/tauri';
import {
    PluginDeviceSecretMutationResultSchema,
    PluginDeviceSecretSnapshotSchema,
    PluginDeviceSettingsTransactionResultSchema,
    PluginDeviceDocumentConflictError,
    PluginDeviceStorageQuotaError,
    PluginDeviceStorageRevisionConflictError,
    PluginDeviceStorageDataError,
    PluginDeviceSecretStoreError,
    parsePluginDeviceSecretDelete,
    parsePluginDeviceSecretSet,
    parsePluginDeviceSettingsTransaction,
} from '../plugins/deviceStorageContracts';
import {
    PluginDeviceSecretIndexSchema,
    PluginDeviceSettingsStateSchema,
    getPluginDeviceSecretsUsage,
    getPluginDeviceSettingsUsage,
    listPluginDeviceSecrets,
    listPluginDeviceSettings,
    readPluginDeviceSetting,
    type PluginDeviceStorageBroker,
} from '../plugins/deviceStorageModel';
import { parsePluginStorageDocumentKey } from '../plugins/storageContracts';

export interface PluginDeviceStorageNativeBridge {
    readonly readSettingsState: (pluginId: string) => Promise<unknown>;
    readonly transactSettings: (pluginId: string, transaction: unknown) => Promise<unknown>;
    readonly readSecretIndex: (pluginId: string) => Promise<unknown>;
    readonly getSecret: (pluginId: string, key: string) => Promise<unknown>;
    readonly setSecret: (pluginId: string, input: unknown) => Promise<unknown>;
    readonly deleteSecret: (pluginId: string, input: unknown) => Promise<unknown>;
}

const nativeBridge: PluginDeviceStorageNativeBridge = {
    readSettingsState: readPluginDeviceSettingsState,
    transactSettings: transactPluginDeviceSettingsNative,
    readSecretIndex: readPluginSecretIndex,
    getSecret: getPluginDeviceSecretNative,
    setSecret: setPluginDeviceSecretNative,
    deleteSecret: deletePluginDeviceSecretNative,
};

const parseSettingsState = (value: unknown, pluginId: string) => {
    const result = PluginDeviceSettingsStateSchema.safeParse(value);
    if (!result.success || result.data.pluginId !== pluginId) {
        throw new PluginDeviceStorageDataError();
    }
    return result.data;
};

const parseSecretIndex = (value: unknown, pluginId: string) => {
    const result = PluginDeviceSecretIndexSchema.safeParse(value);
    if (!result.success || result.data.pluginId !== pluginId) {
        throw new PluginDeviceStorageDataError();
    }
    return result.data;
};

const callNative = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
        return await operation();
    } catch (error) {
        if (error && typeof error === 'object') {
            const details = error as Record<string, unknown>;
            if (details.code === 'PLUGIN_SECRET_STORE_UNAVAILABLE') {
                throw new PluginDeviceSecretStoreError();
            }
            if (
                details.code === 'PLUGIN_DEVICE_STORAGE_REVISION_CONFLICT'
                && typeof details.expectedRevision === 'number'
                && typeof details.actualRevision === 'number'
            ) {
                throw new PluginDeviceStorageRevisionConflictError(
                    details.expectedRevision,
                    details.actualRevision,
                );
            }
            if (
                details.code === 'PLUGIN_DEVICE_DOCUMENT_CONFLICT'
                && typeof details.key === 'string'
                && (details.expectedVersion === null || typeof details.expectedVersion === 'number')
                && (details.actualVersion === null || typeof details.actualVersion === 'number')
            ) {
                throw new PluginDeviceDocumentConflictError(
                    details.key,
                    details.expectedVersion,
                    details.actualVersion,
                );
            }
            if (details.code === 'PLUGIN_DEVICE_STORAGE_QUOTA_EXCEEDED') {
                throw new PluginDeviceStorageQuotaError();
            }
        }
        throw new PluginDeviceStorageDataError();
    }
};

const parseNativeResult = <T>(
    value: unknown,
    schema: { safeParse: (input: unknown) => { success: boolean; data?: T } },
): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw new PluginDeviceStorageDataError();
    return result.data as T;
};

export const createPluginDeviceStorage = (
    bridge: PluginDeviceStorageNativeBridge,
): PluginDeviceStorageBroker => ({
    settings: {
        get: async (pluginId, key) => readPluginDeviceSetting(
            parseSettingsState(await callNative(
                () => bridge.readSettingsState(pluginId),
            ), pluginId),
            key,
        ),
        list: async (pluginId, request) => listPluginDeviceSettings(
            parseSettingsState(await callNative(
                () => bridge.readSettingsState(pluginId),
            ), pluginId),
            request,
        ),
        usage: async pluginId => getPluginDeviceSettingsUsage(
            parseSettingsState(await callNative(
                () => bridge.readSettingsState(pluginId),
            ), pluginId),
        ),
        transact: async (pluginId, input) => {
            const transaction = parsePluginDeviceSettingsTransaction(input);
            return parseNativeResult(
                await callNative(() => bridge.transactSettings(pluginId, transaction)),
                PluginDeviceSettingsTransactionResultSchema,
            );
        },
    },
    secrets: {
        get: async (pluginId, keyInput) => {
            const key = parsePluginStorageDocumentKey(keyInput);
            const value = await callNative(() => bridge.getSecret(pluginId, key));
            if (value === null) return null;
            const snapshot = parseNativeResult(value, PluginDeviceSecretSnapshotSchema);
            if (snapshot.key !== key) throw new PluginDeviceStorageDataError();
            return snapshot;
        },
        list: async (pluginId, request) => listPluginDeviceSecrets(
            parseSecretIndex(await callNative(
                () => bridge.readSecretIndex(pluginId),
            ), pluginId),
            request,
        ),
        usage: async pluginId => getPluginDeviceSecretsUsage(
            parseSecretIndex(await callNative(
                () => bridge.readSecretIndex(pluginId),
            ), pluginId),
        ),
        set: async (pluginId, input) => {
            const request = parsePluginDeviceSecretSet(input);
            const result = parseNativeResult(
                await callNative(() => bridge.setSecret(pluginId, request)),
                PluginDeviceSecretMutationResultSchema,
            );
            if (result.key !== request.key) throw new PluginDeviceStorageDataError();
            return result;
        },
        delete: async (pluginId, input) => {
            const request = parsePluginDeviceSecretDelete(input);
            const result = parseNativeResult(
                await callNative(() => bridge.deleteSecret(pluginId, request)),
                PluginDeviceSecretMutationResultSchema,
            );
            if (result.key !== request.key) throw new PluginDeviceStorageDataError();
            return result;
        },
    },
});

export const pluginDeviceStorage = createPluginDeviceStorage(nativeBridge);
