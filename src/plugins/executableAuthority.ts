import { z } from 'zod';
import { NEMOTO_PLUGIN_API_VERSION } from './activation';
import { WasmPluginIdentitySchema } from './executablePackageConsent';
import { PluginCapabilitySchema } from './manifest';
import { PortfolioPluginRequirementSchema, type PortfolioPluginRequirement } from './portfolioData';

export const NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA = 'axiom.executable-activation-snapshot';
export const NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION = 1;
export const NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA = 'axiom.executable-authority-sync';
export const NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA_VERSION = 1;
export const MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID = 'portfolio:main';

export const ExecutableActivationSnapshotSchema = z.object({
    schema: z.literal(NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA),
    schemaVersion: z.literal(NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION),
    requirements: z.array(PortfolioPluginRequirementSchema).max(1_000)
        .refine(
            requirements => new Set(requirements.map(requirement => requirement.pluginId)).size
                === requirements.length,
            'Executable activation requirements must have unique plugin IDs.',
        ),
}).strict().readonly();

export type ExecutableActivationSnapshot = z.infer<typeof ExecutableActivationSnapshotSchema>;

const ExecutableAuthorityDecisionSchema = z.object({
    identity: WasmPluginIdentitySchema,
    portfolioActive: z.boolean(),
    compatible: z.boolean(),
    effectiveCapabilities: z.array(PluginCapabilitySchema).max(32)
        .refine(
            capabilities => new Set(capabilities).size === capabilities.length,
            'Effective executable capabilities must be unique.',
        ),
    eligible: z.boolean(),
    authorized: z.boolean(),
    authorityGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    invalidatedSessions: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict().readonly();

export const ExecutableAuthoritySyncOutcomeSchema = z.object({
    schema: z.literal(NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA),
    schemaVersion: z.literal(NEMOTO_EXECUTABLE_AUTHORITY_SYNC_SCHEMA_VERSION),
    authorityScopeId: z.literal(MAIN_PORTFOLIO_AUTHORITY_SCOPE_ID),
    hostPluginApiVersion: z.literal(NEMOTO_PLUGIN_API_VERSION),
    executionEnabled: z.boolean(),
    decisions: z.array(ExecutableAuthorityDecisionSchema).max(1_000),
}).strict().superRefine((outcome, context) => {
    outcome.decisions.forEach((decision, index) => {
        const derivedEligible = decision.portfolioActive
            && decision.compatible
            && decision.effectiveCapabilities.includes('compute.isolated');
        if (decision.eligible !== derivedEligible) {
            context.addIssue({
                code: 'custom',
                path: ['decisions', index, 'eligible'],
                message: 'Executable eligibility does not match the derived lifecycle facts.',
            });
        }
        if (decision.authorized !== (outcome.executionEnabled && decision.eligible)) {
            context.addIssue({
                code: 'custom',
                path: ['decisions', index, 'authorized'],
                message: 'Executable authorization does not match the native execution gate.',
            });
        }
    });
}).readonly();

export type ExecutableAuthoritySyncOutcome = z.infer<typeof ExecutableAuthoritySyncOutcomeSchema>;

export function createExecutableActivationSnapshot(
    requirements: readonly PortfolioPluginRequirement[],
): ExecutableActivationSnapshot {
    return ExecutableActivationSnapshotSchema.parse({
        schema: NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA,
        schemaVersion: NEMOTO_EXECUTABLE_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
        requirements: structuredClone(requirements),
    });
}
