import { z } from 'zod';
import { PluginOwnedTypeSchema } from './identifiers';
import { JsonObjectSchema } from './semanticData';
import {
    UniversalEntityReferenceSchema,
    type UniversalEntityReference,
} from './universalReference';

export const CURRENT_PLUGIN_ENTITY_READ_SCHEMA_VERSION = 1;
export const MAX_PLUGIN_ENTITY_SNAPSHOT_BYTES = 64 * 1024;
export const MAX_PLUGIN_RELATION_PAGE_SIZE = 100;
export const MAX_PLUGIN_RELATION_MATCHES = 25_000;

const OmittedFieldSchema = z.string().trim().min(1).max(160);

export const PluginEntitySnapshotSchema = z.object({
    schema: z.literal('axiom.plugin.entity-snapshot'),
    schemaVersion: z.literal(CURRENT_PLUGIN_ENTITY_READ_SCHEMA_VERSION),
    portfolioRevision: z.number().int().nonnegative(),
    reference: UniversalEntityReferenceSchema,
    label: z.string().trim().min(1).max(500),
    fields: JsonObjectSchema,
    omittedFields: z.array(OmittedFieldSchema).max(100),
}).strict().superRefine((snapshot, context) => {
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_PLUGIN_ENTITY_SNAPSHOT_BYTES) {
        context.addIssue({
            code: 'custom',
            path: ['fields'],
            message: `Entity snapshots may be at most ${MAX_PLUGIN_ENTITY_SNAPSHOT_BYTES} bytes.`,
        });
    }
});

export const PluginRelationDirectionSchema = z.enum([
    'outgoing',
    'incoming',
    'both',
]);

export const CoreRelationKindSchema = z.string().regex(
    /^core\.relation\.[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Core relation kinds must use the core.relation.* namespace.',
);

export const PluginRelationKindSchema = z.union([
    CoreRelationKindSchema,
    PluginOwnedTypeSchema,
]);

export const PluginEntityRelationQuerySchema = z.object({
    schema: z.literal('axiom.plugin.relation-query'),
    schemaVersion: z.literal(CURRENT_PLUGIN_ENTITY_READ_SCHEMA_VERSION),
    reference: UniversalEntityReferenceSchema,
    direction: PluginRelationDirectionSchema.optional().default('both'),
    relationKinds: z.array(PluginRelationKindSchema).min(1).max(50).optional(),
    limit: z.number().int().min(1).max(MAX_PLUGIN_RELATION_PAGE_SIZE).optional().default(50),
    cursor: z.string().trim().min(1).max(120).optional(),
}).strict().superRefine((query, context) => {
    if (query.relationKinds && new Set(query.relationKinds).size !== query.relationKinds.length) {
        context.addIssue({
            code: 'custom',
            path: ['relationKinds'],
            message: 'Relation kind filters must be unique.',
        });
    }
});

export const PluginEntityRelationSchema = z.object({
    id: z.string().trim().min(1).max(1_000),
    kind: PluginRelationKindSchema,
    origin: z.enum(['core', 'semantic']),
    source: UniversalEntityReferenceSchema,
    target: UniversalEntityReferenceSchema,
    relationReference: UniversalEntityReferenceSchema.optional(),
    label: z.string().trim().min(1).max(500).optional(),
}).strict();

export const PluginEntityRelationPageSchema = z.object({
    schema: z.literal('axiom.plugin.relation-page'),
    schemaVersion: z.literal(CURRENT_PLUGIN_ENTITY_READ_SCHEMA_VERSION),
    portfolioRevision: z.number().int().nonnegative(),
    reference: UniversalEntityReferenceSchema,
    direction: PluginRelationDirectionSchema,
    items: z.array(PluginEntityRelationSchema).max(MAX_PLUGIN_RELATION_PAGE_SIZE),
    nextCursor: z.string().max(120).nullable(),
    truncated: z.boolean(),
}).strict();

export type PluginEntitySnapshot = z.infer<typeof PluginEntitySnapshotSchema>;
export type PluginRelationDirection = z.infer<typeof PluginRelationDirectionSchema>;
export type PluginRelationKind = z.infer<typeof PluginRelationKindSchema>;
export type PluginEntityRelationQueryInput = z.input<typeof PluginEntityRelationQuerySchema>;
export type PluginEntityRelationQuery = z.infer<typeof PluginEntityRelationQuerySchema>;
export type PluginEntityRelation = z.infer<typeof PluginEntityRelationSchema>;
export type PluginEntityRelationPage = z.infer<typeof PluginEntityRelationPageSchema>;

export class PluginEntityReadContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_READ_CONTRACT' | 'UNSUPPORTED_READ_CONTRACT_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginEntityReadContractError';
    }
}

export class PluginRelationCursorError extends Error {
    readonly code = 'PLUGIN_RELATION_CURSOR_INVALID';

    constructor(
        message: string,
        readonly cursor: string,
    ) {
        super(message);
        this.name = 'PluginRelationCursorError';
    }
}

const futureVersion = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const version = (value as Record<string, unknown>).schemaVersion;
    return typeof version === 'number' && version > CURRENT_PLUGIN_ENTITY_READ_SCHEMA_VERSION;
};

export function parsePluginEntityRelationQuery(value: unknown): PluginEntityRelationQuery {
    if (futureVersion(value)) {
        throw new PluginEntityReadContractError(
            'Relation query uses a newer unsupported schema version.',
            'UNSUPPORTED_READ_CONTRACT_VERSION',
        );
    }
    const result = PluginEntityRelationQuerySchema.safeParse(value);
    if (!result.success) {
        throw new PluginEntityReadContractError(
            'Plugin relation query validation failed.',
            'INVALID_READ_CONTRACT',
            result.error.issues,
        );
    }
    return result.data;
}

export const sameEntityIdentity = (
    left: UniversalEntityReference,
    right: UniversalEntityReference,
): boolean => left.kind === right.kind && left.id === right.id;
