import { z } from 'zod';
import { PluginOwnedTypeSchema, StableContractIdSchema } from './identifiers';

export const CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION = 1;

export const CoreEntityKindSchema = z.enum([
    'core.process',
    'core.process-folder',
    'core.node',
    'core.edge',
    'core.swimlane',
    'core.asset',
    'core.asset-category',
    'core.journal-entry',
    'core.journal-notebook',
    'core.journal-folder',
    'core.tag',
    'core.incident',
    'core.finding',
]);

export const UniversalEntityKindSchema = z.union([
    CoreEntityKindSchema,
    PluginOwnedTypeSchema,
]);

export const EntityLocationHintSchema = z.object({
    processId: StableContractIdSchema.optional(),
    graphPath: z.array(StableContractIdSchema).max(64).optional(),
    incidentId: StableContractIdSchema.optional(),
}).strict().superRefine((location, context) => {
    if (location.graphPath && !location.processId) {
        context.addIssue({
            code: 'custom',
            path: ['graphPath'],
            message: 'A graph path is only meaningful together with a process ID.',
        });
    }
});

const GRAPH_OWNED_KINDS = new Set<string>([
    'core.node',
    'core.edge',
    'core.swimlane',
]);

export const UniversalEntityReferenceSchema = z.object({
    schema: z.literal('axiom.entity-reference'),
    schemaVersion: z.literal(CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION),
    kind: UniversalEntityKindSchema,
    id: StableContractIdSchema,
    location: EntityLocationHintSchema.optional(),
}).strict().superRefine((reference, context) => {
    if (GRAPH_OWNED_KINDS.has(reference.kind) && !reference.location?.processId) {
        context.addIssue({
            code: 'custom',
            path: ['location', 'processId'],
            message: `${reference.kind} references require a containing process ID.`,
        });
    }

    if (reference.kind === 'core.finding' && !reference.location?.incidentId) {
        context.addIssue({
            code: 'custom',
            path: ['location', 'incidentId'],
            message: 'core.finding references require a containing incident ID.',
        });
    }
});

export type CoreEntityKind = z.infer<typeof CoreEntityKindSchema>;
export type UniversalEntityKind = z.infer<typeof UniversalEntityKindSchema>;
export type UniversalEntityReference = z.infer<typeof UniversalEntityReferenceSchema>;

export class UniversalReferenceContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_REFERENCE' | 'UNSUPPORTED_SCHEMA_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'UniversalReferenceContractError';
    }
}

export const parseUniversalEntityReference = (value: unknown): UniversalEntityReference => {
    const schemaVersion = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).schemaVersion
        : undefined;
    if (typeof schemaVersion === 'number'
        && schemaVersion > CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION) {
        throw new UniversalReferenceContractError(
            'Entity reference uses a newer unsupported schema version.',
            'UNSUPPORTED_SCHEMA_VERSION',
        );
    }

    const result = UniversalEntityReferenceSchema.safeParse(value);
    if (!result.success) {
        throw new UniversalReferenceContractError(
            'Universal entity reference validation failed.',
            'INVALID_REFERENCE',
            result.error.issues,
        );
    }
    return result.data;
};

export const coreEntityReference = (
    kind: CoreEntityKind,
    id: string,
    location?: z.input<typeof EntityLocationHintSchema>,
): UniversalEntityReference => parseUniversalEntityReference({
    schema: 'axiom.entity-reference',
    schemaVersion: CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION,
    kind,
    id,
    ...(location !== undefined ? { location } : {}),
});

export const pluginEntityReference = (
    kind: z.input<typeof PluginOwnedTypeSchema>,
    id: string,
): UniversalEntityReference => parseUniversalEntityReference({
    schema: 'axiom.entity-reference',
    schemaVersion: CURRENT_UNIVERSAL_REFERENCE_SCHEMA_VERSION,
    kind,
    id,
});
