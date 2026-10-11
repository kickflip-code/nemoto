import {
    PluginManifestError,
    parsePluginManifest,
    type PluginManifest,
} from './manifest';

export type PluginPackageSource = 'bundled' | 'local';

export interface PluginPackageCandidate {
    manifest: unknown;
    source: PluginPackageSource;
}

export interface InstalledPluginPackage {
    readonly manifest: PluginManifest;
    readonly source: PluginPackageSource;
}

export interface PluginCatalogDiagnostic {
    severity: 'error';
    code: 'invalid-manifest' | 'unsupported-manifest-version' | 'duplicate-plugin-id';
    message: string;
    pluginId?: string;
    candidateIndexes: number[];
    issues?: PluginManifestError['issues'];
}

export class PluginCatalog {
    readonly size: number;
    readonly #packages: ReadonlyMap<string, InstalledPluginPackage>;

    constructor(packages: Iterable<InstalledPluginPackage>) {
        const sorted = [...packages].sort((left, right) => (
            left.manifest.id.localeCompare(right.manifest.id)
        ));
        this.#packages = new Map(sorted.map(pluginPackage => [pluginPackage.manifest.id, pluginPackage]));
        this.size = this.#packages.size;
    }

    get(pluginId: string): InstalledPluginPackage | undefined {
        return this.#packages.get(pluginId);
    }

    has(pluginId: string): boolean {
        return this.#packages.has(pluginId);
    }

    list(): InstalledPluginPackage[] {
        return [...this.#packages.values()];
    }
}

export interface CreatePluginCatalogResult {
    catalog: PluginCatalog;
    diagnostics: PluginCatalogDiagnostic[];
}

const pluginIdHint = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? id : undefined;
};

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

export function createPluginCatalog(
    candidates: readonly PluginPackageCandidate[],
): CreatePluginCatalogResult {
    const diagnostics: PluginCatalogDiagnostic[] = [];
    const validCandidates: Array<InstalledPluginPackage & { candidateIndex: number }> = [];

    candidates.forEach((candidate, candidateIndex) => {
        try {
            validCandidates.push({
                manifest: deepFreeze(parsePluginManifest(candidate.manifest)),
                source: candidate.source,
                candidateIndex,
            });
        } catch (error) {
            const manifestError = error instanceof PluginManifestError ? error : null;
            diagnostics.push({
                severity: 'error',
                code: manifestError?.code === 'UNSUPPORTED_SCHEMA_VERSION'
                    ? 'unsupported-manifest-version'
                    : 'invalid-manifest',
                message: manifestError?.message || 'Plugin manifest validation failed.',
                pluginId: pluginIdHint(candidate.manifest),
                candidateIndexes: [candidateIndex],
                issues: manifestError?.issues,
            });
        }
    });

    const candidatesById = new Map<string, Array<InstalledPluginPackage & { candidateIndex: number }>>();
    validCandidates.forEach(candidate => {
        const existing = candidatesById.get(candidate.manifest.id) || [];
        existing.push(candidate);
        candidatesById.set(candidate.manifest.id, existing);
    });

    const accepted: InstalledPluginPackage[] = [];
    [...candidatesById.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([pluginId, matchingCandidates]) => {
            if (matchingCandidates.length > 1) {
                diagnostics.push({
                    severity: 'error',
                    code: 'duplicate-plugin-id',
                    message: `Multiple installed packages declare plugin ID ${pluginId}.`,
                    pluginId,
                    candidateIndexes: matchingCandidates
                        .map(candidate => candidate.candidateIndex)
                        .sort((left, right) => left - right),
                });
                return;
            }

            const candidate = matchingCandidates[0];
            accepted.push(deepFreeze({
                manifest: candidate.manifest,
                source: candidate.source,
            }));
        });

    diagnostics.sort((left, right) => (
        (left.pluginId || '').localeCompare(right.pluginId || '')
        || left.code.localeCompare(right.code)
        || left.candidateIndexes[0] - right.candidateIndexes[0]
    ));

    return {
        catalog: new PluginCatalog(accepted),
        diagnostics,
    };
}
