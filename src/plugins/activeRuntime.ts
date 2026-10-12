import { createPluginCatalog } from './catalog';
import { createDeclarativePluginRuntime } from './declarativeRuntime';
import type { InstalledPluginDocument } from './installedPackages';
import type { PortfolioPluginRequirement } from './portfolioData';
import { satisfiesVersionRange } from './versionRange';
import { NEMOTO_PLUGIN_API_VERSION } from './activation';
import { PluginViewContributionSchema } from './contributionSchemas';
import { requiredCapabilitiesForPluginUi } from './pluginUiProtocol';

export interface ActiveComposedViewAuthority {
    readonly pluginId: string;
    readonly pluginVersion: string;
    readonly dataVersion: number;
    readonly viewId: string;
    readonly operation: string;
}

export function resolveActiveComposedViewAuthority(
    installed: readonly InstalledPluginDocument[],
    requirements: readonly PortfolioPluginRequirement[],
    viewId: string,
    hostApiVersion = NEMOTO_PLUGIN_API_VERSION,
): ActiveComposedViewAuthority | null {
    const matches = installed.flatMap(document => {
        const reference = document.manifest.contributes.views?.find(candidate => candidate.id === viewId);
        if (!reference) return [];
        const parsed = PluginViewContributionSchema.safeParse(document.contributions[reference.path]);
        if (!parsed.success || parsed.data.id !== viewId || parsed.data.renderer !== 'composed-view') return [];
        const requirement = requirements.filter(candidate => candidate.pluginId === document.manifest.id);
        if (requirement.length !== 1 || requirement[0].activation !== 'active'
            || !satisfiesVersionRange(document.manifest.version, requirement[0].version)
            || document.manifest.dataVersion !== requirement[0].dataVersion
            || !satisfiesVersionRange(hostApiVersion, document.manifest.compatibility.axiomPluginApi)
            || !document.approvedInteractiveOperations.includes(parsed.data.operation)
            || requiredCapabilitiesForPluginUi(parsed.data.ui).some(
                capability => !document.grantedCapabilities.includes(capability),
            )) return [];
        return [{
            pluginId: document.manifest.id,
            pluginVersion: document.manifest.version,
            dataVersion: document.manifest.dataVersion,
            viewId,
            operation: parsed.data.operation,
        }];
    });
    return matches.length === 1 ? Object.freeze(matches[0]) : null;
}

export function createActivePluginRuntime(
    installed: readonly InstalledPluginDocument[],
    requirements: readonly PortfolioPluginRequirement[],
) {
    const catalog = createPluginCatalog(installed.map(document => ({
        manifest: document.manifest,
        source: 'local' as const,
    }))).catalog;
    const installedById = new Map(installed.map(document => [document.manifest.id, document]));
    const activeIds = requirements
        .filter(requirement => requirement.activation === 'active')
        .filter(requirement => {
            const document = installedById.get(requirement.pluginId);
            return !!document
                && satisfiesVersionRange(document.manifest.version, requirement.version)
                && document.manifest.dataVersion === requirement.dataVersion;
        })
        .map(requirement => requirement.pluginId);
    const sources = Object.fromEntries(installed.map(document => [
        document.manifest.id,
        document.contributions,
    ]));
    return createDeclarativePluginRuntime(catalog, activeIds, sources);
}
