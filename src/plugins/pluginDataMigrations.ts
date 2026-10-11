import { z } from 'zod';
import type { Portfolio } from '../types';
import { preparePortfolioForPersistence } from '../lib/portfolioCodec';
import { inspectPortfolioIntegrity } from '../lib/portfolioIntegrity';
import { PluginIdSchema, SemanticVersionSchema, StableContractIdSchema } from './identifiers';
import {
    CURRENT_PLUGIN_DATA_MIGRATION_RECORD_SCHEMA_VERSION,
    PluginDataMigrationRecordSchema,
    PortfolioSemanticDataSchema,
    type PluginDataMigrationRecord,
    type PortfolioSemanticData,
} from './portfolioData';
import { createPortfolioRevision } from './portfolioRevision';
import { JsonValueSchema, type JsonValue } from './semanticData';
import { satisfiesVersionRange } from './versionRange';

export const CURRENT_PLUGIN_DATA_MIGRATION_SCHEMA_VERSION = 1;

const MigrationTimestampSchema = z.string().trim().refine(
    value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
    'Migration timestamps must be valid ISO 8601 values with an explicit timezone.',
);

export const PluginOpaqueDataMigrationSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('preserve') }).strict(),
    z.object({ action: z.literal('replace'), value: JsonValueSchema }).strict(),
    z.object({ action: z.literal('delete') }).strict(),
]);

export const PluginDataMigrationPlanSchema = z.object({
    schema: z.literal('axiom.plugin-data-migration'),
    schemaVersion: z.literal(CURRENT_PLUGIN_DATA_MIGRATION_SCHEMA_VERSION),
    id: StableContractIdSchema,
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    fromDataVersion: z.number().int().positive(),
    toDataVersion: z.number().int().positive(),
    baseRevision: z.string().trim().min(1).max(240),
    attemptedAt: MigrationTimestampSchema,
    semanticData: PortfolioSemanticDataSchema,
    opaqueData: PluginOpaqueDataMigrationSchema,
}).strict().superRefine((plan, context) => {
    if (plan.fromDataVersion >= plan.toDataVersion) {
        context.addIssue({
            code: 'custom',
            path: ['toDataVersion'],
            message: 'Plugin data migrations must advance the data version.',
        });
    }
});

export type PluginDataMigrationPlan = z.infer<typeof PluginDataMigrationPlanSchema>;

export type PluginDataMigrationDiagnosticCode =
    | 'missing-plugin-state'
    | 'missing-plugin-requirement'
    | 'ambiguous-plugin-requirement'
    | 'stale-plugin-data-version'
    | 'incompatible-plugin-version'
    | 'foreign-semantic-data'
    | 'invalid-result'
    | 'result-integrity-error';

export interface PluginDataMigrationDiagnostic {
    code: PluginDataMigrationDiagnosticCode;
    message: string;
}

export interface PluginDataMigrationResult {
    status: 'succeeded' | 'failed';
    portfolio: Portfolio;
    record: PluginDataMigrationRecord;
    diagnostics: readonly PluginDataMigrationDiagnostic[];
}

export class PluginDataMigrationError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_PLAN' | 'UNSUPPORTED_SCHEMA_VERSION' | 'STALE_BASE_REVISION' | 'DUPLICATE_MIGRATION_ID',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginDataMigrationError';
    }
}

const cloneJsonDocument = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

const countSemanticData = (data: PortfolioSemanticData): number => (
    data.records.length + data.relations.length + data.annotations.length
);

function parseMigrationPlan(input: unknown): PluginDataMigrationPlan {
    const version = input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>).schemaVersion
        : undefined;
    if (typeof version === 'number' && version > CURRENT_PLUGIN_DATA_MIGRATION_SCHEMA_VERSION) {
        throw new PluginDataMigrationError(
            `Plugin data migration schema version ${version} is newer than supported version ${CURRENT_PLUGIN_DATA_MIGRATION_SCHEMA_VERSION}.`,
            'UNSUPPORTED_SCHEMA_VERSION',
        );
    }
    const parsed = PluginDataMigrationPlanSchema.safeParse(input);
    if (!parsed.success) {
        throw new PluginDataMigrationError(
            'Plugin data migration plan validation failed.',
            'INVALID_PLAN',
            parsed.error.issues,
        );
    }
    return parsed.data;
}

function migrationRecord(
    plan: PluginDataMigrationPlan,
    status: 'succeeded' | 'failed',
    diagnosticCode?: PluginDataMigrationDiagnosticCode,
): PluginDataMigrationRecord {
    return PluginDataMigrationRecordSchema.parse({
        schema: 'axiom.plugin-data-migration-record',
        schemaVersion: CURRENT_PLUGIN_DATA_MIGRATION_RECORD_SCHEMA_VERSION,
        id: plan.id,
        pluginId: plan.pluginId,
        pluginVersion: plan.pluginVersion,
        fromDataVersion: plan.fromDataVersion,
        toDataVersion: plan.toDataVersion,
        timestamp: plan.attemptedAt,
        status,
        metadata: {
            semanticObjectCount: countSemanticData(plan.semanticData),
            opaqueDataAction: plan.opaqueData.action,
            ...(diagnosticCode ? { diagnosticCode } : {}),
        },
    });
}

function appendRecord(portfolio: Portfolio, record: PluginDataMigrationRecord): Portfolio {
    const candidate = cloneJsonDocument(portfolio);
    if (!candidate.plugins) return candidate;
    candidate.plugins.migrations = [...(candidate.plugins.migrations || []), record];
    return preparePortfolioForPersistence(candidate);
}

function failedResult(
    portfolio: Portfolio,
    plan: PluginDataMigrationPlan,
    diagnostic: PluginDataMigrationDiagnostic,
): PluginDataMigrationResult {
    const record = migrationRecord(plan, 'failed', diagnostic.code);
    return {
        status: 'failed',
        portfolio: appendRecord(portfolio, record),
        record,
        diagnostics: [diagnostic],
    };
}

const integrityKey = (issue: ReturnType<typeof inspectPortfolioIntegrity>['issues'][number]): string => (
    `${issue.severity}\u0000${issue.code}\u0000${issue.path}\u0000${issue.id || ''}\u0000${issue.message}`
);

/**
 * Applies a declarative, complete replacement of one plugin's owned data.
 * No plugin migration code is loaded or executed by this contract.
 */
export function applyPluginDataMigration(input: unknown, portfolio: Portfolio): PluginDataMigrationResult {
    const plan = parseMigrationPlan(input);
    const currentRevision = createPortfolioRevision(portfolio);
    if (plan.baseRevision !== currentRevision) {
        throw new PluginDataMigrationError(
            'The portfolio changed after the plugin data migration was prepared.',
            'STALE_BASE_REVISION',
        );
    }
    if (!portfolio.plugins) {
        return failedResult(portfolio, plan, {
            code: 'missing-plugin-state',
            message: 'The portfolio has no canonical plugin state.',
        });
    }
    if (portfolio.plugins.migrations?.some(record => record.id === plan.id)) {
        throw new PluginDataMigrationError(
            `Migration record '${plan.id}' already exists.`,
            'DUPLICATE_MIGRATION_ID',
        );
    }

    const requirements = portfolio.plugins.requirements.filter(requirement => (
        requirement.pluginId === plan.pluginId
    ));
    if (requirements.length === 0) {
        return failedResult(portfolio, plan, {
            code: 'missing-plugin-requirement',
            message: `The portfolio does not declare '${plan.pluginId}'.`,
        });
    }
    if (requirements.length > 1) {
        return failedResult(portfolio, plan, {
            code: 'ambiguous-plugin-requirement',
            message: `The portfolio declares '${plan.pluginId}' more than once.`,
        });
    }
    const requirement = requirements[0];
    if (requirement.dataVersion !== plan.fromDataVersion) {
        return failedResult(portfolio, plan, {
            code: 'stale-plugin-data-version',
            message: `Plugin data version ${requirement.dataVersion} does not match migration source version ${plan.fromDataVersion}.`,
        });
    }
    if (!satisfiesVersionRange(plan.pluginVersion, requirement.version)) {
        return failedResult(portfolio, plan, {
            code: 'incompatible-plugin-version',
            message: `Plugin version ${plan.pluginVersion} does not satisfy ${requirement.version}.`,
        });
    }

    const migratedValues = [
        ...plan.semanticData.records,
        ...plan.semanticData.relations,
        ...plan.semanticData.annotations,
    ];
    const hasForeignData = migratedValues.some(value => (
        value.owner.pluginId !== plan.pluginId
        || value.owner.pluginVersion !== plan.pluginVersion
        || value.owner.dataVersion !== plan.toDataVersion
    ));
    if (hasForeignData) {
        return failedResult(portfolio, plan, {
            code: 'foreign-semantic-data',
            message: 'Migration output may only contain target-version semantic data owned by the migrated plugin.',
        });
    }

    try {
        const candidate = cloneJsonDocument(portfolio);
        const semanticData = candidate.plugins!.semanticData;
        semanticData.records = [
            ...semanticData.records.filter(value => value.owner.pluginId !== plan.pluginId),
            ...cloneJsonDocument(plan.semanticData.records),
        ];
        semanticData.relations = [
            ...semanticData.relations.filter(value => value.owner.pluginId !== plan.pluginId),
            ...cloneJsonDocument(plan.semanticData.relations),
        ];
        semanticData.annotations = [
            ...semanticData.annotations.filter(value => value.owner.pluginId !== plan.pluginId),
            ...cloneJsonDocument(plan.semanticData.annotations),
        ];
        candidate.plugins!.requirements = candidate.plugins!.requirements.map(value => (
            value.pluginId === plan.pluginId
                ? { ...value, dataVersion: plan.toDataVersion }
                : value
        ));
        if (plan.opaqueData.action === 'replace') {
            candidate.extensions = {
                ...(candidate.extensions || {}),
                [plan.pluginId]: cloneJsonDocument(plan.opaqueData.value) as JsonValue,
            };
        } else if (plan.opaqueData.action === 'delete' && candidate.extensions) {
            delete candidate.extensions[plan.pluginId];
        }

        const record = migrationRecord(plan, 'succeeded');
        candidate.plugins!.migrations = [...(candidate.plugins!.migrations || []), record];
        const baselineIssues = new Set(inspectPortfolioIntegrity(portfolio).issues.map(integrityKey));
        const prepared = preparePortfolioForPersistence(candidate);
        const introducedIssue = inspectPortfolioIntegrity(prepared).issues.find(issue => (
            !baselineIssues.has(integrityKey(issue))
            && (issue.severity === 'error' || issue.code === 'dangling-semantic-reference')
        ));
        if (introducedIssue) {
            return failedResult(portfolio, plan, {
                code: 'result-integrity-error',
                message: 'Migration output introduced a new portfolio integrity issue.',
            });
        }
        return {
            status: 'succeeded',
            portfolio: prepared,
            record,
            diagnostics: [],
        };
    } catch {
        return failedResult(portfolio, plan, {
            code: 'invalid-result',
            message: 'Migration output could not be converted into a valid portfolio.',
        });
    }
}
