import { z } from 'zod';
import { SemanticVersionSchema } from './identifiers';
import { PluginCapabilitySchema } from './manifest';
import { CoreRelationKindSchema } from './entityReadContracts';
import {
    CoreEntityKindSchema,
    UniversalEntityReferenceSchema,
} from './universalReference';

export const CURRENT_PLUGIN_WORKSPACE_SCHEMA_VERSION = 1;
export const MAX_PLUGIN_WORKSPACE_SELECTIONS = 100;

export const PLUGIN_NAVIGABLE_CORE_ENTITY_KINDS = [
    'core.process',
    'core.node',
    'core.edge',
    'core.swimlane',
    'core.asset',
    'core.journal-entry',
] as const;

export const PLUGIN_KNOWN_CORE_RELATION_KINDS = [
    'core.relation.process-folder',
    'core.relation.process-owner',
    'core.relation.process-node',
    'core.relation.process-edge',
    'core.relation.process-swimlane',
    'core.relation.node-asset',
    'core.relation.node-swimlane',
    'core.relation.node-parent',
    'core.relation.flow',
    'core.relation.asset-category',
    'core.relation.asset-parent',
    'core.relation.notebook-folder',
    'core.relation.entry-notebook',
    'core.relation.entry-tag',
    'core.relation.entry-context',
    'core.relation.finding-incident',
    'core.relation.finding-node',
    'core.relation.annotation',
] as const;

const SupportedContributionFamilySchema = z.enum([
    'vocabularies',
    'questionSets',
    'templates',
    'aiProfiles',
    'views',
    'commands',
]);

const CapabilityDescriptorSchema = z.object({
    id: PluginCapabilitySchema,
    available: z.boolean(),
    declared: z.boolean(),
    granted: z.boolean(),
    effective: z.boolean(),
}).strict().superRefine((capability, context) => {
    if (capability.effective && !(
        capability.available && capability.declared && capability.granted
    )) {
        context.addIssue({
            code: 'custom',
            path: ['effective'],
            message: 'An effective capability must be available, declared, and granted.',
        });
    }
});

const ContractVersionsSchema = z.object({
    entityReference: z.array(z.number().int().positive()).min(1).max(10),
    entityRead: z.array(z.number().int().positive()).min(1).max(10),
    relationQuery: z.array(z.number().int().positive()).min(1).max(10),
    storage: z.array(z.number().int().positive()).min(1).max(10),
    proposal: z.array(z.number().int().positive()).min(1).max(10),
    contribution: z.array(z.number().int().positive()).min(1).max(10),
    workspace: z.array(z.number().int().positive()).min(1).max(10),
    deviceStorage: z.array(z.number().int().positive()).min(1).max(10).optional(),
    runtimeTransport: z.array(z.number().int().positive()).min(1).max(10).optional(),
    // ADR-034 composed UI v1, advertised after the packaged P10 gate passed.
    composedUi: z.tuple([z.literal(1)]).optional(),
    portableRecord: z.tuple([z.literal(1)]).optional(),
}).strict();

export const PluginHostDescriptorSchema = z.object({
    schema: z.literal('axiom.plugin-host-descriptor'),
    schemaVersion: z.literal(CURRENT_PLUGIN_WORKSPACE_SCHEMA_VERSION),
    hostApiVersion: SemanticVersionSchema,
    contracts: ContractVersionsSchema,
    capabilities: z.array(CapabilityDescriptorSchema).max(32),
    coreEntityKinds: z.array(CoreEntityKindSchema).max(50),
    coreRelationKinds: z.array(CoreRelationKindSchema).max(50),
    supportedContributionFamilies: z.array(SupportedContributionFamilySchema).max(20),
    storageScopes: z.tuple([z.literal('portfolio')]),
    navigation: z.object({
        capability: z.literal('workspace.navigate'),
        actions: z.tuple([z.literal('reveal'), z.literal('inspect')]),
        coreEntityKinds: z.array(CoreEntityKindSchema).max(20),
    }).strict(),
    deviceStorage: z.object({
        settingsCapability: z.literal('plugin-device-settings.write'),
        secretsCapability: z.literal('plugin-secrets.use'),
        settingsScope: z.literal('device-settings'),
        secretsScope: z.literal('device-secrets'),
        secretsProvider: z.literal('os-credential-store'),
        exportedWithPortfolio: z.literal(false),
        backedUpByAxiom: z.literal(false),
    }).strict().optional(),
}).strict();

export const PluginWorkspaceSurfaceSchema = z.enum([
    'designer',
    'journal',
    'dependency',
    'plugin-view',
    'other',
]);

export const PluginWorkspaceContextSchema = z.object({
    schema: z.literal('axiom.plugin-workspace-context'),
    schemaVersion: z.literal(CURRENT_PLUGIN_WORKSPACE_SCHEMA_VERSION),
    portfolioRevision: z.number().int().nonnegative(),
    surface: PluginWorkspaceSurfaceSchema,
    activeContributionId: z.string().trim().min(3).max(240).optional(),
    activeProcess: UniversalEntityReferenceSchema.nullable(),
    primarySelection: UniversalEntityReferenceSchema.nullable(),
    selections: z.array(UniversalEntityReferenceSchema).max(MAX_PLUGIN_WORKSPACE_SELECTIONS),
    truncated: z.boolean(),
}).strict().superRefine((context, refinement) => {
    if (context.activeContributionId && context.surface !== 'plugin-view') {
        refinement.addIssue({
            code: 'custom',
            path: ['activeContributionId'],
            message: 'An active contribution ID is only valid on a plugin view.',
        });
    }
    const identities = new Set<string>();
    context.selections.forEach((reference, index) => {
        const key = `${reference.kind}\u0000${reference.id}`;
        if (identities.has(key)) {
            refinement.addIssue({
                code: 'custom',
                path: ['selections', index],
                message: 'Workspace selections must have unique identities.',
            });
        }
        identities.add(key);
    });
});

export const PluginNavigationActionSchema = z.enum(['reveal', 'inspect']);

export const PluginNavigationIntentSchema = z.object({
    schema: z.literal('axiom.plugin-navigation-intent'),
    schemaVersion: z.literal(CURRENT_PLUGIN_WORKSPACE_SCHEMA_VERSION),
    action: PluginNavigationActionSchema,
    reference: UniversalEntityReferenceSchema,
}).strict();

const navigationResultBase = z.object({
    schema: z.literal('axiom.plugin-navigation-result'),
    schemaVersion: z.literal(CURRENT_PLUGIN_WORKSPACE_SCHEMA_VERSION),
    reference: UniversalEntityReferenceSchema,
}).strict();

export const PluginNavigationResultSchema = z.discriminatedUnion('status', [
    navigationResultBase.extend({ status: z.literal('opened') }).strict(),
    navigationResultBase.extend({ status: z.literal('not-found') }).strict(),
    navigationResultBase.extend({ status: z.literal('unsupported') }).strict(),
]);

export type PluginHostDescriptor = z.infer<typeof PluginHostDescriptorSchema>;
export type PluginWorkspaceSurface = z.infer<typeof PluginWorkspaceSurfaceSchema>;
export type PluginWorkspaceContext = z.infer<typeof PluginWorkspaceContextSchema>;
export type PluginNavigationAction = z.infer<typeof PluginNavigationActionSchema>;
export type PluginNavigationIntentInput = z.input<typeof PluginNavigationIntentSchema>;
export type PluginNavigationIntent = z.infer<typeof PluginNavigationIntentSchema>;
export type PluginNavigationResult = z.infer<typeof PluginNavigationResultSchema>;

export class PluginWorkspaceContractError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_WORKSPACE_CONTRACT' | 'UNSUPPORTED_WORKSPACE_CONTRACT_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginWorkspaceContractError';
    }
}

export const parsePluginNavigationIntent = (value: unknown): PluginNavigationIntent => {
    const version = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).schemaVersion
        : undefined;
    if (typeof version === 'number' && version > CURRENT_PLUGIN_WORKSPACE_SCHEMA_VERSION) {
        throw new PluginWorkspaceContractError(
            'Navigation intent uses a newer unsupported schema version.',
            'UNSUPPORTED_WORKSPACE_CONTRACT_VERSION',
        );
    }
    const result = PluginNavigationIntentSchema.safeParse(value);
    if (!result.success) {
        throw new PluginWorkspaceContractError(
            'Plugin navigation intent validation failed.',
            'INVALID_WORKSPACE_CONTRACT',
            result.error.issues,
        );
    }
    return result.data;
};
