import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from './semanticData';
import { PluginStorageDocumentKeySchema } from './storageContracts';

export const CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION = 1;
export const MAX_PLUGIN_DEVICE_SETTINGS_BYTES = 1024 * 1024;
export const MAX_PLUGIN_DEVICE_SETTING_BYTES = 128 * 1024;
export const MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS = 500;
export const MAX_PLUGIN_DEVICE_SETTINGS_TRANSACTION_OPERATIONS = 50;
export const MAX_PLUGIN_DEVICE_STORAGE_LIST_PAGE_SIZE = 100;
export const MAX_PLUGIN_DEVICE_SECRET_BYTES = 2_048;
export const MAX_PLUGIN_DEVICE_SECRETS = 64;

export const PLUGIN_DEVICE_SETTINGS_SCOPE = 'device-settings' as const;
export const PLUGIN_DEVICE_SECRETS_SCOPE = 'device-secrets' as const;

const byteLength = (value: unknown): number => (
    new TextEncoder().encode(JSON.stringify(value)).byteLength
);

const TimestampSchema = z.string().datetime({ offset: true });

export const PluginDeviceSettingSnapshotSchema = z.object({
    schema: z.literal('axiom.plugin-device-setting'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SETTINGS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    key: PluginStorageDocumentKeySchema,
    documentVersion: z.number().int().positive(),
    updatedAt: TimestampSchema,
    value: JsonValueSchema,
}).strict();

const DeviceStorageListRequestBaseSchema = z.object({
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    prefix: z.string().max(160).optional().default(''),
    limit: z.number().int().min(1).max(MAX_PLUGIN_DEVICE_STORAGE_LIST_PAGE_SIZE)
        .optional().default(50),
    cursor: z.string().trim().min(1).max(160).optional(),
}).strict();

export const PluginDeviceSettingsListRequestSchema = DeviceStorageListRequestBaseSchema.extend({
    schema: z.literal('axiom.plugin-device-settings-list'),
    scope: z.literal(PLUGIN_DEVICE_SETTINGS_SCOPE),
}).strict();

export const PluginDeviceSettingMetadataSchema = z.object({
    key: PluginStorageDocumentKeySchema,
    documentVersion: z.number().int().positive(),
    updatedAt: TimestampSchema,
    valueBytes: z.number().int().nonnegative().max(MAX_PLUGIN_DEVICE_SETTING_BYTES),
}).strict();

export const PluginDeviceSettingsListPageSchema = z.object({
    schema: z.literal('axiom.plugin-device-settings-list-page'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SETTINGS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    prefix: z.string().max(160),
    items: z.array(PluginDeviceSettingMetadataSchema)
        .max(MAX_PLUGIN_DEVICE_STORAGE_LIST_PAGE_SIZE),
    nextCursor: z.string().max(160).nullable(),
}).strict();

const DeviceSettingPutOperationSchema = z.object({
    operationId: z.string().trim().min(1).max(160),
    kind: z.literal('put'),
    key: PluginStorageDocumentKeySchema,
    expectedDocumentVersion: z.number().int().positive().nullable(),
    value: JsonValueSchema,
}).strict().superRefine((operation, context) => {
    if (byteLength(operation.value) > MAX_PLUGIN_DEVICE_SETTING_BYTES) {
        context.addIssue({
            code: 'custom',
            path: ['value'],
            message: `A device setting may be at most ${MAX_PLUGIN_DEVICE_SETTING_BYTES} bytes.`,
        });
    }
});

const DeviceSettingDeleteOperationSchema = z.object({
    operationId: z.string().trim().min(1).max(160),
    kind: z.literal('delete'),
    key: PluginStorageDocumentKeySchema,
    expectedDocumentVersion: z.number().int().positive().nullable(),
}).strict();

export const PluginDeviceSettingsTransactionSchema = z.object({
    schema: z.literal('axiom.plugin-device-settings-transaction'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SETTINGS_SCOPE),
    expectedNamespaceRevision: z.number().int().nonnegative(),
    operations: z.array(z.discriminatedUnion('kind', [
        DeviceSettingPutOperationSchema,
        DeviceSettingDeleteOperationSchema,
    ])).min(1).max(MAX_PLUGIN_DEVICE_SETTINGS_TRANSACTION_OPERATIONS),
}).strict().superRefine((transaction, context) => {
    const operationIds = new Set<string>();
    const keys = new Set<string>();
    transaction.operations.forEach((operation, index) => {
        if (operationIds.has(operation.operationId)) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index, 'operationId'],
                message: 'Device-setting operation IDs must be unique.',
            });
        }
        if (keys.has(operation.key)) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index, 'key'],
                message: 'A transaction may touch each device-setting key only once.',
            });
        }
        operationIds.add(operation.operationId);
        keys.add(operation.key);
    });
});

export const PluginDeviceSettingOperationResultSchema = z.object({
    operationId: z.string().trim().min(1).max(160),
    key: PluginStorageDocumentKeySchema,
    documentVersion: z.number().int().positive().nullable(),
}).strict();

export const PluginDeviceSettingsTransactionResultSchema = z.object({
    schema: z.literal('axiom.plugin-device-settings-transaction-result'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SETTINGS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    operations: z.array(PluginDeviceSettingOperationResultSchema)
        .max(MAX_PLUGIN_DEVICE_SETTINGS_TRANSACTION_OPERATIONS),
}).strict();

export const PluginDeviceSettingsUsageSchema = z.object({
    schema: z.literal('axiom.plugin-device-settings-usage'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SETTINGS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    usedBytes: z.number().int().nonnegative(),
    limitBytes: z.literal(MAX_PLUGIN_DEVICE_SETTINGS_BYTES),
    documentCount: z.number().int().nonnegative().max(MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS),
    documentLimit: z.literal(MAX_PLUGIN_DEVICE_SETTINGS_DOCUMENTS),
    maxDocumentBytes: z.literal(MAX_PLUGIN_DEVICE_SETTING_BYTES),
    maxTransactionOperations: z.literal(MAX_PLUGIN_DEVICE_SETTINGS_TRANSACTION_OPERATIONS),
    exportedWithPortfolio: z.literal(false),
    backedUpByAxiom: z.literal(false),
}).strict();

export const PluginDeviceSecretSnapshotSchema = z.object({
    schema: z.literal('axiom.plugin-device-secret'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    key: PluginStorageDocumentKeySchema,
    secretVersion: z.number().int().positive(),
    updatedAt: TimestampSchema,
    value: z.string().min(1).superRefine((value, context) => {
        if (new TextEncoder().encode(value).byteLength > MAX_PLUGIN_DEVICE_SECRET_BYTES) {
            context.addIssue({
                code: 'custom',
                message: `A device secret may be at most ${MAX_PLUGIN_DEVICE_SECRET_BYTES} bytes.`,
            });
        }
    }),
}).strict();

export const PluginDeviceSecretsListRequestSchema = DeviceStorageListRequestBaseSchema.extend({
    schema: z.literal('axiom.plugin-device-secrets-list'),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
}).strict();

export const PluginDeviceSecretMetadataSchema = z.object({
    key: PluginStorageDocumentKeySchema,
    secretVersion: z.number().int().positive(),
    updatedAt: TimestampSchema,
}).strict();

export const PluginDeviceSecretsListPageSchema = z.object({
    schema: z.literal('axiom.plugin-device-secrets-list-page'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    prefix: z.string().max(160),
    items: z.array(PluginDeviceSecretMetadataSchema)
        .max(MAX_PLUGIN_DEVICE_STORAGE_LIST_PAGE_SIZE),
    nextCursor: z.string().max(160).nullable(),
}).strict();

export const PluginDeviceSecretSetSchema = z.object({
    schema: z.literal('axiom.plugin-device-secret-set'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
    key: PluginStorageDocumentKeySchema,
    expectedSecretVersion: z.number().int().positive().nullable(),
    value: z.string().min(1).superRefine((value, context) => {
        if (new TextEncoder().encode(value).byteLength > MAX_PLUGIN_DEVICE_SECRET_BYTES) {
            context.addIssue({
                code: 'custom',
                message: `A device secret may be at most ${MAX_PLUGIN_DEVICE_SECRET_BYTES} bytes.`,
            });
        }
    }),
}).strict();

export const PluginDeviceSecretDeleteSchema = z.object({
    schema: z.literal('axiom.plugin-device-secret-delete'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
    key: PluginStorageDocumentKeySchema,
    expectedSecretVersion: z.number().int().positive().nullable(),
}).strict();

export const PluginDeviceSecretMutationResultSchema = z.object({
    schema: z.literal('axiom.plugin-device-secret-mutation-result'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    key: PluginStorageDocumentKeySchema,
    secretVersion: z.number().int().positive().nullable(),
}).strict();

export const PluginDeviceSecretsUsageSchema = z.object({
    schema: z.literal('axiom.plugin-device-secrets-usage'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_DEVICE_SECRETS_SCOPE),
    namespaceRevision: z.number().int().nonnegative(),
    secretCount: z.number().int().nonnegative().max(MAX_PLUGIN_DEVICE_SECRETS),
    secretLimit: z.literal(MAX_PLUGIN_DEVICE_SECRETS),
    maxSecretBytes: z.literal(MAX_PLUGIN_DEVICE_SECRET_BYTES),
    provider: z.literal('os-credential-store'),
    exportedWithPortfolio: z.literal(false),
    backedUpByAxiom: z.literal(false),
}).strict();

export type PluginDeviceSettingSnapshot = z.infer<typeof PluginDeviceSettingSnapshotSchema>;
export type PluginDeviceSettingsListRequestInput = z.input<typeof PluginDeviceSettingsListRequestSchema>;
export type PluginDeviceSettingsListRequest = z.infer<typeof PluginDeviceSettingsListRequestSchema>;
export type PluginDeviceSettingsListPage = z.infer<typeof PluginDeviceSettingsListPageSchema>;
export type PluginDeviceSettingsTransactionInput = z.input<typeof PluginDeviceSettingsTransactionSchema>;
export type PluginDeviceSettingsTransaction = z.infer<typeof PluginDeviceSettingsTransactionSchema>;
export type PluginDeviceSettingsTransactionResult = z.infer<typeof PluginDeviceSettingsTransactionResultSchema>;
export type PluginDeviceSettingsUsage = z.infer<typeof PluginDeviceSettingsUsageSchema>;
export type PluginDeviceSecretSnapshot = z.infer<typeof PluginDeviceSecretSnapshotSchema>;
export type PluginDeviceSecretsListRequestInput = z.input<typeof PluginDeviceSecretsListRequestSchema>;
export type PluginDeviceSecretsListRequest = z.infer<typeof PluginDeviceSecretsListRequestSchema>;
export type PluginDeviceSecretsListPage = z.infer<typeof PluginDeviceSecretsListPageSchema>;
export type PluginDeviceSecretSetInput = z.input<typeof PluginDeviceSecretSetSchema>;
export type PluginDeviceSecretSet = z.infer<typeof PluginDeviceSecretSetSchema>;
export type PluginDeviceSecretDeleteInput = z.input<typeof PluginDeviceSecretDeleteSchema>;
export type PluginDeviceSecretDelete = z.infer<typeof PluginDeviceSecretDeleteSchema>;
export type PluginDeviceSecretMutationResult = z.infer<typeof PluginDeviceSecretMutationResultSchema>;
export type PluginDeviceSecretsUsage = z.infer<typeof PluginDeviceSecretsUsageSchema>;

export class PluginDeviceStorageContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_DEVICE_STORAGE_CONTRACT' | 'UNSUPPORTED_DEVICE_STORAGE_CONTRACT_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginDeviceStorageContractError';
    }
}

const parseContract = <T>(value: unknown, schema: z.ZodType<T>, label: string): T => {
    const version = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).schemaVersion
        : undefined;
    if (typeof version === 'number' && version > CURRENT_PLUGIN_DEVICE_STORAGE_SCHEMA_VERSION) {
        throw new PluginDeviceStorageContractError(
            `${label} uses a newer unsupported schema version.`,
            'UNSUPPORTED_DEVICE_STORAGE_CONTRACT_VERSION',
        );
    }
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new PluginDeviceStorageContractError(
            `${label} validation failed.`,
            'INVALID_DEVICE_STORAGE_CONTRACT',
            result.error.issues,
        );
    }
    return result.data;
};

export const parsePluginDeviceSettingsListRequest = (value: unknown) => (
    parseContract(value, PluginDeviceSettingsListRequestSchema, 'Device-settings list request')
);
export const parsePluginDeviceSecretsListRequest = (value: unknown) => (
    parseContract(value, PluginDeviceSecretsListRequestSchema, 'Device-secrets list request')
);
export const parsePluginDeviceSettingsTransaction = (value: unknown) => (
    parseContract(value, PluginDeviceSettingsTransactionSchema, 'Device-settings transaction')
);
export const parsePluginDeviceSecretSet = (value: unknown) => (
    parseContract(value, PluginDeviceSecretSetSchema, 'Device-secret set request')
);
export const parsePluginDeviceSecretDelete = (value: unknown) => (
    parseContract(value, PluginDeviceSecretDeleteSchema, 'Device-secret delete request')
);

export class PluginDeviceStorageRevisionConflictError extends Error {
    readonly code = 'PLUGIN_DEVICE_STORAGE_REVISION_CONFLICT';

    constructor(readonly expectedRevision: number, readonly actualRevision: number) {
        super(`Device storage changed from revision ${expectedRevision} to ${actualRevision}. Refresh and try again.`);
        this.name = 'PluginDeviceStorageRevisionConflictError';
    }
}

export class PluginDeviceDocumentConflictError extends Error {
    readonly code = 'PLUGIN_DEVICE_DOCUMENT_CONFLICT';

    constructor(
        readonly key: string,
        readonly expectedVersion: number | null,
        readonly actualVersion: number | null,
    ) {
        super(`Device document '${key}' changed from version ${expectedVersion ?? 'missing'} to ${actualVersion ?? 'missing'}.`);
        this.name = 'PluginDeviceDocumentConflictError';
    }
}

export class PluginDeviceStorageCursorError extends Error {
    readonly code = 'PLUGIN_DEVICE_STORAGE_CURSOR_INVALID';

    constructor() {
        super('Device-storage cursor is invalid or stale. Restart the list request.');
        this.name = 'PluginDeviceStorageCursorError';
    }
}

export class PluginDeviceStorageQuotaError extends Error {
    readonly code = 'PLUGIN_DEVICE_STORAGE_QUOTA_EXCEEDED';

    constructor() {
        super('This plugin has reached its device-local storage limit.');
        this.name = 'PluginDeviceStorageQuotaError';
    }
}

export class PluginDeviceSecretStoreError extends Error {
    readonly code = 'PLUGIN_SECRET_STORE_UNAVAILABLE';

    constructor() {
        super('The operating-system credential store is unavailable.');
        this.name = 'PluginDeviceSecretStoreError';
    }
}

export class PluginDeviceStorageDataError extends Error {
    readonly code = 'PLUGIN_DEVICE_STORAGE_DATA_INVALID';

    constructor() {
        super('Existing plugin device-local data is invalid and was left untouched.');
        this.name = 'PluginDeviceStorageDataError';
    }
}

export type { JsonValue };
