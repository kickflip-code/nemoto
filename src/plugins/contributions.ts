import type { InstalledPluginPackage } from './catalog';
import type { PluginContributionReference, PluginManifest } from './manifest';

export const PLUGIN_CONTRIBUTION_FAMILIES = [
    'vocabularies',
    'recordSchemas',
    'relationSchemas',
    'annotationSchemas',
    'templates',
    'questionSets',
    'aiProfiles',
    'analyses',
    'views',
    'inspectorSections',
    'workflows',
    'deliverables',
    'importers',
    'exporters',
    'themes',
    'commands',
] as const satisfies ReadonlyArray<keyof PluginManifest['contributes']>;

export type PluginContributionFamily = typeof PLUGIN_CONTRIBUTION_FAMILIES[number];

export interface RegisteredPluginContribution extends PluginContributionReference {
    family: PluginContributionFamily;
    pluginId: string;
    pluginVersion: string;
    pluginSource: InstalledPluginPackage['source'];
    activationOrder: number;
}

export interface ContributionRegistryDiagnostic {
    severity: 'error';
    code: 'duplicate-contribution-id';
    message: string;
    contributionId: string;
    pluginIds: string[];
}

export class PluginContributionRegistry {
    readonly size: number;
    readonly #all: readonly RegisteredPluginContribution[];
    readonly #byId: ReadonlyMap<string, RegisteredPluginContribution>;
    readonly #byFamily: ReadonlyMap<PluginContributionFamily, readonly RegisteredPluginContribution[]>;

    constructor(contributions: readonly RegisteredPluginContribution[]) {
        this.#all = contributions.map(contribution => Object.freeze({ ...contribution }));
        this.#byId = new Map(this.#all.map(contribution => [contribution.id, contribution]));
        this.#byFamily = new Map(PLUGIN_CONTRIBUTION_FAMILIES.map(family => [
            family,
            this.#all.filter(contribution => contribution.family === family),
        ]));
        this.size = this.#all.length;
    }

    get(contributionId: string): RegisteredPluginContribution | undefined {
        return this.#byId.get(contributionId);
    }

    list(family?: PluginContributionFamily): RegisteredPluginContribution[] {
        return family
            ? [...(this.#byFamily.get(family) || [])]
            : [...this.#all];
    }
}

export interface BuildContributionRegistryResult {
    registry: PluginContributionRegistry;
    diagnostics: ContributionRegistryDiagnostic[];
}

export function buildContributionRegistry(
    activePlugins: readonly InstalledPluginPackage[],
): BuildContributionRegistryResult {
    const contributions: RegisteredPluginContribution[] = [];

    activePlugins.forEach((pluginPackage, activationOrder) => {
        PLUGIN_CONTRIBUTION_FAMILIES.forEach(family => {
            const references = pluginPackage.manifest.contributes[family] || [];
            references.forEach(reference => {
                contributions.push({
                    ...reference,
                    family,
                    pluginId: pluginPackage.manifest.id,
                    pluginVersion: pluginPackage.manifest.version,
                    pluginSource: pluginPackage.source,
                    activationOrder,
                });
            });
        });
    });

    const diagnostics: ContributionRegistryDiagnostic[] = [];
    const contributionsById = new Map<string, RegisteredPluginContribution[]>();
    contributions.forEach(contribution => {
        const existing = contributionsById.get(contribution.id) || [];
        existing.push(contribution);
        contributionsById.set(contribution.id, existing);
    });

    const conflictedIds = new Set<string>();
    [...contributionsById.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([contributionId, matches]) => {
            if (matches.length < 2) return;
            conflictedIds.add(contributionId);
            diagnostics.push({
                severity: 'error',
                code: 'duplicate-contribution-id',
                message: `Multiple active plugins declare contribution ID ${contributionId}.`,
                contributionId,
                pluginIds: [...new Set(matches.map(match => match.pluginId))].sort(),
            });
        });

    return {
        registry: new PluginContributionRegistry(
            contributions.filter(contribution => !conflictedIds.has(contribution.id)),
        ),
        diagnostics,
    };
}
