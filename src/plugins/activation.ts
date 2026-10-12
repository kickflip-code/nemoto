import type { InstalledPluginPackage, PluginCatalog } from './catalog';
import {
    PluginContributionRegistry,
    buildContributionRegistry,
    type ContributionRegistryDiagnostic,
} from './contributions';
import { satisfiesVersionRange } from './versionRange';

export const NEMOTO_PLUGIN_API_VERSION = '1.8.0';

export type PluginActivationDiagnosticCode =
    | 'duplicate-request'
    | 'missing-requested-plugin'
    | 'incompatible-plugin-api'
    | 'missing-required-dependency'
    | 'incompatible-dependency-version'
    | 'dependency-cycle'
    | ContributionRegistryDiagnostic['code'];

export interface PluginActivationDiagnostic {
    severity: 'error' | 'warning';
    code: PluginActivationDiagnosticCode;
    message: string;
    pluginId?: string;
    dependencyId?: string;
    contributionId?: string;
    relatedPluginIds?: string[];
}

export interface PluginActivationResult {
    status: 'ready' | 'blocked';
    requestedPluginIds: string[];
    activePlugins: InstalledPluginPackage[];
    activePluginIds: string[];
    registry: PluginContributionRegistry;
    diagnostics: PluginActivationDiagnostic[];
}

type VisitState = 'visiting' | 'visited';

const diagnosticKey = (diagnostic: PluginActivationDiagnostic): string => JSON.stringify([
    diagnostic.code,
    diagnostic.pluginId,
    diagnostic.dependencyId,
    diagnostic.contributionId,
    diagnostic.relatedPluginIds,
]);

const sortDiagnostics = (
    diagnostics: PluginActivationDiagnostic[],
): PluginActivationDiagnostic[] => diagnostics.sort((left, right) => (
    (left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1)
    || left.code.localeCompare(right.code)
    || (left.pluginId || '').localeCompare(right.pluginId || '')
    || (left.dependencyId || '').localeCompare(right.dependencyId || '')
    || (left.contributionId || '').localeCompare(right.contributionId || '')
));

export function resolvePluginActivation(
    catalog: PluginCatalog,
    requestedPluginIds: readonly string[],
    hostPluginApiVersion = NEMOTO_PLUGIN_API_VERSION,
): PluginActivationResult {
    const diagnostics: PluginActivationDiagnostic[] = [];
    const diagnosticKeys = new Set<string>();
    const addDiagnostic = (diagnostic: PluginActivationDiagnostic): void => {
        const key = diagnosticKey(diagnostic);
        if (diagnosticKeys.has(key)) return;
        diagnosticKeys.add(key);
        diagnostics.push(diagnostic);
    };

    const requestCounts = new Map<string, number>();
    requestedPluginIds.forEach(pluginId => {
        requestCounts.set(pluginId, (requestCounts.get(pluginId) || 0) + 1);
    });
    const requested = [...requestCounts.keys()].sort();
    [...requestCounts.entries()]
        .filter(([, count]) => count > 1)
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([pluginId]) => addDiagnostic({
            severity: 'warning',
            code: 'duplicate-request',
            message: `Plugin ${pluginId} was requested more than once and will be activated once.`,
            pluginId,
        }));

    const visitState = new Map<string, VisitState>();
    const ordered: InstalledPluginPackage[] = [];
    const stack: string[] = [];

    const visit = (pluginId: string, requiredBy?: string): void => {
        const state = visitState.get(pluginId);
        if (state === 'visited') return;
        if (state === 'visiting') {
            const cycleStart = stack.indexOf(pluginId);
            const cycle = [...stack.slice(Math.max(0, cycleStart)), pluginId];
            addDiagnostic({
                severity: 'error',
                code: 'dependency-cycle',
                message: `Plugin dependency cycle detected: ${cycle.join(' -> ')}.`,
                pluginId,
                relatedPluginIds: cycle,
            });
            return;
        }

        const pluginPackage = catalog.get(pluginId);
        if (!pluginPackage) {
            addDiagnostic(requiredBy ? {
                severity: 'error',
                code: 'missing-required-dependency',
                message: `Plugin ${requiredBy} requires missing plugin ${pluginId}.`,
                pluginId: requiredBy,
                dependencyId: pluginId,
            } : {
                severity: 'error',
                code: 'missing-requested-plugin',
                message: `Requested plugin ${pluginId} is not installed.`,
                pluginId,
            });
            return;
        }

        if (!satisfiesVersionRange(hostPluginApiVersion, pluginPackage.manifest.compatibility.axiomPluginApi)) {
            addDiagnostic({
                severity: 'error',
                code: 'incompatible-plugin-api',
                message: `Plugin ${pluginId} requires Nemoto plugin API ${pluginPackage.manifest.compatibility.axiomPluginApi}, but the host provides ${hostPluginApiVersion}.`,
                pluginId,
            });
        }

        visitState.set(pluginId, 'visiting');
        stack.push(pluginId);

        [...pluginPackage.manifest.dependencies]
            .sort((left, right) => left.id.localeCompare(right.id))
            .forEach(dependency => {
                if (dependency.optional && !requestCounts.has(dependency.id)) return;

                const installedDependency = catalog.get(dependency.id);
                if (!installedDependency) {
                    if (!dependency.optional) visit(dependency.id, pluginId);
                    return;
                }

                if (!satisfiesVersionRange(installedDependency.manifest.version, dependency.version)) {
                    addDiagnostic({
                        severity: 'error',
                        code: 'incompatible-dependency-version',
                        message: `Plugin ${pluginId} requires ${dependency.id} ${dependency.version}, but version ${installedDependency.manifest.version} is installed.`,
                        pluginId,
                        dependencyId: dependency.id,
                    });
                }
                visit(dependency.id, pluginId);
            });

        stack.pop();
        visitState.set(pluginId, 'visited');
        ordered.push(pluginPackage);
    };

    requested.forEach(pluginId => visit(pluginId));

    const hasResolutionErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error');
    if (hasResolutionErrors) {
        return {
            status: 'blocked',
            requestedPluginIds: requested,
            activePlugins: [],
            activePluginIds: [],
            registry: new PluginContributionRegistry([]),
            diagnostics: sortDiagnostics(diagnostics),
        };
    }

    const registryResult = buildContributionRegistry(ordered);
    registryResult.diagnostics.forEach(diagnostic => addDiagnostic({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        contributionId: diagnostic.contributionId,
        relatedPluginIds: diagnostic.pluginIds,
    }));

    if (registryResult.diagnostics.length > 0) {
        return {
            status: 'blocked',
            requestedPluginIds: requested,
            activePlugins: [],
            activePluginIds: [],
            registry: new PluginContributionRegistry([]),
            diagnostics: sortDiagnostics(diagnostics),
        };
    }

    return {
        status: 'ready',
        requestedPluginIds: requested,
        activePlugins: ordered,
        activePluginIds: ordered.map(pluginPackage => pluginPackage.manifest.id),
        registry: registryResult.registry,
        diagnostics: sortDiagnostics(diagnostics),
    };
}
