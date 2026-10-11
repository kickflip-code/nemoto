import { z } from 'zod';
import {
    getOwningPluginId,
    PluginIdSchema,
    PluginOwnedTypeSchema,
    SemanticVersionSchema,
    StableContractIdSchema,
} from './identifiers';
import { UniversalEntityReferenceSchema } from './universalReference';

export const CURRENT_SEMANTIC_DATA_SCHEMA_VERSION = 1;

const IsoTimestampSchema = z.string().trim().refine(
    value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
    'Timestamps must be valid ISO 8601 values with an explicit timezone.',
);

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isBoundedJsonValue = (root: unknown): root is JsonValue => {
    const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
    const seen = new WeakSet<object>();
    let visited = 0;

    while (pending.length > 0) {
        const current = pending.pop()!;
        visited += 1;
        if (visited > 10_000 || current.depth > 16) return false;

        if (current.value === null || typeof current.value === 'boolean') continue;
        if (typeof current.value === 'number') {
            if (!Number.isFinite(current.value)) return false;
            continue;
        }
        if (typeof current.value === 'string') {
            if (current.value.length > 100_000) return false;
            continue;
        }
        if (typeof current.value !== 'object') return false;
        if (seen.has(current.value)) return false;
        seen.add(current.value);

        if (Array.isArray(current.value)) {
            if (current.value.length > 1_000) return false;
            current.value.forEach(value => pending.push({ value, depth: current.depth + 1 }));
            continue;
        }

        const prototype = Object.getPrototypeOf(current.value);
        if (prototype !== Object.prototype && prototype !== null) return false;
        const entries = Object.entries(current.value);
        if (Reflect.ownKeys(current.value).length !== entries.length) return false;
        if (entries.length > 500) return false;
        for (const [key, value] of entries) {
            if (key.length === 0 || key.length > 160 || UNSAFE_JSON_KEYS.has(key)) return false;
            pending.push({ value, depth: current.depth + 1 });
        }
    }

    return true;
};

export const JsonValueSchema = z.custom<JsonValue>(
    isBoundedJsonValue,
    'Values must be bounded, acyclic JSON data.',
);

export const JsonObjectSchema = z.record(
    z.string().min(1).max(160),
    JsonValueSchema,
).superRefine((value, context) => {
    if (!isBoundedJsonValue(value)) {
        context.addIssue({
            code: 'custom',
            message: 'Semantic property bags must be bounded, acyclic JSON objects.',
        });
    }
});

export const SemanticOwnerSchema = z.object({
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    dataVersion: z.number().int().positive(),
}).strict();

const HumanProvenanceOriginSchema = z.object({
    kind: z.literal('human'),
    displayName: z.string().trim().min(1).max(160),
    actorId: StableContractIdSchema.optional(),
}).strict();

const PluginProvenanceOriginSchema = z.object({
    kind: z.literal('plugin'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    contributionId: z.string().trim().min(3).max(240).optional(),
}).strict();

const AiProvenanceOriginSchema = z.object({
    kind: z.literal('ai'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    profileId: z.string().trim().min(3).max(240),
    modelId: z.string().trim().min(1).max(240),
    runId: StableContractIdSchema,
}).strict();

const ImportProvenanceOriginSchema = z.object({
    kind: z.literal('import'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    importerId: z.string().trim().min(3).max(240),
    sourceLabel: z.string().trim().min(1).max(500),
    sourceDigest: z.string().trim().min(8).max(256).optional(),
}).strict();

const DerivedProvenanceOriginSchema = z.object({
    kind: z.literal('derived'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    methodId: z.string().trim().min(3).max(240),
}).strict();

export const ProvenanceOriginSchema = z.discriminatedUnion('kind', [
    HumanProvenanceOriginSchema,
    PluginProvenanceOriginSchema,
    AiProvenanceOriginSchema,
    ImportProvenanceOriginSchema,
    DerivedProvenanceOriginSchema,
]);

export const SourceCitationSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('entity'),
        reference: UniversalEntityReferenceSchema,
        note: z.string().trim().min(1).max(1_000).optional(),
    }).strict(),
    z.object({
        kind: z.literal('external'),
        sourceId: StableContractIdSchema,
        label: z.string().trim().min(1).max(500),
        locator: z.string().trim().min(1).max(2_000).optional(),
        digest: z.string().trim().min(8).max(256).optional(),
    }).strict(),
]);

export const SemanticAssertionClassSchema = z.enum([
    'recorded-fact',
    'imported-claim',
    'human-assessment',
    'derived-result',
    'ai-suggestion',
]);

const ALLOWED_ORIGINS_BY_ASSERTION: Record<
    z.infer<typeof SemanticAssertionClassSchema>,
    Array<z.infer<typeof ProvenanceOriginSchema>['kind']>
> = {
    'recorded-fact': ['human', 'plugin'],
    'imported-claim': ['import'],
    'human-assessment': ['human'],
    'derived-result': ['derived'],
    'ai-suggestion': ['ai'],
};

export const ProvenanceSchema = z.object({
    assertion: SemanticAssertionClassSchema,
    origin: ProvenanceOriginSchema,
    recordedAt: IsoTimestampSchema,
    sources: z.array(SourceCitationSchema).max(200).optional().default([]),
    confidence: z.object({
        value: z.number().min(0).max(1),
        rationale: z.string().trim().min(1).max(2_000).optional(),
    }).strict().optional(),
}).strict().superRefine((provenance, context) => {
    const allowedOrigins = ALLOWED_ORIGINS_BY_ASSERTION[provenance.assertion];
    if (!allowedOrigins.includes(provenance.origin.kind)) {
        context.addIssue({
            code: 'custom',
            path: ['origin', 'kind'],
            message: `${provenance.assertion} provenance requires one of: ${allowedOrigins.join(', ')}.`,
        });
    }
});

const semanticEnvelopeShape = {
    schemaVersion: z.literal(CURRENT_SEMANTIC_DATA_SCHEMA_VERSION),
    id: StableContractIdSchema,
    type: PluginOwnedTypeSchema,
    owner: SemanticOwnerSchema,
    properties: JsonObjectSchema,
    provenance: ProvenanceSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
};

const envelopeIssues = (value: {
    type: string;
    owner: z.infer<typeof SemanticOwnerSchema>;
    provenance: z.infer<typeof ProvenanceSchema>;
    createdAt: string;
    updatedAt: string;
}) => {
    const issues: Array<{ path: Array<string>; message: string }> = [];
    if (getOwningPluginId(value.type) !== value.owner.pluginId) {
        issues.push({
            path: ['owner', 'pluginId'],
            message: 'The semantic type must be owned by the declared plugin.',
        });
    }
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
        issues.push({
            path: ['updatedAt'],
            message: 'updatedAt cannot be earlier than createdAt.',
        });
    }
    if ('pluginId' in value.provenance.origin
        && value.provenance.origin.pluginId !== value.owner.pluginId) {
        issues.push({
            path: ['provenance', 'origin', 'pluginId'],
            message: 'Plugin-shaped provenance must match the semantic owner.',
        });
    }
    if ('pluginVersion' in value.provenance.origin
        && value.provenance.origin.pluginVersion !== value.owner.pluginVersion) {
        issues.push({
            path: ['provenance', 'origin', 'pluginVersion'],
            message: 'Plugin-shaped provenance must match the semantic owner version.',
        });
    }
    return issues;
};

export const SemanticRecordSchema = z.object({
    schema: z.literal('axiom.semantic-record'),
    ...semanticEnvelopeShape,
    label: z.string().trim().min(1).max(500),
}).strict().superRefine((value, context) => {
    envelopeIssues(value).forEach(issue => context.addIssue({ code: 'custom', ...issue }));
});

export const SemanticRelationSchema = z.object({
    schema: z.literal('axiom.semantic-relation'),
    ...semanticEnvelopeShape,
    source: UniversalEntityReferenceSchema,
    target: UniversalEntityReferenceSchema,
}).strict().superRefine((value, context) => {
    envelopeIssues(value).forEach(issue => context.addIssue({ code: 'custom', ...issue }));
});

export const SemanticAnnotationSchema = z.object({
    schema: z.literal('axiom.semantic-annotation'),
    ...semanticEnvelopeShape,
    target: UniversalEntityReferenceSchema,
}).strict().superRefine((value, context) => {
    envelopeIssues(value).forEach(issue => context.addIssue({ code: 'custom', ...issue }));
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type SemanticAnnotation = z.infer<typeof SemanticAnnotationSchema>;
export type SemanticOwner = z.infer<typeof SemanticOwnerSchema>;
export type SemanticRecord = z.infer<typeof SemanticRecordSchema>;
export type SemanticRelation = z.infer<typeof SemanticRelationSchema>;
export type SourceCitation = z.infer<typeof SourceCitationSchema>;

export class SemanticDataContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_SEMANTIC_DATA' | 'UNSUPPORTED_SCHEMA_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'SemanticDataContractError';
    }
}

const parseSemanticEnvelope = <T>(
    value: unknown,
    schema: z.ZodType<T>,
    label: string,
): T => {
    const schemaVersion = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).schemaVersion
        : undefined;
    if (typeof schemaVersion === 'number'
        && schemaVersion > CURRENT_SEMANTIC_DATA_SCHEMA_VERSION) {
        throw new SemanticDataContractError(
            `${label} uses a newer unsupported schema version.`,
            'UNSUPPORTED_SCHEMA_VERSION',
        );
    }

    const result = schema.safeParse(value);
    if (!result.success) {
        throw new SemanticDataContractError(
            `${label} validation failed.`,
            'INVALID_SEMANTIC_DATA',
            result.error.issues,
        );
    }
    return result.data;
};

export const parseSemanticRecord = (value: unknown): SemanticRecord => (
    parseSemanticEnvelope(value, SemanticRecordSchema, 'Semantic record')
);

export const parseSemanticRelation = (value: unknown): SemanticRelation => (
    parseSemanticEnvelope(value, SemanticRelationSchema, 'Semantic relation')
);

export const parseSemanticAnnotation = (value: unknown): SemanticAnnotation => (
    parseSemanticEnvelope(value, SemanticAnnotationSchema, 'Semantic annotation')
);
