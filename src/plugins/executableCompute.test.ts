import { describe, expect, it } from 'vitest';
import type { PluginEntitySnapshot } from './entityReadContracts';
import {
    NEMOTO_WASM_COMPUTE_RESULT_SCHEMA,
    NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION,
    createExecutableComputeRequest,
    validateExecutableComputeResult,
} from './executableCompute';
import { coreEntityReference } from './universalReference';

const reference = coreEntityReference('core.asset-category', 'risk-register');
const snapshot: PluginEntitySnapshot = {
    schema: 'axiom.plugin.entity-snapshot',
    schemaVersion: 1,
    portfolioRevision: 7,
    reference,
    label: 'Risk register',
    fields: { description: 'Reviewed risks' },
    omittedFields: ['internalNotes'],
};

const request = createExecutableComputeRequest({
    requestId: 'compute:risk-review:1',
    baseRevision: 'portfolio-revision-aabbccdd',
    portfolioRevision: 7,
    snapshots: [snapshot],
    parameters: { threshold: 3 },
    grantedCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
});

describe('executable compute data plane', () => {
    it('builds a bounded Core-authored request and rejects unsanctioned snapshots', () => {
        expect(request.snapshots[0].reference).toEqual(reference);
        expect(() => createExecutableComputeRequest({
            ...request,
            grantedCapabilities: ['compute.isolated'],
        })).toThrow(/portfolio\.read-scoped/);
        expect(() => createExecutableComputeRequest({
            ...request,
            snapshots: [{ ...snapshot, portfolioRevision: 8 }],
            grantedCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
        })).toThrow(/portfolio revision/);
    });

    it('binds a proposal draft to Core identity, time, and revision', () => {
        const validated = validateExecutableComputeResult({
            schema: NEMOTO_WASM_COMPUTE_RESULT_SCHEMA,
            schemaVersion: NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION,
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            output: { riskCount: 1 },
            proposalDraft: {
                schema: 'axiom.wasm-proposal-draft',
                schemaVersion: 1,
                proposalSchemaVersion: 3,
                id: 'proposal:risk-import:1',
                origin: {
                    kind: 'import',
                    importerId: 'risk-register-importer',
                    sourceLabel: 'Risk register.csv',
                    sourceDigest: 'sha256:aabbccdd',
                },
                title: 'Import reviewed risk',
                summary: 'Adds one reviewed risk resource.',
                rationale: 'The isolated parser found one valid row.',
                affectedEntities: [reference],
                sources: [],
                operations: [{
                    operationId: 'operation:risk:1',
                    kind: 'core.resource.import',
                    resource: {
                        id: 'risk-1',
                        name: 'Supplier dependency',
                        categoryId: reference.id,
                    },
                }],
            },
        }, {
            request,
            identity: { pluginId: 'com.axiom.risk-importer', pluginVersion: '1.2.0' },
            grantedCapabilities: ['compute.isolated', 'portfolio.read-scoped', 'proposal.create'],
            proposedAt: '2026-08-28T20:00:00.000Z',
        });

        expect(validated.proposal).toMatchObject({
            baseRevision: request.baseRevision,
            proposedAt: '2026-08-28T20:00:00.000Z',
            atomic: true,
            directMutation: false,
            proposedBy: {
                kind: 'import',
                pluginId: 'com.axiom.risk-importer',
                pluginVersion: '1.2.0',
            },
        });
    });

    it('rejects stale correlation, missing proposal grants, and hidden entity references', () => {
        const base = {
            schema: NEMOTO_WASM_COMPUTE_RESULT_SCHEMA,
            schemaVersion: NEMOTO_WASM_COMPUTE_RESULT_SCHEMA_VERSION,
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            output: null,
        };
        expect(() => validateExecutableComputeResult({
            ...base,
            requestId: 'compute:other:1',
        }, {
            request,
            identity: { pluginId: 'com.axiom.risk-importer', pluginVersion: '1.2.0' },
            grantedCapabilities: ['compute.isolated'],
            proposedAt: '2026-08-28T20:00:00.000Z',
        })).toThrow(/does not match/);

        const draft = {
            schema: 'axiom.wasm-proposal-draft',
            schemaVersion: 1,
            proposalSchemaVersion: 1,
            id: 'proposal:hidden:1',
            origin: { kind: 'plugin' },
            title: 'Hidden reference',
            summary: 'Attempts to escape the supplied snapshot set.',
            rationale: 'Adversarial fixture.',
            affectedEntities: [coreEntityReference('core.asset-category', 'hidden')],
            sources: [],
            operations: [{
                operationId: 'operation:hidden:1',
                kind: 'semantic-record.create',
                record: {
                    schema: 'axiom.semantic-record',
                    schemaVersion: 1,
                    id: 'hidden-record',
                    type: 'com.axiom.risk-importer/risk',
                    owner: {
                        pluginId: 'com.axiom.risk-importer',
                        pluginVersion: '1.2.0',
                        dataVersion: 1,
                    },
                    label: 'Hidden',
                    properties: {},
                    provenance: {
                        assertion: 'recorded-fact',
                        origin: {
                            kind: 'plugin',
                            pluginId: 'com.axiom.risk-importer',
                            pluginVersion: '1.2.0',
                        },
                        recordedAt: '2026-08-28T20:00:00.000Z',
                        sources: [],
                    },
                    createdAt: '2026-08-28T20:00:00.000Z',
                    updatedAt: '2026-08-28T20:00:00.000Z',
                },
            }],
        };
        expect(() => validateExecutableComputeResult({ ...base, proposalDraft: draft }, {
            request,
            identity: { pluginId: 'com.axiom.risk-importer', pluginVersion: '1.2.0' },
            grantedCapabilities: ['compute.isolated', 'portfolio.read-scoped'],
            proposedAt: '2026-08-28T20:00:00.000Z',
        })).toThrow(/proposal\.create/);
        expect(() => validateExecutableComputeResult({ ...base, proposalDraft: draft }, {
            request,
            identity: { pluginId: 'com.axiom.risk-importer', pluginVersion: '1.2.0' },
            grantedCapabilities: ['compute.isolated', 'portfolio.read-scoped', 'proposal.create'],
            proposedAt: '2026-08-28T20:00:00.000Z',
        })).toThrow(/supplied snapshot/);
    });
});
