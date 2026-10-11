import { z } from 'zod';
import {
    getOwningPluginId,
    PluginIdSchema,
    PluginOwnedTypeSchema,
    SemanticVersionSchema,
    StableContractIdSchema,
} from './identifiers';
import {
    SemanticAnnotationSchema,
    SemanticRecordSchema,
    SemanticRelationSchema,
    SourceCitationSchema,
} from './semanticData';
import { UniversalEntityReferenceSchema } from './universalReference';
import { MAX_PLUGIN_PROPOSAL_BYTES } from './pluginLimits';

export const CURRENT_PROPOSAL_SCHEMA_VERSION = 3;

const ProposalPluginOriginSchema = z.object({
    kind: z.literal('plugin'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    contributionId: z.string().trim().min(3).max(240).optional(),
}).strict();

const ProposalAiOriginSchema = z.object({
    kind: z.literal('ai'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    profileId: z.string().trim().min(3).max(240),
    modelId: z.string().trim().min(1).max(240),
    runId: StableContractIdSchema,
}).strict();

const ProposalImportOriginSchema = z.object({
    kind: z.literal('import'),
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    importerId: z.string().trim().min(3).max(240),
    sourceLabel: z.string().trim().min(1).max(500),
    sourceDigest: z.string().trim().min(8).max(256).optional(),
}).strict();

export const ProposalOriginSchema = z.discriminatedUnion('kind', [
    ProposalPluginOriginSchema,
    ProposalAiOriginSchema,
    ProposalImportOriginSchema,
]);

const operationBase = {
    operationId: StableContractIdSchema,
};

export const ProposalCreateOperationSchema = z.discriminatedUnion('kind', [
    z.object({
        ...operationBase,
        kind: z.literal('semantic-record.create'),
        record: SemanticRecordSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-relation.create'),
        relation: SemanticRelationSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-annotation.create'),
        annotation: SemanticAnnotationSchema,
    }).strict(),
]);

export const ProposalSemanticTargetSchema = z.object({
    id: StableContractIdSchema,
    type: PluginOwnedTypeSchema,
}).strict();

export const ProposalOperationSchema = z.discriminatedUnion('kind', [
    ...ProposalCreateOperationSchema.options,
    z.object({
        ...operationBase,
        kind: z.literal('semantic-record.update'),
        record: SemanticRecordSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-relation.update'),
        relation: SemanticRelationSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-annotation.update'),
        annotation: SemanticAnnotationSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-record.delete'),
        target: ProposalSemanticTargetSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-relation.delete'),
        target: ProposalSemanticTargetSchema,
    }).strict(),
    z.object({
        ...operationBase,
        kind: z.literal('semantic-annotation.delete'),
        target: ProposalSemanticTargetSchema,
    }).strict(),
]);

const CoreResourceMetadataValueSchema = z.union([
    z.string().max(20_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
]);

const CoreResourceMetadataSchema = z.record(
    z.string().trim().min(1).max(120),
    CoreResourceMetadataValueSchema,
).superRefine((metadata, context) => {
    const keys = Object.keys(metadata);
    if (keys.length > 100) {
        context.addIssue({
            code: 'custom',
            message: 'Imported resources may contain at most 100 metadata fields.',
        });
    }
    keys.forEach(key => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            context.addIssue({
                code: 'custom',
                path: [key],
                message: `Metadata key '${key}' is not allowed.`,
            });
        }
    });
});

export const CoreResourceImportOperationSchema = z.object({
    ...operationBase,
    kind: z.literal('core.resource.import'),
    resource: z.object({
        id: StableContractIdSchema,
        name: z.string().trim().min(1).max(500),
        categoryId: StableContractIdSchema,
        metadata: CoreResourceMetadataSchema.optional(),
    }).strict(),
    sourceLocation: z.object({
        sheetName: z.string().trim().min(1).max(240).optional(),
        rowNumber: z.number().int().min(1).max(1_000_000).optional(),
    }).strict().refine(
        location => location.sheetName !== undefined || location.rowNumber !== undefined,
        'A source location must include a sheet name or row number.',
    ).optional(),
}).strict();

const operationPayload = (operation: z.infer<typeof ProposalOperationSchema>) => {
    switch (operation.kind) {
        case 'semantic-record.create':
        case 'semantic-record.update':
            return operation.record;
        case 'semantic-relation.create':
        case 'semantic-relation.update':
            return operation.relation;
        case 'semantic-annotation.create':
        case 'semantic-annotation.update':
            return operation.annotation;
        case 'semantic-record.delete':
        case 'semantic-relation.delete':
        case 'semantic-annotation.delete':
            return undefined;
    }
};

const proposalShape = {
    schema: z.literal('axiom.plugin-proposal'),
    id: StableContractIdSchema,
    baseRevision: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(4_000),
    proposedAt: z.string().trim().refine(
        value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
        'Proposal timestamps must be valid ISO 8601 values with an explicit timezone.',
    ),
    proposedBy: ProposalOriginSchema,
    affectedEntities: z.array(UniversalEntityReferenceSchema).min(1).max(500),
    sources: z.array(SourceCitationSchema).max(200).optional().default([]),
    atomic: z.literal(true),
    directMutation: z.literal(false),
};

const PluginProposalV1Schema = z.object({
    ...proposalShape,
    schemaVersion: z.literal(1),
    operations: z.array(ProposalCreateOperationSchema).min(1).max(500),
}).strict();

const PluginProposalV2Schema = z.object({
    ...proposalShape,
    schemaVersion: z.literal(2),
    operations: z.array(ProposalOperationSchema).min(1).max(500),
}).strict();

const PluginProposalV3Schema = z.object({
    ...proposalShape,
    schemaVersion: z.literal(3),
    operations: z.array(CoreResourceImportOperationSchema).min(1).max(500),
}).strict();

export const PluginProposalSchema = z.union([
    PluginProposalV1Schema,
    PluginProposalV2Schema,
    PluginProposalV3Schema,
]).superRefine((proposal, context) => {
    if (proposal.proposedBy.kind === 'ai' && proposal.sources.length === 0) {
        context.addIssue({
            code: 'custom',
            path: ['sources'],
            message: 'AI proposals must cite at least one source.',
        });
    }

    const operationIds = new Set<string>();
    const importedResourceIds = new Set<string>();
    proposal.operations.forEach((operation, index) => {
        if (operationIds.has(operation.operationId)) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index, 'operationId'],
                message: `Duplicate proposal operation ID: ${operation.operationId}.`,
            });
        }
        operationIds.add(operation.operationId);

        if (operation.kind === 'core.resource.import') {
            if (proposal.proposedBy.kind !== 'import') {
                context.addIssue({
                    code: 'custom',
                    path: ['proposedBy', 'kind'],
                    message: 'Core resource import proposals require an import origin.',
                });
            }
            if (importedResourceIds.has(operation.resource.id)) {
                context.addIssue({
                    code: 'custom',
                    path: ['operations', index, 'resource', 'id'],
                    message: `Duplicate imported resource ID: ${operation.resource.id}.`,
                });
            }
            importedResourceIds.add(operation.resource.id);
            return;
        }

        const payload = operationPayload(operation);
        const targetType = payload?.type || ('target' in operation ? operation.target.type : '');
        if (getOwningPluginId(targetType) !== proposal.proposedBy.pluginId) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index],
                message: 'A plugin may only propose semantic data in its own namespace.',
            });
        }
        if (payload && payload.owner.pluginId !== proposal.proposedBy.pluginId) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index, 'owner', 'pluginId'],
                message: 'Semantic ownership must match the proposing plugin.',
            });
        }
        if (payload && payload.owner.pluginVersion !== proposal.proposedBy.pluginVersion) {
            context.addIssue({
                code: 'custom',
                path: ['operations', index],
                message: 'Semantic owner version must match the proposing plugin version.',
            });
        }
        if (payload && proposal.proposedBy.kind === 'ai') {
            const provenanceOrigin = payload.provenance.origin;
            const isMatchingAiSuggestion = payload.provenance.assertion === 'ai-suggestion'
                && provenanceOrigin.kind === 'ai'
                && provenanceOrigin.runId === proposal.proposedBy.runId
                && provenanceOrigin.profileId === proposal.proposedBy.profileId
                && provenanceOrigin.modelId === proposal.proposedBy.modelId;
            if (!isMatchingAiSuggestion) {
                context.addIssue({
                    code: 'custom',
                    path: ['operations', index, 'provenance'],
                    message: 'AI proposal operations must retain matching AI-suggestion provenance.',
                });
            }
        }
    });

    const affectedKeys = new Set<string>();
    proposal.affectedEntities.forEach((reference, index) => {
        const key = JSON.stringify(reference);
        if (affectedKeys.has(key)) {
            context.addIssue({
                code: 'custom',
                path: ['affectedEntities', index],
                message: 'Affected entity references must be unique.',
            });
        }
        affectedKeys.add(key);
    });

    if (proposal.schemaVersion === 3) {
        const affectedCategoryIds = new Set(
            proposal.affectedEntities
                .filter(reference => reference.kind === 'core.asset-category')
                .map(reference => reference.id),
        );
        proposal.affectedEntities.forEach((reference, index) => {
            if (reference.kind !== 'core.asset-category') {
                context.addIssue({
                    code: 'custom',
                    path: ['affectedEntities', index, 'kind'],
                    message: 'Core resource imports may only declare their destination categories as affected entities.',
                });
            }
        });
        proposal.operations.forEach((operation, index) => {
            if (!affectedCategoryIds.has(operation.resource.categoryId)) {
                context.addIssue({
                    code: 'custom',
                    path: ['operations', index, 'resource', 'categoryId'],
                    message: `Destination category '${operation.resource.categoryId}' must be declared as an affected entity.`,
                });
            }
        });
    }
});

export type PluginProposal = z.infer<typeof PluginProposalSchema>;
export type ProposalOperation = z.infer<typeof ProposalOperationSchema>
    | z.infer<typeof CoreResourceImportOperationSchema>;
export type ProposalCreateOperation = z.infer<typeof ProposalCreateOperationSchema>;
export type CoreResourceImportOperation = z.infer<typeof CoreResourceImportOperationSchema>;
export type ProposalOrigin = z.infer<typeof ProposalOriginSchema>;
export type ProposalSemanticTarget = z.infer<typeof ProposalSemanticTargetSchema>;

export class PluginProposalContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_PROPOSAL' | 'UNSUPPORTED_SCHEMA_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginProposalContractError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parsePluginProposal = (value: unknown): PluginProposal => {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_PLUGIN_PROPOSAL_BYTES) {
            throw new PluginProposalContractError(
                `Plugin proposals may contain at most ${MAX_PLUGIN_PROPOSAL_BYTES} UTF-8 bytes.`,
                'INVALID_PROPOSAL',
            );
        }
    } catch (error) {
        if (error instanceof PluginProposalContractError) throw error;
        throw new PluginProposalContractError(
            'Plugin proposals must be serializable JSON documents.',
            'INVALID_PROPOSAL',
        );
    }

    if (isRecord(value)
        && typeof value.schemaVersion === 'number'
        && value.schemaVersion > CURRENT_PROPOSAL_SCHEMA_VERSION) {
        throw new PluginProposalContractError(
            `Proposal schema version ${value.schemaVersion} is newer than the supported version ${CURRENT_PROPOSAL_SCHEMA_VERSION}.`,
            'UNSUPPORTED_SCHEMA_VERSION',
        );
    }

    const result = PluginProposalSchema.safeParse(value);
    if (!result.success) {
        throw new PluginProposalContractError(
            'Plugin proposal validation failed.',
            'INVALID_PROPOSAL',
            result.error.issues,
        );
    }
    return result.data;
};
