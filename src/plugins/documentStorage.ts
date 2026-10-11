import type { Portfolio } from '../types';
import { isPortableRecord, PortablePluginRecordSchema } from './portableRecords';
import {
    PluginDataEnvelopeSchema,
    parsePluginDataEnvelope,
    type PluginDataEnvelope,
    type StoredPluginDocument,
} from './collectionStorage';
import {
    MAX_PLUGIN_DATA_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENT_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENTS,
    MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS,
    PLUGIN_STORAGE_SCOPE,
    PluginStorageDataError,
    PluginStorageCursorError,
    PluginStorageDocumentConflictError,
    PluginStorageDocumentMetadataSchema,
    PluginStorageDocumentSnapshotSchema,
    PluginStorageListPageSchema,
    PluginStorageQuotaError,
    PluginStorageTransactionResultSchema,
    PluginStorageUsageSchema,
    parsePluginStorageDocumentKey,
    parsePluginStorageListRequest,
    parsePluginStorageTransaction,
    type PluginStorageDocumentSnapshot,
    type PluginStorageListPage,
    type PluginStorageListRequestInput,
    type PluginStorageOperationResult,
    type PluginStorageUsage,
} from './storageContracts';

const CURSOR_PATTERN = /^v1:(\d+):(\d+):([a-f0-9]{8})$/;

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

const byteLength = (value: unknown): number => (
    new TextEncoder().encode(JSON.stringify(value)).byteLength
);

const requireEnvelope = (portfolio: Portfolio, pluginId: string): PluginDataEnvelope => {
    const envelope = parsePluginDataEnvelope(portfolio, pluginId);
    if (!envelope) throw new PluginStorageDataError();
    return envelope;
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
    portfolioRevision: number,
    prefix: string,
): number => {
    if (!cursor) return 0;
    const match = CURSOR_PATTERN.exec(cursor);
    if (!match) throw new PluginStorageCursorError(cursor);
    const cursorRevision = Number(match[1]);
    const offset = Number(match[2]);
    if (
        cursorRevision !== portfolioRevision
        || match[3] !== prefixFingerprint(prefix)
        || !Number.isSafeInteger(offset)
        || offset < 0
    ) throw new PluginStorageCursorError(cursor);
    return offset;
};

export function readPluginDocument(
    portfolio: Portfolio,
    pluginId: string,
    keyInput: unknown,
    portfolioRevision: number,
): PluginStorageDocumentSnapshot | null {
    const key = parsePluginStorageDocumentKey(keyInput);
    const document = requireEnvelope(portfolio, pluginId).documents[key];
    if (!document) return null;
    return deepFreeze(PluginStorageDocumentSnapshotSchema.parse({
        schema: 'axiom.plugin-storage-document',
        schemaVersion: 1,
        scope: PLUGIN_STORAGE_SCOPE,
        portfolioRevision,
        key,
        documentVersion: document.documentVersion,
        value: cloneJson(document.value),
    }));
}

export function listPluginDocuments(
    portfolio: Portfolio,
    pluginId: string,
    input: PluginStorageListRequestInput,
    portfolioRevision: number,
): PluginStorageListPage {
    const request = parsePluginStorageListRequest(input);
    const envelope = requireEnvelope(portfolio, pluginId);
    const offset = cursorOffset(request.cursor, portfolioRevision, request.prefix);
    const matching = Object.entries(envelope.documents)
        .filter(([key]) => key.startsWith(request.prefix))
        .sort(([left], [right]) => left.localeCompare(right));
    if (offset > matching.length) throw new PluginStorageCursorError(request.cursor!);
    const items = matching.slice(offset, offset + request.limit).map(([key, document]) => (
        PluginStorageDocumentMetadataSchema.parse({
            key,
            documentVersion: document.documentVersion,
            valueBytes: byteLength(document.value),
        })
    ));
    const nextOffset = offset + items.length;
    return deepFreeze(PluginStorageListPageSchema.parse({
        schema: 'axiom.plugin-storage-list-page',
        schemaVersion: 1,
        scope: PLUGIN_STORAGE_SCOPE,
        portfolioRevision,
        prefix: request.prefix,
        items,
        nextCursor: nextOffset < matching.length
            ? `v1:${portfolioRevision}:${nextOffset}:${prefixFingerprint(request.prefix)}`
            : null,
    }));
}

export function getPluginStorageUsage(
    portfolio: Portfolio,
    pluginId: string,
    portfolioRevision: number,
): PluginStorageUsage {
    const envelope = requireEnvelope(portfolio, pluginId);
    return deepFreeze(PluginStorageUsageSchema.parse({
        schema: 'axiom.plugin-storage-usage',
        schemaVersion: 1,
        scope: PLUGIN_STORAGE_SCOPE,
        portfolioRevision,
        usedBytes: byteLength(envelope),
        limitBytes: MAX_PLUGIN_DATA_BYTES,
        documentCount: Object.keys(envelope.documents).length,
        documentLimit: MAX_PLUGIN_STORAGE_DOCUMENTS,
        maxDocumentBytes: MAX_PLUGIN_STORAGE_DOCUMENT_BYTES,
        maxTransactionOperations: MAX_PLUGIN_STORAGE_TRANSACTION_OPERATIONS,
        exportedWithPortfolio: true,
    }));
}

export interface WritePluginDocumentsResult {
    readonly portfolio: Portfolio;
    readonly changed: boolean;
    readonly operations: readonly PluginStorageOperationResult[];
}

export function writePluginDocuments(
    portfolio: Portfolio,
    pluginId: string,
    input: unknown,
): WritePluginDocumentsResult {
    const transaction = parsePluginStorageTransaction(input);
    const envelope = requireEnvelope(portfolio, pluginId);
    const documents: Record<string, StoredPluginDocument> = cloneJson(envelope.documents);
    let changed = false;
    const operations = transaction.operations.map(operation => {
        const existing = documents[operation.key];
        const actualVersion = existing?.documentVersion ?? null;
        if (actualVersion !== operation.expectedDocumentVersion) {
            throw new PluginStorageDocumentConflictError(
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

        if (isPortableRecord(operation.value)) PortablePluginRecordSchema.parse(operation.value);
        const documentVersion = (existing?.documentVersion || 0) + 1;
        documents[operation.key] = {
            documentVersion,
            value: cloneJson(operation.value),
        };
        changed = true;
        return {
            operationId: operation.operationId,
            key: operation.key,
            documentVersion,
        };
    });

    if (!changed) return {
        portfolio,
        changed: false,
        operations: deepFreeze(operations),
    };

    const nextEnvelope = PluginDataEnvelopeSchema.parse({
        ...envelope,
        documents,
    });
    const recordIds = new Set<string>();
    for (const document of Object.values(nextEnvelope.documents)) {
        if (!isPortableRecord(document.value)) continue;
        const record = PortablePluginRecordSchema.parse(document.value);
        if (recordIds.has(record.id)) throw new PluginStorageDataError();
        recordIds.add(record.id);
    }
    if (byteLength(nextEnvelope) > MAX_PLUGIN_DATA_BYTES) {
        throw new PluginStorageQuotaError();
    }
    const nextPortfolio: Portfolio = {
        ...portfolio,
        extensions: {
            ...portfolio.extensions,
            [pluginId]: nextEnvelope,
        },
    };
    return {
        portfolio: nextPortfolio,
        changed: true,
        operations: deepFreeze(operations),
    };
}

export const createPluginStorageTransactionResult = (
    portfolioRevision: number,
    operations: readonly PluginStorageOperationResult[],
) => deepFreeze(PluginStorageTransactionResultSchema.parse({
    schema: 'axiom.plugin-storage-transaction-result',
    schemaVersion: 1,
    scope: PLUGIN_STORAGE_SCOPE,
    portfolioRevision,
    operations,
}));
