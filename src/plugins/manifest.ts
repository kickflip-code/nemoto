import { z } from 'zod';
import { isValidVersionRange } from './versionRange';
import {
    CONTRIBUTION_SUFFIX_PATTERN,
    PluginIdSchema,
    SemanticVersionSchema,
} from './identifiers';

export const AXIOM_PLUGIN_SCHEMA = 'axiom.plugin';
export const CURRENT_PLUGIN_MANIFEST_SCHEMA_VERSION = 1;
export const AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA = 'axiom.plugin-wasm-runtime';
export const CURRENT_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION = 1;
export const AXIOM_PLUGIN_WASM_ABI = 'axiom-wasm-v1';

const CompatibilityRangeSchema = z.string()
    .trim()
    .min(1)
    .max(100)
    .refine(isValidVersionRange, 'Version range uses unsupported or invalid syntax.');

const PackagePathSchema = z.string().trim().min(1).max(240).superRefine((path, context) => {
    const segments = path.split('/');
    const isSafe = !path.startsWith('/')
        && !path.includes('\\')
        && !/^[A-Za-z]:/.test(path)
        && segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');

    if (!isSafe) {
        context.addIssue({
            code: 'custom',
            message: 'Contribution paths must be normalized package-relative paths.',
        });
    }
});

export const PluginWasmRuntimeSchema = z.object({
    schema: z.literal(AXIOM_PLUGIN_WASM_RUNTIME_SCHEMA),
    schemaVersion: z.literal(CURRENT_PLUGIN_WASM_RUNTIME_SCHEMA_VERSION),
    abi: z.literal(AXIOM_PLUGIN_WASM_ABI),
    module: PackagePathSchema.superRefine((path, context) => {
        if (!path.startsWith('runtime/') || !path.endsWith('.wasm')) {
            context.addIssue({
                code: 'custom',
                message: 'The WebAssembly module must be a .wasm file below runtime/.',
            });
        }
    }),
}).strict();

export const PluginCapabilitySchema = z.enum([
    'portfolio.read-scoped',
    'portfolio.read-sensitive',
    'proposal.create',
    'plugin-data.write',
    'plugin-device-settings.write',
    'plugin-secrets.use',
    'workspace.navigate',
    'ai.invoke',
    'file.read-selected',
    'file.write-selected',
    'network.declared',
    'clipboard.read',
    'clipboard.write',
    'compute.isolated',
    'background.run',
]);

export const PluginCategorySchema = z.enum([
    'lens',
    'method',
    'domain',
    'knowledge',
    'adapter',
    'ai',
    'theme',
]);

export const PluginContributionReferenceSchema = z.object({
    id: z.string().trim().min(3).max(240),
    path: PackagePathSchema,
    optional: z.boolean().optional().default(false),
}).strict();

export const PluginDependencySchema = z.object({
    id: PluginIdSchema,
    version: CompatibilityRangeSchema,
    optional: z.boolean().optional().default(false),
}).strict();

const contributionList = z.array(PluginContributionReferenceSchema).max(1000).optional();

export const PluginContributionsSchema = z.object({
    vocabularies: contributionList,
    recordSchemas: contributionList,
    relationSchemas: contributionList,
    annotationSchemas: contributionList,
    templates: contributionList,
    questionSets: contributionList,
    aiProfiles: contributionList,
    analyses: contributionList,
    views: contributionList,
    inspectorSections: contributionList,
    workflows: contributionList,
    deliverables: contributionList,
    importers: contributionList,
    exporters: contributionList,
    themes: contributionList,
    commands: contributionList,
}).strict().superRefine((contributions, context) => {
    const hasContribution = Object.values(contributions)
        .some(items => Array.isArray(items) && items.length > 0);

    if (!hasContribution) {
        context.addIssue({
            code: 'custom',
            message: 'A plugin must declare at least one contribution.',
        });
    }
});

export const PluginManifestSchema = z.object({
    schema: z.literal(AXIOM_PLUGIN_SCHEMA),
    schemaVersion: z.literal(CURRENT_PLUGIN_MANIFEST_SCHEMA_VERSION),
    id: PluginIdSchema,
    version: SemanticVersionSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000),
    categories: z.array(PluginCategorySchema).max(7).optional().default([]),
    publisher: z.object({
        name: z.string().trim().min(1).max(120),
        url: z.string().url().optional(),
    }).strict().optional(),
    homepage: z.string().url().optional(),
    license: z.string().trim().min(1).max(80).optional(),
    compatibility: z.object({
        axiomPluginApi: CompatibilityRangeSchema,
    }).strict(),
    dataVersion: z.number().int().positive().optional().default(1),
    capabilities: z.array(PluginCapabilitySchema).max(32).optional().default([]),
    dependencies: z.array(PluginDependencySchema).max(100).optional().default([]),
    runtime: PluginWasmRuntimeSchema.optional(),
    contributes: PluginContributionsSchema,
}).strict().superRefine((manifest, context) => {
    const capabilities = new Set<string>();
    manifest.capabilities.forEach((capability, index) => {
        if (capabilities.has(capability)) {
            context.addIssue({
                code: 'custom',
                path: ['capabilities', index],
                message: `Duplicate capability: ${capability}.`,
            });
        }
        capabilities.add(capability);
    });

    const declaresIsolatedCompute = capabilities.has('compute.isolated');
    if (manifest.runtime && !declaresIsolatedCompute) {
        context.addIssue({
            code: 'custom',
            path: ['runtime'],
            message: 'A WebAssembly runtime must declare the compute.isolated capability.',
        });
    }
    if (declaresIsolatedCompute && !manifest.runtime) {
        context.addIssue({
            code: 'custom',
            path: ['capabilities'],
            message: 'The compute.isolated capability requires a versioned WebAssembly runtime entry point.',
        });
    }

    const dependencies = new Set<string>();
    manifest.dependencies.forEach((dependency, index) => {
        if (dependency.id === manifest.id) {
            context.addIssue({
                code: 'custom',
                path: ['dependencies', index, 'id'],
                message: 'A plugin cannot depend on itself.',
            });
        }
        if (dependencies.has(dependency.id)) {
            context.addIssue({
                code: 'custom',
                path: ['dependencies', index, 'id'],
                message: `Duplicate dependency: ${dependency.id}.`,
            });
        }
        dependencies.add(dependency.id);
    });

    const contributionIds = new Set<string>();
    Object.entries(manifest.contributes).forEach(([family, references]) => {
        references?.forEach((reference, index) => {
            const prefix = `${manifest.id}/`;
            const suffix = reference.id.startsWith(prefix)
                ? reference.id.slice(prefix.length)
                : '';

            if (!suffix || !CONTRIBUTION_SUFFIX_PATTERN.test(suffix)) {
                context.addIssue({
                    code: 'custom',
                    path: ['contributes', family, index, 'id'],
                    message: `Contribution ID must start with ${prefix} and contain a portable local ID.`,
                });
            }

            if (contributionIds.has(reference.id)) {
                context.addIssue({
                    code: 'custom',
                    path: ['contributes', family, index, 'id'],
                    message: `Duplicate contribution ID: ${reference.id}.`,
                });
            }
            contributionIds.add(reference.id);
        });
    });
});

export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;
export type PluginCategory = z.infer<typeof PluginCategorySchema>;
export type PluginContributionReference = z.infer<typeof PluginContributionReferenceSchema>;
export type PluginDependency = z.infer<typeof PluginDependencySchema>;
export type PluginWasmRuntime = z.infer<typeof PluginWasmRuntimeSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export class PluginManifestError extends Error {
    constructor(
        message: string,
        readonly code: 'INVALID_MANIFEST' | 'UNSUPPORTED_SCHEMA_VERSION',
        readonly issues: z.ZodIssue[] = [],
    ) {
        super(message);
        this.name = 'PluginManifestError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

export function parsePluginManifest(value: unknown): PluginManifest {
    if (isRecord(value)) {
        const version = value.schemaVersion;
        if (typeof version === 'number'
            && Number.isInteger(version)
            && version > CURRENT_PLUGIN_MANIFEST_SCHEMA_VERSION) {
            throw new PluginManifestError(
                `Plugin manifest schema version ${version} is newer than the supported version ${CURRENT_PLUGIN_MANIFEST_SCHEMA_VERSION}.`,
                'UNSUPPORTED_SCHEMA_VERSION',
            );
        }
    }

    const result = PluginManifestSchema.safeParse(value);
    if (!result.success) {
        throw new PluginManifestError(
            'Plugin manifest validation failed.',
            'INVALID_MANIFEST',
            result.error.issues,
        );
    }

    return result.data;
}
