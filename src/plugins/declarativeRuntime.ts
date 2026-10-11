import {
    resolvePluginActivation,
    type PluginActivationDiagnostic,
    type PluginActivationResult,
} from './activation';
import type { PluginCatalog } from './catalog';
import {
    buildPluginCommandRegistry,
    PluginCommandRegistry,
    type PluginCommandRegistryDiagnostic,
} from './commandRegistry';
import type { PluginViewContributionSchema } from './contributionSchemas';
import {
    loadPluginContent,
    PluginContentRegistry,
    type PluginContributionSources,
    type PluginContentDiagnostic,
} from './contentRegistry';
import type { z } from 'zod';

type PluginViewContribution = z.infer<typeof PluginViewContributionSchema>;

export interface PluginRuntimeLinkDiagnostic {
    severity: 'error';
    code: 'missing-linked-contribution';
    message: string;
    pluginId: string;
    contributionId: string;
}

export type DeclarativePluginRuntimeDiagnostic =
    | PluginActivationDiagnostic
    | PluginContentDiagnostic
    | PluginRuntimeLinkDiagnostic
    | PluginCommandRegistryDiagnostic;

export interface DeclarativePluginRuntime {
    status: 'ready' | 'blocked';
    activation: PluginActivationResult;
    content: PluginContentRegistry;
    commands: PluginCommandRegistry;
    diagnostics: DeclarativePluginRuntimeDiagnostic[];
    navigationViews: PluginViewContribution[];
}

const validateViewLinks = (
    content: PluginContentRegistry,
): PluginRuntimeLinkDiagnostic[] => {
    const diagnostics: PluginRuntimeLinkDiagnostic[] = [];
    content.list('views').forEach(({ registration, payload }) => {
        if (payload.renderer !== 'guided-resource-journey') return;
        const links = [
            { id: payload.questionSetId, family: 'questionSets' as const },
            { id: payload.templateId, family: 'templates' as const },
            { id: payload.aiProfileId, family: 'aiProfiles' as const },
        ];
        links.forEach(link => {
            if (content.getPayload(link.id, link.family)) return;
            diagnostics.push({
                severity: 'error',
                code: 'missing-linked-contribution',
                message: `View ${payload.id} requires missing ${link.family} contribution ${link.id}.`,
                pluginId: registration.pluginId,
                contributionId: payload.id,
            });
        });
    });

    return diagnostics.sort((left, right) => left.message.localeCompare(right.message));
};

export function createDeclarativePluginRuntime(
    catalog: PluginCatalog,
    requestedPluginIds: readonly string[],
    contributionSources: PluginContributionSources,
): DeclarativePluginRuntime {
    const activation = resolvePluginActivation(catalog, requestedPluginIds);
    if (activation.status === 'blocked') {
        return {
            status: 'blocked',
            activation,
            content: new PluginContentRegistry([]),
            commands: new PluginCommandRegistry([]),
            diagnostics: activation.diagnostics,
            navigationViews: [],
        };
    }

    const loaded = loadPluginContent(activation, contributionSources);
    const linkDiagnostics = validateViewLinks(loaded.registry);
    const commandRegistry = buildPluginCommandRegistry(
        loaded.registry,
        activation.activePlugins,
    );
    const diagnostics: DeclarativePluginRuntimeDiagnostic[] = [
        ...activation.diagnostics,
        ...loaded.diagnostics,
        ...linkDiagnostics,
        ...commandRegistry.diagnostics,
    ];
    const blocked = diagnostics.some(diagnostic => diagnostic.severity === 'error');

    return {
        status: blocked ? 'blocked' : 'ready',
        activation,
        content: blocked ? new PluginContentRegistry([]) : loaded.registry,
        commands: blocked ? new PluginCommandRegistry([]) : commandRegistry.registry,
        diagnostics,
        navigationViews: blocked
            ? []
            : loaded.registry.list('views')
                .map(contribution => contribution.payload)
                .filter(view => view.navigation.surface === 'app-rail')
                .sort((left, right) => (
                    left.navigation.order - right.navigation.order
                    || left.id.localeCompare(right.id)
                )),
    };
}
