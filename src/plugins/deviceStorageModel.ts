import { z } from 'zod';
import { PluginIdSchema } from './identifiers';
import { JsonValueSchema } from './semanticData';
import { PluginStorageDocumentKeySchema } from './storageContracts';
import {
    MAX_PLUGIN_DEVICE_SETTING_BYTES,
    MAX_PLUGIN_DEVICE_SETTINGS_BYTES,
    MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS,
    MAX_PLUGIN_DEVICE_SETTINGS_TRANSACTION_OPERATIONS,
    MAX_PLUGIN_DEVICE_SECRET_BYTES,
    MAX_PLUGIN_DEVICE_SECRETS,
    PLUGIN_DEVICE_SECRETS_SCOPE,
    PLUGIN_DEVICE_SETTINGS_SCOPE,
    PluginDeviceDocumentConflictError,
    PluginDeviceSecretMutationResultSchema,
    PluginDeviceSecretSnapshotSchema,
    PluginDeviceSecretsListPageSchema,
    PluginDeviceSecretsUsageSchema,
    PluginDeviceSettingMetadataSchema,
    PluginDeviceSettingSnapshotSchema,
    PluginDeviceSettingsListPageSchema,
    PluginDeviceSettingsTransactionResultSchema,
    PluginDeviceSettingsUsageSchema,
    PluginDeviceStorageCursorError,
    PluginDeviceStorageQuotaError,
    PluginDeviceStorageRevisionConflictError,
    parsePluginDeviceSecretDelete,
    parsePluginDeviceSecretSet,
    parsePluginDeviceSecretsListRequest,
    parsePluginDeviceSettingsListRequest,
    parsePluginDeviceSettingsTransaction,
    type PluginDeviceSecretDeleteInput,
    type PluginDeviceSecretMutationResult,
    type PluginDeviceSecretSetInput,
    type PluginDeviceSecretSnapshot,
    type PluginDeviceSecretsListPage,
    type PluginDeviceSecretsListRequestInput,
    type PluginDeviceSecretsUsage,
    type PluginDeviceSettingSnapshot,
    type PluginDeviceSettingsListPage,
    type PluginDeviceSettingsListRequestInput,
    type PluginDeviceSettingsTransactionInput,
    type PluginDeviceSettingsTransactionResult,
    type PluginDeviceSettingsUsage,
} from './deviceStorageContracts';

const TimestampSchema = z.string().datetime({ offset: true });
const byteLength = (value: unknown): number => (
    new TextEncoder().encode(JSON.stringify(value)).byteLength
);

const StoredDeviceSettingSchema = z.object({
    documentVersion: z.number().int().positive(),
    updatedAt: TimestampSchema,
    value: JsonValueSchema,
}).strict().superRefine((document, context) => {
    if (byteLength(document.value) > MAX_PLUGIN_DEVICE_SETTING_BYTES) {
        context.addIssue({
            code: 'custom',
            path: ['value'],
            message: 'Stored device setting exceeds the value limit.',
        });
    }
});

export const PluginDeviceSettingsStateSchema = z.object({
    schema: z.literal('axiom.plugin-device-settings-state'),
    schemaVersion: z.literal(1),
    pluginId: PluginIdSchema,
    revision: z.number().int().nonnegative(),
    documents: z.record(PluginStorageDocumentKeySchema, StoredDeviceSettingSchema),
}).strict().superRefine((state, context) => {
    if (
        Object.keys(state.documents).length > MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS
        || byteLength(state) > MAX_PLUGIN_DEVICE_SETTINGS_BYTES
    ) {
        context.addIssue({
            code: 'custom',
            path: ['documents'],
            message: 'Stored device-settings namespace exceeds its limit.',
        });
    }
});

const StoredDeviceSecretMetadataSchema = z.object({
    secretVersion: z.number().int().positive(),
    updatedAt: TimestampSchema,
}).strict();

export const PluginDeviceSecretIndexSchema = z.object({
    schema: z.literal('axiom.plugin-device-secret-index'),
    schemaVersion: z.literal(1),
    pluginId: PluginIdSchema,
    revision: z.number().int().nonnegative(),
    entries: z.record(PluginStorageDocumentKeySchema, StoredDeviceSecretMetadataSchema),
}).strict().superRefine((index, context) => {
    if (Object.keys(index.entries).length > MAX_PLUGIN_DEVICE_SECRETS) {
        context.addIssue({
            code: 'custom',
            path: ['entries'],
            message: 'Stored device-secret metadata exceeds its entry limit.',
        });
    }
});

export type PluginDeviceSettingsState = z.infer<typeof PluginDeviceSettingsStateSchema>;
export type PluginDeviceSecretIndex = z.infer<typeof PluginDeviceSecretIndexSchema>;

export interface PluginDeviceStorageBroker {
    readonly settings: {
        get: (pluginId: string, key: string) => Promise<PluginDeviceSettingSnapshot | null>;
        list: (
            pluginId: string,
            request: PluginDeviceSettingsListRequestInput,
        ) => Promise<PluginDeviceSettingsListPage>;
        usage: (pluginId: string) => Promise<PluginDeviceSettingsUsage>;
        transact: (
            pluginId: string,
            input: PluginDeviceSettingsTransactionInput,
        ) => Promise<PluginDeviceSettingsTransactionResult>;
    };
    readonly secrets: {
        get: (pluginId: string, key: string) => Promise<PluginDeviceSecretSnapshot | null>;
        list: (
            pluginId: string,
            request: PluginDeviceSecretsListRequestInput,
        ) => Promise<PluginDeviceSecretsListPage>;
        usage: (pluginId: string) => Promise<PluginDeviceSecretsUsage>;
        set: (
            pluginId: string,
            input: PluginDeviceSecretSetInput,
        ) => Promise<PluginDeviceSecretMutationResult>;
        delete: (
            pluginId: string,
            input: PluginDeviceSecretDeleteInput,
        ) => Promise<PluginDeviceSecretMutationResult>;
    };
}

const cloneJson = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const prefixFingerprint = (prefix: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < prefix.length; index += 1) {
        hash ^= prefix.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const cursorOffset = (
    cursor: string | undefined,
    revision: number,
    prefix: string,
): number => {
    if (!cursor) return 0;
    const match = /^v1:(\d+):(\d+):([a-f0-9]{8})$/.exec(cursor);
    if (!match) throw new PluginDeviceStorageCursorError();
    const cursorRevision = Number(match[1]);
    const offset = Number(match[2]);
    if (
        cursorRevision !== revision
        || match[3] !== prefixFingerprint(prefix)
        || !Number.isSafeInteger(offset)
        || offset < 0
    ) throw new PluginDeviceStorageCursorError();
    return offset;
};

export const createEmptyPluginDeviceSettingsState = (
    pluginId: string,
): PluginDeviceSettingsState => PluginDeviceSettingsStateSchema.parse({
    schema: 'axiom.plugin-device-settings-state',
    schemaVersion: 1,
    pluginId,
    revision: 0,
    documents: {},
});

export const createEmptyPluginDeviceSecretIndex = (
    pluginId: string,
): PluginDeviceSecretIndex => PluginDeviceSecretIndexSchema.parse({
    schema: 'axiom.plugin-device-secret-index',
    schemaVersion: 1,
    pluginId,
    revision: 0,
    entries: {},
});

export function readPluginDeviceSetting(
    stateInput: unknown,
    keyInput: unknown,
): PluginDeviceSettingSnapshot | null {
    const state = PluginDeviceSettingsStateSchema.parse(stateInput);
    const key = PluginStorageDocumentKeySchema.parse(keyInput);
    const document = state.documents[key];
    if (!document) return null;
    return deepFreeze(PluginDeviceSettingSnapshotSchema.parse({
        schema: 'axiom.plugin-device-setting',
        schemaVersion: 1,
        scope: PLUGIN_DEVICE_SETTINGS_SCOPE,
        namespaceRevision: state.revision,
        key,
        ...cloneJson(document),
    }));
}

export function listPluginDeviceSettings(
    stateInput: unknown,
    input: unknown,
): PluginDeviceSettingsListPage {
    const state = PluginDeviceSettingsStateSchema.parse(stateInput);
    const request = parsePluginDeviceSettingsListRequest(input);
    const offset = cursorOffset(request.cursor, state.revision, request.prefix);
    const matching = Object.entries(state.documents)
        .filter(([key]) => key.startsWith(request.prefix))
        .sort(([left], [right]) => left.localeCompare(right));
    if (offset > matching.length) throw new PluginDeviceStorageCursorError();
    const items = matching.slice(offset, offset + request.limit).map(([key, document]) => (
        PluginDeviceSettingMetadataSchema.parse({
            key,
            documentVersion: document.documentVersion,
            updatedAt: document.updatedAt,
            valueBytes: byteLength(document.value),
        })
    ));
    const nextOffset = offset + items.length;
    return deepFreeze(PluginDeviceSettingsListPageSchema.parse({
        schema: 'axiom.plugin-device-settings-list-page',
        schemaVersion: 1,
        scope: PLUGIN_DEVICE_SETTINGS_SCOPE,
        namespaceRevision: state.revision,
        prefix: request.prefix,
        items,
        nextCursor: nextOffset < matching.length
            ? `v1:${state.revision}:${nextOffset}:${prefixFingerprint(request.prefix)}`
            : null,
    }));
}

export function getPluginDeviceSettingsUsage(stateInput: unknown): PluginDeviceSettingsUsage {
    const state = PluginDeviceSettingsStateSchema.parse(stateInput);
    return deepFreeze(PluginDeviceSettingsUsageSchema.parse({
        schema: 'axiom.plugin-device-settings-usage',
        schemaVersion: 1,
        scope: PLUGIN_DEVICE_SETTINGS_SCOPE,
        namespaceRevision: state.revision,
        usedBytes: byteLength(state),
        limitBytes: MAX_PLUGIN_DEVICE_SETTINGS_BYTES,
        documentCount: Object.keys(state.documents).length,
        documentLimit: MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS,
        maxDocumentBytes: MAX_PLUGIN_DEVICE_SETTING_BYTES,
        maxTransactionOperations: MAX_PLUGIN_DEVICE_SETTINGS_TRANSACTION_OPERATIONS,
        exportedWithPortfolio: false,
        backedUpByAxiom: false,
    }));
}

export function transactPluginDeviceSettings(
    stateInput: unknown,
    input: unknown,
    now: string,
): { readonly state: PluginDeviceSettingsState; readonly result: PluginDeviceSettingsTransactionResult } {
    const state = PluginDeviceSettingsStateSchema.parse(stateInput);
    const transaction = parsePluginDeviceSettingsTransaction(input);
    if (transaction.expectedNamespaceRevision !== state.revision) {
        throw new PluginDeviceStorageRevisionConflictError(
            transaction.expectedNamespaceRevision,
            state.revision,
        );
    }
    TimestampSchema.parse(now);
    const documents = cloneJson(state.documents);
    let changed = false;
    const operations = transaction.operations.map(operation => {
        const existing = documents[operation.key];
        const actualVersion = existing?.documentVersion ?? null;
        if (actualVersion !== operation.expectedDocumentVersion) {
            throw new PluginDeviceDocumentConflictError(
                operation.key,
                operation.expectedDocumentVersion,
                actualVersion,
            );
        }
        if (operation.kind === 'delete') {
            if (existing) {
                delete documents[operation.key];
                changed = true;
            }
            return {
                operationId: operation.operationId,
                key: operation.key,
                documentVersion: null,
            };
        }
        const documentVersion = (existing?.documentVersion || 0) + 1;
        documents[operation.key] = {
            documentVersion,
            updatedAt: now,
            value: cloneJson(operation.value),
        };
        changed = true;
        return { operationId: operation.operationId, key: operation.key, documentVersion };
    });
    if (Object.keys(documents).length > MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS) {
        throw new PluginDeviceStorageQuotaError();
    }
    const nextStateInput = {
        ...state,
        revision: changed ? state.revision + 1 : state.revision,
        documents,
    };
    if (byteLength(nextStateInput) > MAX_PLUGIN_DEVICE_SETTINGS_BYTES) {
        throw new PluginDeviceStorageQuotaError();
    }
    const nextState = PluginDeviceSettingsStateSchema.parse(nextStateInput);
    return deepFreeze({
        state: nextState,
        result: PluginDeviceSettingsTransactionResultSchema.parse({
            schema: 'axiom.plugin-device-settings-transaction-result',
            schemaVersion: 1,
            scope: PLUGIN_DEVICE_SETTINGS_SCOPE,
            namespaceRevision: nextState.revision,
            operations,
        }),
    });
}

export function listPluginDeviceSecrets(
    indexInput: unknown,
    input: unknown,
): PluginDeviceSecretsListPage {
    const index = PluginDeviceSecretIndexSchema.parse(indexInput);
    const request = parsePluginDeviceSecretsListRequest(input);
    const offset = cursorOffset(request.cursor, index.revision, request.prefix);
    const matching = Object.entries(index.entries)
        .filter(([key]) => key.startsWith(request.prefix))
        .sort(([left], [right]) => left.localeCompare(right));
    if (offset > matching.length) throw new PluginDeviceStorageCursorError();
    const items = matching.slice(offset, offset + request.limit).map(([key, metadata]) => ({
        key,
        ...metadata,
    }));
    const nextOffset = offset + items.length;
    return deepFreeze(PluginDeviceSecretsListPageSchema.parse({
        schema: 'axiom.plugin-device-secrets-list-page',
        schemaVersion: 1,
        scope: PLUGIN_DEVICE_SECRETS_SCOPE,
        namespaceRevision: index.revision,
        prefix: request.prefix,
        items,
        nextCursor: nextOffset < matching.length
            ? `v1:${index.revision}:${nextOffset}:${prefixFingerprint(request.prefix)}`
            : null,
    }));
}

export function getPluginDeviceSecretsUsage(indexInput: unknown): PluginDeviceSecretsUsage {
    const index = PluginDeviceSecretIndexSchema.parse(indexInput);
    return deepFreeze(PluginDeviceSecretsUsageSchema.parse({
        schema: 'axiom.plugin-device-secrets-usage',
        schemaVersion: 1,
        scope: PLUGIN_DEVICE_SECRETS_SCOPE,
        namespaceRevision: index.revision,
        secretCount: Object.keys(index.entries).length,
        secretLimit: MAX_PLUGIN_DEVICE_SECRETS,
        maxSecretBytes: MAX_PLUGIN_DEVICE_SECRET_BYTES,
        provider: 'os-credential-store',
        exportedWithPortfolio: false,
        backedUpByAxiom: false,
    }));
}

export function createMemoryPluginDeviceStorageBroker(
    clock: () => Date = () => new Date(),
): PluginDeviceStorageBroker {
    const settings = new Map<string, PluginDeviceSettingsState>();
    const indexes = new Map<string, PluginDeviceSecretIndex>();
    const values = new Map<string, Map<string, string>>();
    const getSettings = (pluginId: string) => settings.get(pluginId)
        || createEmptyPluginDeviceSettingsState(pluginId);
    const getIndex = (pluginId: string) => indexes.get(pluginId)
        || createEmptyPluginDeviceSecretIndex(pluginId);
    const getValues = (pluginId: string) => {
        const existing = values.get(pluginId);
        if (existing) return existing;
        const created = new Map<string, string>();
        values.set(pluginId, created);
        return created;
    };

    return {
        settings: {
            get: async (pluginId, key) => readPluginDeviceSetting(getSettings(pluginId), key),
            list: async (pluginId, request) => listPluginDeviceSettings(
                getSettings(pluginId),
                request,
            ),
            usage: async pluginId => getPluginDeviceSettingsUsage(getSettings(pluginId)),
            transact: async (pluginId, input) => {
                const transaction = transactPluginDeviceSettings(
                    getSettings(pluginId),
                    input,
                    clock().toISOString(),
                );
                settings.set(pluginId, transaction.state);
                return transaction.result;
            },
        },
        secrets: {
            get: async (pluginId, keyInput) => {
                const key = PluginStorageDocumentKeySchema.parse(keyInput);
                const index = getIndex(pluginId);
                const metadata = index.entries[key];
                const value = getValues(pluginId).get(key);
                if (!metadata || value === undefined) return null;
                return deepFreeze(PluginDeviceSecretSnapshotSchema.parse({
                    schema: 'axiom.plugin-device-secret',
                    schemaVersion: 1,
                    scope: PLUGIN_DEVICE_SECRETS_SCOPE,
                    namespaceRevision: index.revision,
                    key,
                    ...metadata,
                    value,
                }));
            },
            list: async (pluginId, request) => listPluginDeviceSecrets(
                getIndex(pluginId),
                request,
            ),
            usage: async pluginId => getPluginDeviceSecretsUsage(getIndex(pluginId)),
            set: async (pluginId, input) => {
                const request = parsePluginDeviceSecretSet(input);
                const index = getIndex(pluginId);
                const existing = index.entries[request.key];
                const actualVersion = existing?.secretVersion ?? null;
                if (actualVersion !== request.expectedSecretVersion) {
                    throw new PluginDeviceDocumentConflictError(
                        request.key,
                        request.expectedSecretVersion,
                        actualVersion,
                    );
                }
                if (!existing && Object.keys(index.entries).length >= MAX_PLUGIN_DEVICE_SECRETS) {
                    throw new PluginDeviceStorageQuotaError();
                }
                if (new TextEncoder().encode(request.value).byteLength > MAX_PLUGIN_DEVICE_SECRET_BYTES) {
                    throw new PluginDeviceStorageQuotaError();
                }
                const secretVersion = (existing?.secretVersion || 0) + 1;
                const nextIndex = PluginDeviceSecretIndexSchema.parse({
                    ...index,
                    revision: index.revision + 1,
                    entries: {
                        ...index.entries,
                        [request.key]: {
                            secretVersion,
                            updatedAt: clock().toISOString(),
                        },
                    },
                });
                getValues(pluginId).set(request.key, request.value);
                indexes.set(pluginId, nextIndex);
                return deepFreeze(PluginDeviceSecretMutationResultSchema.parse({
                    schema: 'axiom.plugin-device-secret-mutation-result',
                    schemaVersion: 1,
                    scope: PLUGIN_DEVICE_SECRETS_SCOPE,
                    namespaceRevision: nextIndex.revision,
                    key: request.key,
                    secretVersion,
                }));
            },
            delete: async (pluginId, input) => {
                const request = parsePluginDeviceSecretDelete(input);
                const index = getIndex(pluginId);
                const existing = index.entries[request.key];
                const actualVersion = existing?.secretVersion ?? null;
                if (actualVersion !== request.expectedSecretVersion) {
                    throw new PluginDeviceDocumentConflictError(
                        request.key,
                        request.expectedSecretVersion,
                        actualVersion,
                    );
                }
                if (!existing) {
                    return deepFreeze(PluginDeviceSecretMutationResultSchema.parse({
                        schema: 'axiom.plugin-device-secret-mutation-result',
                        schemaVersion: 1,
                        scope: PLUGIN_DEVICE_SECRETS_SCOPE,
                        namespaceRevision: index.revision,
                        key: request.key,
                        secretVersion: null,
                    }));
                }
                const entries = { ...index.entries };
                delete entries[request.key];
                const nextIndex = PluginDeviceSecretIndexSchema.parse({
                    ...index,
                    revision: index.revision + 1,
                    entries,
                });
                getValues(pluginId).delete(request.key);
                indexes.set(pluginId, nextIndex);
                return deepFreeze(PluginDeviceSecretMutationResultSchema.parse({
                    schema: 'axiom.plugin-device-secret-mutation-result',
                    schemaVersion: 1,
                    scope: PLUGIN_DEVICE_SECRETS_SCOPE,
                    namespaceRevision: nextIndex.revision,
                    key: request.key,
                    secretVersion: null,
                }));
            },
        },
    };
}
