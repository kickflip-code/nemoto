import type { PluginCommandContribution } from './contributionSchemas';
import type { PluginContentRegistry } from './contentRegistry';
import type { InstalledPluginPackage } from './catalog';

export interface RegisteredPluginCommand extends PluginCommandContribution {
    readonly pluginId: string;
    readonly pluginVersion: string;
}

export interface PluginCommandRegistryDiagnostic {
    readonly severity: 'error';
    readonly code: 'missing-command-target' | 'foreign-command-target' | 'ineligible-compute-command';
    readonly message: string;
    readonly pluginId: string;
    readonly contributionId: string;
    readonly targetViewId?: string;
}

export class PluginCommandRegistry {
    readonly size: number;
    readonly #byId: ReadonlyMap<string, RegisteredPluginCommand>;
    readonly #ordered: readonly RegisteredPluginCommand[];

    constructor(commands: readonly RegisteredPluginCommand[]) {
        this.#ordered = commands
            .map(command => Object.freeze({ ...command }))
            .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
        this.#byId = new Map(this.#ordered.map(command => [command.id, command]));
        this.size = this.#ordered.length;
    }

    get(commandId: string): RegisteredPluginCommand | undefined {
        return this.#byId.get(commandId);
    }

    list(placement?: PluginCommandContribution['placement']): RegisteredPluginCommand[] {
        return this.#ordered.filter(command => !placement || command.placement === placement);
    }
}

export interface BuildPluginCommandRegistryResult {
    readonly registry: PluginCommandRegistry;
    readonly diagnostics: PluginCommandRegistryDiagnostic[];
}

export function buildPluginCommandRegistry(
    content: PluginContentRegistry,
    activePlugins: readonly InstalledPluginPackage[] = [],
): BuildPluginCommandRegistryResult {
    const commands: RegisteredPluginCommand[] = [];
    const diagnostics: PluginCommandRegistryDiagnostic[] = [];

    content.list('commands').forEach(({ registration, payload }) => {
        if (payload.action.kind === 'compute.propose') {
            const owner = activePlugins.find(candidate => (
                candidate.manifest.id === registration.pluginId
            ));
            const capabilities = new Set(owner?.manifest.capabilities || []);
            if (!owner?.manifest.runtime
                || !capabilities.has('compute.isolated')
                || !capabilities.has('portfolio.read-scoped')
                || !capabilities.has('proposal.create')) {
                diagnostics.push({
                    severity: 'error',
                    code: 'ineligible-compute-command',
                    message: `Command ${payload.id} requires an executable package with compute, scoped-read, and proposal capabilities.`,
                    pluginId: registration.pluginId,
                    contributionId: payload.id,
                });
                return;
            }
            commands.push({
                ...payload,
                pluginId: registration.pluginId,
                pluginVersion: registration.pluginVersion,
            });
            return;
        }

        const target = content.get(payload.action.viewId);
        if (!target || target.registration.family !== 'views') {
            diagnostics.push({
                severity: 'error',
                code: 'missing-command-target',
                message: `Command ${payload.id} requires missing view contribution ${payload.action.viewId}.`,
                pluginId: registration.pluginId,
                contributionId: payload.id,
                targetViewId: payload.action.viewId,
            });
            return;
        }
        if (target.registration.pluginId !== registration.pluginId) {
            diagnostics.push({
                severity: 'error',
                code: 'foreign-command-target',
                message: `Command ${payload.id} cannot open a view owned by plugin ${target.registration.pluginId}.`,
                pluginId: registration.pluginId,
                contributionId: payload.id,
                targetViewId: payload.action.viewId,
            });
            return;
        }

        commands.push({
            ...payload,
            pluginId: registration.pluginId,
            pluginVersion: registration.pluginVersion,
        });
    });

    diagnostics.sort((left, right) => (
        left.contributionId.localeCompare(right.contributionId)
        || left.code.localeCompare(right.code)
    ));

    return {
        registry: diagnostics.length > 0 ? new PluginCommandRegistry([]) : new PluginCommandRegistry(commands),
        diagnostics,
    };
}
