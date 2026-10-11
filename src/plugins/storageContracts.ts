import { z } from 'zod';
import {
    MAX_PLUGIN_DATA_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENT_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENTS,
    MAX_PLUGIN_STORAGE_LIST_PAGE_SIZE,
    MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS,
} from './pluginLimits';
import { JsonValueSchema, type JsonValue } from './semanticData';

export const CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION = 1;
export const PLUGIN_STORAGE_SCOPE = 'portfolio' as const;

export {
    MAX_PLUGIN_DATA_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENT_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENTS,
    MAX_PLUGIN_STORAGE_LIST_PAGE_SIZE,
    MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS,
};

const byteLength = (value: unknown): number => (
    new TextEncoder().encode(JSON.stringify(value)).byteLength
);

export const PluginStorageDocumentKeySchema = z.string()
    .min(1)
    .max(160)
    .regex(
        /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
        'Storage keys may contain letters, numbers, dots, underscores, slashes, and hyphens.',
    )
    .refine(key => (
        !key.endsWith('/')
        && key.split('/').every(segment => (
            segment !== ''
            && segment !== '.'
            && segment !== '..'
            && segment !== '__proto__'
            && segment !== 'constructor'
            && segment !== 'prototype'
        ))
    ), 'Storage keys must use safe non-empty path segments.');

export const PluginStorageDocumentSnapshotSchema = z.object({
    schema: z.literal('axiom.plugin-storage-document'),
    schemaVersion: z.literal(CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_STORAGE_SCOPE),
    portfolioRevision: z.number().int().nonnegative(),
    key: PluginStorageDocumentKeySchema,
    documentVersion: z.number().int().positive(),
    value: JsonValueSchema,
}).strict();

export const PluginStorageListRequestSchema = z.object({
    schema: z.literal('axiom.plugin-storage-list'),
    schemaVersion: z.literal(CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_STORAGE_SCOPE),
    prefix: z.string().max(160).optional().default(''),
    limit: z.number().int().min(1).max(MAX_PLUGIN_STORAGE_LIST_PAGE_SIZE).optional().default(50),
    cursor: z.string().trim().min(1).max(120).optional(),
}).strict();

export const PluginStorageDocumentMetadataSchema = z.object({
    key: PluginStorageDocumentKeySchema,
    documentVersion: z.number().int().positive(),
    valueBytes: z.number().int().nonnegative().max(MAX_PLUGIN_STORAGE_DOCUMENT_BYTES),
}).strict();

export const PluginStorageListPageSchema = z.object({
    schema: z.literal('axiom.plugin-storage-list-page'),
    schemaVersion: z.literal(CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_STORAGE_SCOPE),
    portfolioRevision: z.number().int().nonnegative(),
    prefix: z.string().max(160),
    items: z.array(PluginStorageDocumentMetadataSchema).max(MAX_PLUGIN_STORAGE_LIST_PAGE_SIZE),
    nextCursor: z.string().max(120).nullable(),
}).strict();

const PutOperationSchema = z.object({
    operationId: z.string().trim().min(1).max(160),
    kind: z.literal('put'),
    key: PluginStorageDocumentKeySchema,
    expectedDocumentVersion: z.number().int().positive().nullable(),
    value: JsonValueSchema,
}).strict().superRefine((operation, context) => {
    if (byteLength(operation.value) > MAX_PLUGIN_STORAGE_DOCUMENT_BYTES) {
        context.addIssue({
            code: 'custom',
            path: ['value'],
            message: `A plugin storage document may be at most ${MAX_PLUGIN_STORAGE_DOCUMENT_BYTES} bytes.`,
        });
    }
});

const DeleteOperationSchema = z.object({
    operationId: z.string().trim().min(1).max(160),
    kind: z.literal('delete'),
    key: PluginStorageDocumentKeySchema,
    expectedDocumentVersion: z.number().int().positive().nullable(),
}).strict();

export const PluginStorageTransactionSchema = z.object({
    schema: z.literal('axiom.plugin-storage-transaction'),
    schemaVersion: z.literal(CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_STORAGE_SCOPE),
    expectedPortfolioRevision: z.number().int().nonnegative(),
    operations: z.array(z.discriminatedUnion('kind', [
        PutOperationSchema,
        DeleteOperationSchema,
    ])).min(1).max(MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS),
}).strict().superRefine((transaction, context) => {
    const operationIds = new Set<string>();
    const keys = new Set<string>();
    transaction.operations.forEach((operation, index) => {
        if (operationIds.has(operation.operationId)) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index, 'operationId'],
                message: 'Storage transaction operation IDs must be unique.',
            });
        }
        if (keys.has(operation.key)) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index, 'key'],
                message: 'A storage transaction may touch each document key only once.',
            });
        }
        operationIds.add(operation.operationId);
        keys.add(operation.key);
    });
    if (byteLength(transaction) > MAX_PLUGIN_DATA_BYTES) {
        context.addIssue({
            code: 'custom',
            path: ['operations'],
            message: `A plugin storage transaction may be at most ${MAX_PLUGIN_DATA_BYTES} bytes.`,
        });
    }
});

export const PluginStorageOperationResultSchema = z.object({
    operationId: z.string().trim().min(1).max(160),
    key: PluginStorageDocumentKeySchema,
    documentVersion: z.number().int().positive().nullable(),
}).strict();

export const PluginStorageTransactionResultSchema = z.object({
    schema: z.literal('axiom.plugin-storage-transaction-result'),
    schemaVersion: z.literal(CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_STORAGE_SCOPE),
    portfolioRevision: z.number().int().nonnegative(),
    operations: z.array(PluginStorageOperationResultSchema)
        .max(MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS),
}).strict();

export const PluginStorageUsageSchema = z.object({
    schema: z.literal('axiom.plugin-storage-usage'),
    schemaVersion: z.literal(CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION),
    scope: z.literal(PLUGIN_STORAGE_SCOPE),
    portfolioRevision: z.number().int().nonnegative(),
    usedBytes: z.number().int().nonnegative(),
    limitBytes: z.literal(MAX_PLUGIN_DATA_BYTES),
    documentCount: z.number().int().nonnegative().max(MAX_PLUGIN_STORAGE_DOCUMENTS),
    documentLimit: z.literal(MAX_PLUGIN_STORAGE_DOCUMENTS),
    maxDocumentBytes: z.literal(MAX_PLUGIN_STORAGE_DOCUMENT_BYTES),
    maxTransactionOperations: z.literal(MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS),
    exportedWithPortfolio: z.literal(true),
}).strict();

export type PluginStorageDocumentKey = z.infer<typeof PluginStorageDocumentKeySchema>;
export type PluginStorageDocumentSnapshot = z.infer<typeof PluginStorageDocumentSnapshotSchema>;
export type PluginStorageListRequestInput = z.input<typeof PluginStorageListRequestSchema>;
export type PluginStorageListRequest = z.infer<typeof PluginStorageListRequestSchema>;
export type PluginStorageDocumentMetadata = z.infer<typeof PluginStorageDocumentMetadataSchema>;
export type PluginStorageListPage = z.infer<typeof PluginStorageListPageSchema>;
export type PluginStorageTransactionInput = z.input<typeof PluginStorageTransactionSchema>;
export type PluginStorageTransaction = z.infer<typeof PluginStorageTransactionSchema>;
export type PluginStorageOperationResult = z.infer<typeof PluginStorageOperationResultSchema>;
export type PluginStorageTransactionResult = z.infer<typeof PluginStorageTransactionResultSchema>;
export type PluginStorageUsage = z.infer<typeof PluginStorageUsageSchema>;

export class PluginStorageContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_STORAGE_CONTRACT' | 'UNSUPPORTED_STORAGE_CONTRACT_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginStorageContractError';
    }
}

const futureVersion = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const version = (value as Record<string, unknown>).schemaVersion;
    return typeof version === 'number' && version > CURRENT_PLUGIN_STORAGE_SCHEMA_VERSION;
};

const parseContract = <T>(
    value: unknown,
    schema: z.ZodType<T>,
    label: string,
): T => {
    if (futureVersion(value)) {
        throw new PluginStorageContractError(
            `${label} uses a newer unsupported schema version.`,
            'UNSUPPORTED_STORAGE_CONTRACT_VERSION',
        );
    }
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new PluginStorageContractError(
            `${label} validation failed.`,
            'INVALID_STORAGE_CONTRACT',
            result.error.issues,
        );
    }
    return result.data;
};

export const parsePluginStorageDocumentKey = (value: unknown): PluginStorageDocumentKey => {
    const result = PluginStorageDocumentKeySchema.safeParse(value);
    if (!result.success) {
        throw new PluginStorageContractError(
            'Plugin storage document key validation failed.',
            'INVALID_STORAGE_CONTRACT',
            result.error.issues,
        );
    }
    return result.data;
};

export const parsePluginStorageListRequest = (value: unknown): PluginStorageListRequest => (
    parseContract(value, PluginStorageListRequestSchema, 'Plugin storage list request')
);

export const parsePluginStorageTransaction = (value: unknown): PluginStorageTransaction => (
    parseContract(value, PluginStorageTransactionSchema, 'Plugin storage transaction')
);

export class PluginStorageDocumentConflictError extends Error {
    readonly code = 'PLUGIN_STORAGE_DOCUMENT_CONFLICT';

    constructor(
        readonly key: string,
        readonly expectedDocumentVersion: number | null,
        readonly actualDocumentVersion: number | null,
    ) {
        super(
            `Plugin storage document '${key}' changed from version ${expectedDocumentVersion ?? 'missing'} to ${actualDocumentVersion ?? 'missing'}.`,
        );
        this.name = 'PluginStorageDocumentConflictError';
    }
}

export class PluginStorageDataError extends Error {
    readonly code = 'PLUGIN_STORAGE_DATA_INVALID';

    constructor() {
        super('Existing plugin data is invalid and was left untouched.');
        this.name = 'PluginStorageDataError';
    }
}

export class PluginStorageCursorError extends Error {
    readonly code = 'PLUGIN_STORAGE_CURSOR_INVALID';

    constructor(readonly cursor: string) {
        super('Plugin storage cursor is invalid or stale. Restart the list request.');
        this.name = 'PluginStorageCursorError';
    }
}

export class PluginStorageQuotaError extends Error {
    readonly code = 'PLUGIN_STORAGE_QUOTA_EXCEEDED';

    constructor(readonly limitBytes: number = MAX_PLUGIN_DATA_BYTES) {
        super(`This plugin has reached its ${Math.floor(limitBytes / (1024 * 1024))} MB portfolio storage limit.`);
        this.name = 'PluginStorageQuotaError';
    }
}

export type { JsonValue };
