import { z } from 'zod';
import { PluginEntitySnapshotSchema, type PluginEntitySnapshot } from './entityReadContracts';
import {
    PluginIdSchema,
    SemanticVersionSchema,
    StableContractIdSchema,
} from './identifiers';
import type { PluginCapability } from './manifest';
import { MAX_PLUGIN_RUNTIME_REQUEST_BYTES, MAX_PLUGIN_RUNTIME_RESPONSE_BYTES } from './pluginLimits';
import {
    CoreResourceImportOperationSchema,
    parsePluginProposal,
    ProposalCreateOperationSchema,
    ProposalOperationSchema,
    type PluginProposal,
} from './proposals';
import { JsonValueSchema, SourceCitationSchema, type JsonValue } from './semanticData';
import { UniversalEntityReferenceSchema } from './universalReference';

export const NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA = 'axiom.wasm-compute-request';
export const NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION = 1;
export const NEMOTO_WASM_COMPUTE_RESULT_SCHEMA = 'axiom.wasm-compute-result';
export const NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION = 1;
export const NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA = 'axiom.wasm-proposal-draft';
export const NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA_VERSION = 1;
export const MAX_WASM_COMPUTE_SNAPSHOTS = 32;
export const MAX_WASM_COMPUTE_REQUEST_BYTES = 240 * 1024;

const encodedBytes = (value: unknown): number => (
    new TextEncoder().encode(JSON.stringify(value)).byteLength
);

const referenceKey = (reference: z.infer<typeof UniversalEntityReferenceSchema>): string => (
    JSON.stringify(reference)
);

export const ExecutableComputeRequestSchema = z.object({
    schema: z.literal(NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA),
    schemaVersion: z.literal(NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION),
    requestId: StableContractIdSchema,
    baseRevision: StableContractIdSchema,
    portfolioRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    snapshots: z.array(PluginEntitySnapshotSchema).max(MAX_WASM_COMPUTE_SNAPSHOTS),
    parameters: JsonValueSchema,
}).strict().superRefine((request, context) => {
    const references = new Set<string>();
    request.snapshots.forEach((snapshot, index) => {
        if (snapshot.portfolioRevision !== request.portfolioRevision) {
            context.addIssue({
                code: 'custom',
                path: ['snapshots', index, 'portfolioRevision'],
                message: 'Every compute snapshot must come from the request portfolio revision.',
            });
        }
        const key = referenceKey(snapshot.reference);
        if (references.has(key)) {
            context.addIssue({
                code: 'custom',
                path: ['snapshots', index, 'reference'],
                message: 'Compute snapshot references must be unique.',
            });
        }
        references.add(key);
    });
    if (encodedBytes(request) > MAX_WASM_COMPUTE_REQUEST_BYTES) {
        context.addIssue({
            code: 'custom',
            message: `Compute requests may contain at most ${MAX_WASM_COMPUTE_REQUEST_BYTES} UTF-8 bytes.`,
        });
    }
}).readonly();

export type ExecutableComputeRequest = z.infer<typeof ExecutableComputeRequestSchema>;

const PluginDraftOriginSchema = z.object({
    kind: z.literal('plugin'),
    contributionId: z.string().trim().min(3).max(240).optional(),
}).strict();

const ImportDraftOriginSchema = z.object({
    kind: z.literal('import'),
    importerId: z.string().trim().min(3).max(240),
    sourceLabel: z.string().trim().min(1).max(500),
    sourceDigest: z.string().trim().min(8).max(256).optional(),
}).strict();

const proposalDraftShape = {
    schema: z.literal(NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA),
    schemaVersion: z.literal(NEMOTO_WASM_PROPOSAL_DRAFT_SCHEMA_VERSION),
    id: StableContractIdSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(2_000),
    rationale: z.string().trim().min(1).max(4_000),
    affectedEntities: z.array(UniversalEntityReferenceSchema).min(1).max(500),
    sources: z.array(SourceCitationSchema).max(200).optional().default([]),
};

const ExecutableCreateProposalDraftSchema = z.object({
    ...proposalDraftShape,
    proposalSchemaVersion: z.literal(1),
    origin: PluginDraftOriginSchema,
    operations: z.array(ProposalCreateOperationSchema).min(1).max(500),
}).strict();

const ExecutableMutationProposalDraftSchema = z.object({
    ...proposalDraftShape,
    proposalSchemaVersion: z.literal(2),
    origin: PluginDraftOriginSchema,
    operations: z.array(ProposalOperationSchema).min(1).max(500),
}).strict();

const ExecutableImportProposalDraftSchema = z.object({
    ...proposalDraftShape,
    proposalSchemaVersion: z.literal(3),
    origin: ImportDraftOriginSchema,
    operations: z.array(CoreResourceImportOperationSchema).min(1).max(500),
}).strict();

export const ExecutableProposalDraftSchema = z.union([
    ExecutableCreateProposalDraftSchema,
    ExecutableMutationProposalDraftSchema,
    ExecutableImportProposalDraftSchema,
]);

export type ExecutableProposalDraft = z.infer<typeof ExecutableProposalDraftSchema>;

export const ExecutableComputeResultSchema = z.object({
    schema: z.literal(NEMOTO_WASM_COMPUTE_RESULT_SCHEMA),
    schemaVersion: z.literal(NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION),
    requestId: StableContractIdSchema,
    baseRevision: StableContractIdSchema,
    output: JsonValueSchema,
    proposalDraft: ExecutableProposalDraftSchema.optional(),
}).strict().superRefine((result, context) => {
    if (encodedBytes(result) > MAX_PLUGIN_RUNTIME_RESPONSE_BYTES) {
        context.addIssue({
            code: 'custom',
            message: `Compute results may contain at most ${MAX_PLUGIN_RUNTIME_RESPONSE_BYTES} UTF-8 bytes.`,
        });
    }
}).readonly();

export type ExecutableComputeResult = z.infer<typeof ExecutableComputeResultSchema>;

export interface CreateExecutableComputeRequestInput {
    readonly requestId: string;
    readonly baseRevision: string;
    readonly portfolioRevision: number;
    readonly snapshots: readonly PluginEntitySnapshot[];
    readonly parameters: JsonValue;
    readonly grantedCapabilities: readonly PluginCapability[];
}

export function createExecutableComputeRequest(
    input: CreateExecutableComputeRequestInput,
): ExecutableComputeRequest {
    if (input.snapshots.length > 0
        && !input.grantedCapabilities.includes('portfolio.read-scoped')) {
        throw new Error('Executable compute snapshots require portfolio.read-scoped.');
    }
    return ExecutableComputeRequestSchema.parse({
        schema: NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA,
        schemaVersion: NEMOTO_WASM_COMPUTE_REQUEST_SCHEMA_VERSION,
        requestId: input.requestId,
        baseRevision: input.baseRevision,
        portfolioRevision: input.portfolioRevision,
        snapshots: [...input.snapshots],
        parameters: input.parameters,
    });
}

export interface ValidateExecutableComputeResultInput {
    readonly request: ExecutableComputeRequest;
    readonly identity: {
        readonly pluginId: z.input<typeof PluginIdSchema>;
        readonly pluginVersion: z.input<typeof SemanticVersionSchema>;
    };
    readonly grantedCapabilities: readonly PluginCapability[];
    readonly proposedAt: string;
}

export interface ValidatedExecutableComputeResult {
    readonly output: JsonValue;
    readonly proposal?: PluginProposal;
}

const assertDraftReferencesWereSupplied = (
    draft: ExecutableProposalDraft,
    snapshots: readonly PluginEntitySnapshot[],
): void => {
    const supplied = new Set(snapshots.map(snapshot => referenceKey(snapshot.reference)));
    draft.affectedEntities.forEach(reference => {
        if (!supplied.has(referenceKey(reference))) {
            throw new Error('Executable proposal drafts may only affect supplied snapshot references.');
        }
    });
    draft.sources.forEach(source => {
        if (source.kind === 'entity' && !supplied.has(referenceKey(source.reference))) {
            throw new Error('Executable proposal drafts may only cite supplied entity snapshots.');
        }
    });
};

export function validateExecutableComputeResult(
    value: unknown,
    input: ValidateExecutableComputeResultInput,
): ValidatedExecutableComputeResult {
    const result = ExecutableComputeResultSchema.parse(value);
    if (result.requestId !== input.request.requestId
        || result.baseRevision !== input.request.baseRevision) {
        throw new Error('Executable compute result does not match the Core-authored request.');
    }
    if (!result.proposalDraft) return Object.freeze({ output: result.output });
    if (!input.grantedCapabilities.includes('proposal.create')) {
        throw new Error('Executable compute returned a proposal without proposal.create.');
    }

    assertDraftReferencesWereSupplied(result.proposalDraft, input.request.snapshots);
    const origin = result.proposalDraft.origin.kind === 'plugin'
        ? {
            kind: 'plugin' as const,
            pluginId: input.identity.pluginId,
            pluginVersion: input.identity.pluginVersion,
            ...(result.proposalDraft.origin.contributionId
                ? { contributionId: result.proposalDraft.origin.contributionId }
                : {}),
        }
        : {
            kind: 'import' as const,
            pluginId: input.identity.pluginId,
            pluginVersion: input.identity.pluginVersion,
            importerId: result.proposalDraft.origin.importerId,
            sourceLabel: result.proposalDraft.origin.sourceLabel,
            ...(result.proposalDraft.origin.sourceDigest
                ? { sourceDigest: result.proposalDraft.origin.sourceDigest }
                : {}),
        };
    const proposal = parsePluginProposal({
        schema: 'axiom.plugin-proposal',
        schemaVersion: result.proposalDraft.proposalSchemaVersion,
        id: result.proposalDraft.id,
        baseRevision: input.request.baseRevision,
        title: result.proposalDraft.title,
        summary: result.proposalDraft.summary,
        rationale: result.proposalDraft.rationale,
        proposedAt: input.proposedAt,
        proposedBy: origin,
        affectedEntities: result.proposalDraft.affectedEntities,
        sources: result.proposalDraft.sources,
        atomic: true,
        directMutation: false,
        operations: result.proposalDraft.operations,
    });
    return Object.freeze({ output: result.output, proposal });
}

// Keep enough space for the identity/session wrapper added by native Core.
if (MAX_WASM_COMPUTE_REQUEST_BYTES >= MAX_PLUGIN_RUNTIME_REQUEST_BYTES) {
    throw new Error('Executable compute request budget must stay below the native invocation limit.');
}
