import { z } from 'zod';
import { InstalledPluginDocumentSchema, type InstalledPluginDocument } from './installedPackages';
import { PluginCapabilitySchema, type PluginCapability } from './manifest';
import { PluginIdSchema, SemanticVersionSchema } from './identifiers';
import { compareSemanticVersions, parseSemanticVersion } from './versionRange';

export const AXIOM_EXECUTABLE_PACKAGE_REVIEW_SCHEMA = 'axiom.executable-package-review';
export const AXIOM_EXECUTABLE_PACKAGE_REVIEW_SCHEMA_VERSION = 1;
export const AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA = 'axiom.executable-install-approval';
export const AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION = 1;
export const ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT = 'isolated-compute-v1';

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const InteractiveOperationSchema = z.object({
    viewId: z.string().trim().min(3).max(240),
    operation: z.string().trim().min(1).max(240).regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/),
    requiredCapabilities: z.array(PluginCapabilitySchema).min(1).max(32)
        .refine(values => new Set(values).size === values.length),
}).strict().readonly();

export const WasmPluginIdentitySchema = z.object({
    pluginId: PluginIdSchema,
    pluginVersion: SemanticVersionSchema,
    dataVersion: z.number().int().positive(),
}).strict().readonly();

export const ExecutablePackageReviewSchema = z.object({
    schema: z.literal(AXIOM_EXECUTABLE_PACKAGE_REVIEW_SCHEMA),
    schemaVersion: z.literal(AXIOM_EXECUTABLE_PACKAGE_REVIEW_SCHEMA_VERSION),
    archiveSha256: Sha256Schema,
    identity: WasmPluginIdentitySchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    publisherName: z.string().trim().min(1).max(120).nullable().optional(),
    requestedCapabilities: z.array(PluginCapabilitySchema).min(1).max(32)
        .refine(values => new Set(values).size === values.length, 'Requested capabilities must be unique.'),
    moduleSha256: Sha256Schema,
    compressedBytes: z.number().int().positive().max(10 * 1024 * 1024),
    expandedBytes: z.number().int().positive().max(25 * 1024 * 1024),
    contributionCount: z.number().int().positive().max(100),
    interactiveOperations: z.array(InteractiveOperationSchema).max(100).optional().default([]),
}).strict().superRefine((review, context) => {
    if (!review.requestedCapabilities.includes('compute.isolated')) {
        context.addIssue({
            code: 'custom',
            path: ['requestedCapabilities'],
            message: 'Executable package review must request compute.isolated.',
        });
    }
    const viewIds = new Set<string>();
    const operations = new Set<string>();
    review.interactiveOperations.forEach((binding, index) => {
        if (!binding.requiredCapabilities.includes('compute.isolated')) {
            context.addIssue({ code: 'custom', path: ['interactiveOperations', index, 'requiredCapabilities'], message: 'Interactive operations require compute.isolated.' });
        }
        if (binding.requiredCapabilities.some(capability => !review.requestedCapabilities.includes(capability))) {
            context.addIssue({ code: 'custom', path: ['interactiveOperations', index, 'requiredCapabilities'], message: 'Interactive operation capabilities must be requested by the package.' });
        }
        if (viewIds.has(binding.viewId) || operations.has(binding.operation)) {
            context.addIssue({ code: 'custom', path: ['interactiveOperations', index], message: 'Interactive view and operation bindings must be unique.' });
        }
        viewIds.add(binding.viewId); operations.add(binding.operation);
    });
}).readonly();

export type ExecutablePackageReview = z.infer<typeof ExecutablePackageReviewSchema>;

export const ExecutableInstallApprovalSchema = z.object({
    schema: z.literal(AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA),
    schemaVersion: z.literal(AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION),
    archiveSha256: Sha256Schema,
    identity: WasmPluginIdentitySchema,
    grantedCapabilities: z.array(PluginCapabilitySchema).min(1).max(32)
        .refine(values => new Set(values).size === values.length, 'Granted capabilities must be unique.'),
    riskAcknowledgement: z.literal(ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT),
    approvedInteractiveOperations: z.array(z.string().trim().min(1).max(240)
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]*[A-Za-z0-9])?$/)).max(100)
        .refine(values => new Set(values).size === values.length).optional().default([]),
}).strict().superRefine((approval, context) => {
    if (!approval.grantedCapabilities.includes('compute.isolated')) {
        context.addIssue({
            code: 'custom',
            path: ['grantedCapabilities'],
            message: 'Executable package approval must grant compute.isolated.',
        });
    }
}).readonly();

export type ExecutableInstallApproval = z.infer<typeof ExecutableInstallApprovalSchema>;

export const ExecutablePackageInstallResponseSchema = z.object({
    schema: z.literal('axiom.executable-package-install-result'),
    schemaVersion: z.literal(1),
    transactionId: z.string().regex(/^[0-9a-f]{32}$/),
    reusedExistingRuntime: z.boolean(),
    installedDocument: InstalledPluginDocumentSchema,
}).strict().readonly();

export type ExecutablePackageInstallResponse = z.infer<typeof ExecutablePackageInstallResponseSchema>;

export type ExecutablePackageChangeKind = 'install' | 'reinstall' | 'update' | 'rejected';

export interface ExecutablePackageChangeReview {
    readonly kind: ExecutablePackageChangeKind;
    readonly current: InstalledPluginDocument | null;
    readonly newlyRequestedCapabilities: readonly PluginCapability[];
    readonly reason?: string;
}

export function classifyExecutablePackageChange(
    review: ExecutablePackageReview,
    installed: readonly InstalledPluginDocument[],
): ExecutablePackageChangeReview {
    const current = installed.find(document => document.manifest.id === review.identity.pluginId) || null;
    if (!current) {
        return {
            kind: 'install',
            current,
            newlyRequestedCapabilities: review.requestedCapabilities,
        };
    }

    const newlyRequestedCapabilities = review.requestedCapabilities.filter(
        capability => !current.grantedCapabilities.includes(capability),
    );
    if (current.manifest.version === review.identity.pluginVersion
        && current.manifest.dataVersion === review.identity.dataVersion) {
        return { kind: 'reinstall', current, newlyRequestedCapabilities };
    }

    const currentVersion = parseSemanticVersion(current.manifest.version);
    const candidateVersion = parseSemanticVersion(review.identity.pluginVersion);
    if (!currentVersion || !candidateVersion
        || compareSemanticVersions(candidateVersion, currentVersion) <= 0) {
        return {
            kind: 'rejected',
            current,
            newlyRequestedCapabilities,
            reason: 'Executable plugin updates must increase the package version.',
        };
    }
    if (review.identity.dataVersion < current.manifest.dataVersion) {
        return {
            kind: 'rejected',
            current,
            newlyRequestedCapabilities,
            reason: 'Executable plugin updates cannot lower the plugin data version.',
        };
    }
    return { kind: 'update', current, newlyRequestedCapabilities };
}

export function createExecutableInstallApproval(
    review: ExecutablePackageReview,
    grantedCapabilities: readonly PluginCapability[],
    riskAcknowledged: boolean,
): ExecutableInstallApproval {
    if (!riskAcknowledged) {
        throw new Error('Explicit isolated-compute acknowledgement is required.');
    }
    const requested = new Set<PluginCapability>(review.requestedCapabilities);
    if (grantedCapabilities.some(capability => !requested.has(capability))) {
        throw new Error('Approval cannot grant a capability the package did not request.');
    }
    const granted = new Set(grantedCapabilities);
    if (review.interactiveOperations.some(binding => (
        binding.requiredCapabilities.some(capability => !granted.has(capability))
    ))) {
        throw new Error('Approval must grant every capability required by an interactive operation.');
    }
    return ExecutableInstallApprovalSchema.parse({
        schema: AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA,
        schemaVersion: AXIOM_EXECUTABLE_INSTALL_APPROVAL_SCHEMA_VERSION,
        archiveSha256: review.archiveSha256,
        identity: review.identity,
        grantedCapabilities: [...grantedCapabilities],
        riskAcknowledgement: ISOLATED_COMPUTE_RISK_ACKNOWLEDGEMENT,
        approvedInteractiveOperations: review.interactiveOperations.map(binding => binding.operation),
    });
}
