import { z } from 'zod';
import type { Portfolio } from '../types';
import type {
    PluginCollectionField,
    PluginCollectionListView,
} from './contributionSchemas';
import {
    MAX_PLUGIN_COLLECTION_ITEMS,
    MAX_PLUGIN_DATA_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENT_BYTES,
    MAX_PLUGIN_STORAGE_DOCUMENTS,
} from './pluginLimits';
import { PluginStorageDocumentKeySchema, PluginStorageQuotaError } from './storageContracts';
import { JsonValueSchema, type JsonValue } from './semanticData';
import { ContextualRecordDetailsSchema, isCalendarDate, type RecordContext } from './contextualRecords';
import type { UniversalEntityReference } from './universalReference';
import { queryCollectionItems, type PluginCollectionQuery } from './collectionQuery';

export { MAX_PLUGIN_COLLECTION_ITEMS, MAX_PLUGIN_DATA_BYTES } from './pluginLimits';

export const PluginCollectionItemSchema = z.object({
    id: z.string().trim().min(1).max(160),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    values: z.record(z.string(), z.union([z.string(), z.boolean()])),
    details: ContextualRecordDetailsSchema.optional(),
}).strict();

export const StoredPluginDocumentSchema = z.object({
    documentVersion: z.number().int().positive(),
    value: JsonValueSchema,
}).strict().superRefine((document, context) => {
    if (new TextEncoder().encode(JSON.stringify(document.value)).byteLength
        > MAX_PLUGIN_STORAGE_DOCUMENT_BYTES) {
        context.addIssue({
            code: 'custom',
            path: ['value'],
            message: `A plugin storage document may be at most ${MAX_PLUGIN_STORAGE_DOCUMENT_BYTES} bytes.`,
        });
    }
});

export const PluginDataEnvelopeSchema = z.object({
    schema: z.literal('axiom.plugin-data'),
    schemaVersion: z.literal(1),
    collections: z.record(z.string(), z.object({
        items: z.array(PluginCollectionItemSchema).max(MAX_PLUGIN_COLLECTION_ITEMS),
    }).strict()),
    documents: z.record(
        PluginStorageDocumentKeySchema,
        StoredPluginDocumentSchema,
    ).optional().default({}),
}).strict().superRefine((envelope, context) => {
    if (Object.keys(envelope.documents).length > MAX_PLUGIN_STORAGE_DOCUMENTS) {
        context.addIssue({
            code: 'custom',
            path: ['documents'],
            message: `A plugin may store at most ${MAX_PLUGIN_STORAGE_DOCUMENTS} documents.`,
        });
    }
});

export type PluginCollectionItem = z.infer<typeof PluginCollectionItemSchema>;
export type PluginDataEnvelope = z.infer<typeof PluginDataEnvelopeSchema>;
export type StoredPluginDocument = {
    documentVersion: number;
    value: JsonValue;
};

export interface ReadPluginCollectionResult {
    items: PluginCollectionItem[];
    error: string | null;
}

export type PluginCollectionTransactionOperation =
    | {
        readonly operationId: string;
        readonly kind: 'put';
        readonly item: PluginCollectionItem;
    }
    | {
        readonly operationId: string;
        readonly kind: 'delete';
        readonly itemId: string;
        readonly expectedUpdatedAt: string | null;
    };

export interface PluginCollectionPage {
    readonly totalItems?: number;
    readonly contexts?: Readonly<Record<string, RecordContext | null>>;
    readonly portfolioRevision: number;
    readonly collectionId: string;
    readonly items: readonly PluginCollectionItem[];
    readonly nextCursor: string | null;
}

export interface PluginCollectionOperationResult {
    readonly operationId: string;
    readonly itemId: string;
    readonly updatedAt: string | null;
}

export interface TransactPluginCollectionResult {
    readonly portfolio: Portfolio;
    readonly changed: boolean;
    readonly operations: readonly PluginCollectionOperationResult[];
}

export class PluginCollectionConflictError extends Error {
    readonly code = 'PLUGIN_COLLECTION_ITEM_CONFLICT';

    constructor(
        readonly itemId: string,
        readonly expectedUpdatedAt: string | null,
        readonly actualUpdatedAt: string | null,
    ) {
        super(`Plugin collection item '${itemId}' changed before the transaction could be applied.`);
        this.name = 'PluginCollectionConflictError';
    }
}

export class PluginCollectionValidationError extends Error {
    readonly code = 'PLUGIN_COLLECTION_DATA_INVALID';

    constructor(message: string) {
        super(message);
        this.name = 'PluginCollectionValidationError';
    }
}

export const createEmptyPluginDataEnvelope = (): PluginDataEnvelope => ({
    schema: 'axiom.plugin-data',
    schemaVersion: 1,
    collections: {},
    documents: {},
});

export const parsePluginDataEnvelope = (
    portfolio: Portfolio,
    pluginId: string,
): PluginDataEnvelope | null => {
    const source = portfolio.extensions?.[pluginId];
    if (source === undefined) return createEmptyPluginDataEnvelope();
    const parsed = PluginDataEnvelopeSchema.safeParse(source);
    return parsed.success ? parsed.data : null;
};

const validateValue = (
    field: PluginCollectionField,
    value: string | boolean | undefined,
): string | null => {
    if (value === undefined && !field.required) return null;
    if (field.type === 'boolean') {
        return typeof value === 'boolean' ? null : `${field.label} must be true or false.`;
    }
    if (typeof value !== 'string') return `${field.label} must be text.`;
    if (field.required && value.trim().length === 0) return `${field.label} is required.`;
    if (field.maxLength && value.length > field.maxLength) {
        return `${field.label} is longer than ${field.maxLength} characters.`;
    }
    if (field.type === 'date' && value && !isCalendarDate(value)) {
        return `${field.label} must be a valid date.`;
    }
    return null;
};

export function readPluginCollection(
    portfolio: Portfolio,
    pluginId: string,
    collectionId: string,
): ReadPluginCollectionResult {
    const source = portfolio.extensions?.[pluginId];
    if (source === undefined) return { items: [], error: null };

    const parsed = PluginDataEnvelopeSchema.safeParse(source);
    if (!parsed.success) {
        return {
            items: [],
            error: 'This plugin\'s saved data is invalid. Nemoto left it untouched.',
        };
    }

    return {
        items: parsed.data.collections[collectionId]?.items || [],
        error: null,
    };
}

const collectionCursorFingerprint = (pluginId: string, collectionId: string): string => {
    let hash = 0x811c9dc5;
    for (const character of `${pluginId}\0${collectionId}`) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const COLLECTION_CURSOR_PATTERN = /^v1:(\d+):(\d+):([a-f0-9]{8})$/;

export function readPluginCollectionPage(
    portfolio: Portfolio,
    pluginId: string,
    collectionId: string,
    portfolioRevision: number,
    cursor: string | null,
    limit: number,
    query?: PluginCollectionQuery,
    resolveContext?: (reference: UniversalEntityReference) => RecordContext | null,
): PluginCollectionPage {
    const collection = readPluginCollection(portfolio, pluginId, collectionId);
    if (collection.error) throw new Error(collection.error);
    const contexts = new Map<string, RecordContext | null>();
    const resolved = new Map<string, RecordContext | null>();
    const projected = query && resolveContext ? collection.items.map(item => {
        const context = item.details?.context;
        if (!context) return item;
        const key = JSON.stringify(context.reference);
        if (!resolved.has(key)) resolved.set(key, resolveContext(context.reference));
        const current = resolved.get(key)!;
        contexts.set(item.id, current);
        return current ? { ...item, details: { ...item.details!, context: current } } : item;
    }) : collection.items;
    const itemsInOrder = query ? queryCollectionItems(projected, query) : projected;
    const fingerprint = collectionCursorFingerprint(pluginId, collectionId + (query ? JSON.stringify(query) : ''));
    let offset = 0;
    if (cursor) {
        const match = COLLECTION_CURSOR_PATTERN.exec(cursor);
        if (!match
            || Number(match[1]) !== portfolioRevision
            || match[3] !== fingerprint) {
            throw new Error('Plugin collection cursor is invalid or stale. Restart the list request.');
        }
        offset = Number(match[2]);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > itemsInOrder.length) {
            throw new Error('Plugin collection cursor is invalid or stale. Restart the list request.');
        }
    }
    const items = structuredClone(itemsInOrder.slice(offset, offset + limit));
    const nextOffset = offset + items.length;
    return Object.freeze({
        portfolioRevision,
        collectionId,
        ...(query ? { totalItems: itemsInOrder.length } : {}),
        ...(query && resolveContext ? { contexts: Object.fromEntries(items.map(item => [item.id, contexts.get(item.id) ?? null])) } : {}),
        items: Object.freeze(items),
        nextCursor: nextOffset < itemsInOrder.length
            ? `v1:${portfolioRevision}:${nextOffset}:${fingerprint}`
            : null,
    });
}

export function transactPluginCollection(
    portfolio: Portfolio,
    pluginId: string,
    view: PluginCollectionListView,
    collectionId: string,
    operations: readonly PluginCollectionTransactionOperation[],
): TransactPluginCollectionResult {
    if (collectionId !== view.collection.id) {
        throw new PluginCollectionValidationError('The collection transaction does not match the installed storage declaration.');
    }
    if (operations.length < 1 || operations.length > 100) {
        throw new PluginCollectionValidationError('A collection transaction must contain between 1 and 100 operations.');
    }
    const operationIds = new Set<string>();
    const touchedItems = new Set<string>();
    const current = readPluginCollection(portfolio, pluginId, collectionId);
    if (current.error) throw new Error(current.error);
    const items = new Map(current.items.map(item => [item.id, structuredClone(item)]));
    let changed = false;
    const receipts = operations.map(operation => {
        const itemId = operation.kind === 'put' ? operation.item.id : operation.itemId;
        if (operationIds.has(operation.operationId)) throw new PluginCollectionValidationError('Collection transaction operation IDs must be unique.');
        if (touchedItems.has(itemId)) throw new PluginCollectionValidationError('A collection transaction may touch each item only once.');
        operationIds.add(operation.operationId);
        touchedItems.add(itemId);

        if (operation.kind === 'put') {
            const parsedResult = PluginCollectionItemSchema.safeParse(operation.item);
            if (!parsedResult.success) throw new PluginCollectionValidationError('A plugin item has an invalid structure.');
            const parsed = parsedResult.data;
            items.set(parsed.id, structuredClone(parsed));
            changed = true;
            return Object.freeze({ operationId: operation.operationId, itemId, updatedAt: parsed.updatedAt });
        }

        const existing = items.get(itemId);
        const actualUpdatedAt = existing?.updatedAt ?? null;
        if (actualUpdatedAt !== operation.expectedUpdatedAt) {
            throw new PluginCollectionConflictError(itemId, operation.expectedUpdatedAt, actualUpdatedAt);
        }
        if (existing) {
            items.delete(itemId);
            changed = true;
        }
        return Object.freeze({ operationId: operation.operationId, itemId, updatedAt: null });
    });

    if (!changed) return Object.freeze({ portfolio, changed: false, operations: Object.freeze(receipts) });
    try {
        return Object.freeze({
            portfolio: writePluginCollection(portfolio, pluginId, view, [...items.values()]),
            changed: true,
            operations: Object.freeze(receipts),
        });
    } catch (error) {
        if (error instanceof PluginStorageQuotaError) throw error;
        throw new PluginCollectionValidationError(error instanceof Error ? error.message : 'Plugin collection validation failed.');
    }
}

export function writePluginCollection(
    portfolio: Portfolio,
    pluginId: string,
    view: PluginCollectionListView,
    items: PluginCollectionItem[],
): Portfolio {
    if (items.length > MAX_PLUGIN_COLLECTION_ITEMS) {
        throw new Error(`A plugin collection may contain at most ${MAX_PLUGIN_COLLECTION_ITEMS} items.`);
    }

    const existingSource = portfolio.extensions?.[pluginId];
    const parsed = existingSource === undefined
        ? { success: true as const, data: createEmptyPluginDataEnvelope() }
        : PluginDataEnvelopeSchema.safeParse(existingSource);
    if (!parsed.success) {
        throw new Error('Existing plugin data is invalid and was left untouched.');
    }

    const allowedFields = new Map(view.collection.fields.map(field => [field.key, field]));
    const ids = new Set<string>();
    items.forEach(item => {
        if (ids.has(item.id)) throw new Error('Duplicate plugin item ID.');
        ids.add(item.id);
        const itemResult = PluginCollectionItemSchema.safeParse(item);
        if (!itemResult.success) throw new Error('A plugin item has an invalid structure.');
        if (item.updatedAt < item.createdAt) throw new Error('Invalid item timestamps.');
        if (view.contextual) {
            if (!item.details) throw new Error('Contextual records require versioned details.');
            if ((item.values[view.contextual.completionField] === true) !== (item.details.completedAt !== null)) throw new Error('Completion state and timestamp disagree.');
        } else if (item.details) throw new Error('This collection does not declare contextual records.');

        Object.keys(item.values).forEach(key => {
            if (!allowedFields.has(key)) throw new Error(`Plugin item contains undeclared field ${key}.`);
        });
        view.collection.fields.forEach(field => {
            const validationError = validateValue(field, item.values[field.key]);
            if (validationError) throw new Error(validationError);
        });
    });

    const nextEnvelope: PluginDataEnvelope = {
        ...parsed.data,
        collections: {
            ...parsed.data.collections,
            [view.collection.id]: { items },
        },
    };
    const encoded = JSON.stringify(nextEnvelope);
    if (new TextEncoder().encode(encoded).byteLength > MAX_PLUGIN_DATA_BYTES) {
        throw new PluginStorageQuotaError();
    }

    return {
        ...portfolio,
        extensions: {
            ...portfolio.extensions,
            [pluginId]: nextEnvelope,
        },
    };
}
