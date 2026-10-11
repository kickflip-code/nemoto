import { z } from 'zod';
import { PluginIdSchema, SemanticVersionSchema, StableContractIdSchema } from './identifiers';
import {
    SemanticAnnotationSchema,
    SemanticRecordSchema,
    SemanticRelationSchema,
} from './semanticData';
import { isValidVersionRange } from './versionRange';

export const CURRENT_PORTFOLIO_PLUGIN_STATE_SCHEMA_VERSION = 1;
export const CURRENT_PLUGIN_DATA_MIGRATION_RECORD_SCHEMA_VERSION = 1;

const MigrationTimestampSchema = z.string().trim().refine(
    value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
    'Migration timestamps must be valid ISO 8601 values with an explicit timezone.',
);

export const PluginDataMigrationRecordSchema = z.object({
    schema: z.literal('axiom.plugin-data-migration-record'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DATA_MIGRATION_RECORD_SCHEMA_VERSION),
    id: StableContractIdSchema,
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    fromDataVersion: z.number().int().positive(),
    toDataVersion: z.number().int().positive(),
    timestamp: MigrationTimestampSchema,
    status: z.enum(['succeeded', 'failed']),
    metadata: z.object({
        semanticObjectCount: z.number().int().nonnegative().max(300_000),
        opaqueDataAction: z.enum(['preserve', 'replace', 'delete']),
        diagnosticCode: z.string().trim().min(1).max(100).optional(),
    }).strict(),
}).strict().superRefine((record, context) => {
    if (record.fromDataVersion >= record.toDataVersion) {
        context.addIssue({
            code: 'custom',
            path: ['toDataVersion'],
            message: 'Plugin data migrations must advance the data version.',
        });
    }
    if (record.status === 'failed' && !record.metadata.diagnosticCode) {
        context.addIssue({
            code: 'custom',
            path: ['metadata', 'diagnosticCode'],
            message: 'Failed migration records require a sanitized diagnostic code.',
        });
    }
    if (record.status === 'succeeded' && record.metadata.diagnosticCode) {
        context.addIssue({
            code: 'custom',
            path: ['metadata', 'diagnosticCode'],
            message: 'Successful migration records cannot contain a failure diagnostic.',
        });
    }
});

export const PortfolioPluginRequirementLevelSchema = z.enum([
    'required',
    'recommended',
    'previously-used',
]);

export const PortfolioPluginActivationSchema = z.enum([
    'active',
    'inactive',
]);

export const PortfolioPluginRequirementSchema = z.object({
    pluginId: PluginIdSchema,
    version: z.string()
        .trim()
        .min(1)
        .max(100)
        .refine(isValidVersionRange, 'Plugin version range uses unsupported or invalid syntax.'),
    dataVersion: z.number().int().positive(),
    requirement: PortfolioPluginRequirementLevelSchema,
    activation: PortfolioPluginActivationSchema,
}).strict().superRefine((requirement, context) => {
    if (requirement.requirement === 'previously-used' && requirement.activation !== 'inactive') {
        context.addIssue({
            code: 'custom',
            path: ['activation'],
            message: 'A previously used plugin cannot remain active.',
        });
    }
});

export const PortfolioSemanticDataSchema = z.object({
    records: z.array(SemanticRecordSchema).max(100_000),
    relations: z.array(SemanticRelationSchema).max(100_000),
    annotations: z.array(SemanticAnnotationSchema).max(100_000),
}).strict();

/**
 * Durable, host-understood plugin state. Opaque plugin-owned values continue to
 * live under the portfolio's namespaced `extensions` object.
 */
export const PortfolioPluginStateSchema = z.object({
    schemaVersion: z.literal(CURRENT_PORTFOLIO_PLUGIN_STATE_SCHEMA_VERSION),
    requirements: z.array(PortfolioPluginRequirementSchema).max(1_000),
    semanticData: PortfolioSemanticDataSchema,
    migrations: z.array(PluginDataMigrationRecordSchema).max(10_000).optional(),
}).strict().superRefine((state, context) => {
    const migrationIds = new Set<string>();
    state.migrations?.forEach((record, index) => {
        if (migrationIds.has(record.id)) {
            context.addIssue({
                code: 'custom',
                path: ['migrations', index, 'id'],
                message: `Duplicate plugin data migration record ID: ${record.id}.`,
            });
        }
        migrationIds.add(record.id);
    });
});

export type PortfolioPluginActivation = z.infer<typeof PortfolioPluginActivationSchema>;
export type PortfolioPluginRequirement = z.infer<typeof PortfolioPluginRequirementSchema>;
export type PortfolioPluginRequirementLevel = z.infer<typeof PortfolioPluginRequirementLevelSchema>;
export type PluginDataMigrationRecord = z.infer<typeof PluginDataMigrationRecordSchema>;
export type PortfolioPluginState = z.infer<typeof PortfolioPluginStateSchema>;
export type PortfolioSemanticData = z.infer<typeof PortfolioSemanticDataSchema>;

export const createEmptyPortfolioPluginState = (): PortfolioPluginState => ({
    schemaVersion: CURRENT_PORTFOLIO_PLUGIN_STATE_SCHEMA_VERSION,
    requirements: [],
    semanticData: {
        records: [],
        relations: [],
        annotations: [],
    },
    migrations: [],
});
