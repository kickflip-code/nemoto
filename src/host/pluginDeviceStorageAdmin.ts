import { z } from 'zod';
import {
    clearPluginDeviceStorageNative,
    listPluginDeviceStorageNative,
} from '../lib/tauri';
import { PluginIdSchema } from '../plugins/identifiers';
import {
    MAX_PLUGIN_DEVICE_SETTINGS_BYTES,
    MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS,
    MAX_PLUGIN_DEVICE_SECRETS,
} from '../plugins/deviceStorageContracts';

const PluginDeviceStorageAdminEntrySchema = z.object({
    pluginId: PluginIdSchema,
    hasSettings: z.boolean(),
    settingsDocumentCount: z.number().int().nonnegative()
        .max(MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS),
    settingsBytes: z.number().int().nonnegative().max(MAX_PLUGIN_DEVICE_SETTINGS_BYTES),
    hasSecretIndex: z.boolean(),
    secretCount: z.number().int().nonnegative().max(MAX_PLUGIN_DEVICE_SECRETS),
}).strict();

const PluginDeviceStorageAdminInventorySchema = z.array(
    PluginDeviceStorageAdminEntrySchema,
).max(1_000);

const PluginDeviceStorageClearResultSchema = z.object({
    pluginId: PluginIdSchema,
    settingsRemoved: z.boolean(),
    settingsDocumentsCleared: z.number().int().nonnegative()
        .max(MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS),
    secretIndexRemoved: z.boolean(),
    secretsCleared: z.number().int().nonnegative().max(MAX_PLUGIN_DEVICE_SECRETS),
}).strict();

export type PluginDeviceStorageAdminEntry = z.infer<
    typeof PluginDeviceStorageAdminEntrySchema
>;
export type PluginDeviceStorageClearResult = z.infer<
    typeof PluginDeviceStorageClearResultSchema
>;

export class PluginDeviceStorageAdminError extends Error {
    readonly code = 'PLUGIN_DEVICE_STORAGE_ADMIN_FAILED';

    constructor() {
        super('Plugin device data could not be inspected or cleared safely.');
        this.name = 'PluginDeviceStorageAdminError';
    }
}

export interface PluginDeviceStorageAdminNativeBridge {
    readonly list: () => Promise<unknown>;
    readonly clear: (pluginId: string) => Promise<unknown>;
}

export interface PluginDeviceStorageAdminService {
    readonly list: () => Promise<readonly PluginDeviceStorageAdminEntry[]>;
    readonly clear: (pluginId: string) => Promise<PluginDeviceStorageClearResult>;
}

const nativeBridge: PluginDeviceStorageAdminNativeBridge = {
    list: listPluginDeviceStorageNative,
    clear: clearPluginDeviceStorageNative,
};

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

export const createPluginDeviceStorageAdmin = (
    bridge: PluginDeviceStorageAdminNativeBridge,
): PluginDeviceStorageAdminService => ({
    list: async () => {
        try {
            return deepFreeze(PluginDeviceStorageAdminInventorySchema.parse(
                await bridge.list(),
            ));
        } catch {
            throw new PluginDeviceStorageAdminError();
        }
    },
    clear: async pluginIdInput => {
        try {
            const pluginId = PluginIdSchema.parse(pluginIdInput);
            const result = PluginDeviceStorageClearResultSchema.parse(
                await bridge.clear(pluginId),
            );
            if (result.pluginId !== pluginId) throw new PluginDeviceStorageAdminError();
            return deepFreeze(result);
        } catch (error) {
            if (error instanceof PluginDeviceStorageAdminError) throw error;
            throw new PluginDeviceStorageAdminError();
        }
    },
});

export const pluginDeviceStorageAdmin = createPluginDeviceStorageAdmin(nativeBridge);
