import type { PluginCommandRegistry } from '../plugins/commandRegistry';
import type { PluginHostServices } from '../plugins/hostServices';
import { pluginDeveloperDiagnostics } from './pluginDeveloperDiagnostics';
import { ExecutableProposalCommandContextError } from './pluginExecutableProposalCommands';

export class PluginCommandExecutionError extends Error {
    constructor(readonly commandId: string) {
        super(`Plugin command '${commandId}' is not registered.`);
        this.name = 'PluginCommandExecutionError';
    }
}

export interface PluginNavigationCommandExecutionResult {
    readonly status: 'executed';
    readonly commandId: string;
    readonly pluginId: string;
    readonly action: 'navigation.open-view';
    readonly targetViewId: string;
}

export interface PluginProposalCommandExecutionResult {
    readonly status: 'proposal-submitted';
    readonly commandId: string;
    readonly pluginId: string;
    readonly action: 'compute.propose';
    readonly proposalId: string;
}

export type PluginCommandExecutionResult =
    | PluginNavigationCommandExecutionResult
    | PluginProposalCommandExecutionResult;

export function executePluginCommand(
    registry: PluginCommandRegistry,
    commandId: string,
    host: Pick<PluginHostServices, 'navigation' | 'executableProposals'>,
): PluginCommandExecutionResult | Promise<PluginCommandExecutionResult> {
    const command = registry.get(commandId);
    if (!command) {
        pluginDeveloperDiagnostics.record({
            source: 'command',
            severity: 'error',
            code: 'command.unregistered',
            context: { outcome: 'failed' },
        });
        throw new PluginCommandExecutionError(commandId);
    }

    const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (command.action.kind === 'compute.propose') {
        return host.executableProposals.run(command).then(({ proposalId }) => {
            const finishedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
            pluginDeveloperDiagnostics.recordCommand(command, 'succeeded', finishedAt - startedAt);
            return Object.freeze({
                status: 'proposal-submitted' as const,
                commandId: command.id,
                pluginId: command.pluginId,
                action: 'compute.propose' as const,
                proposalId,
            });
        }).catch(error => {
            const finishedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
            pluginDeveloperDiagnostics.recordCommand(
                command,
                'failed',
                finishedAt - startedAt,
                error instanceof ExecutableProposalCommandContextError ? error.code : undefined,
            );
            throw error;
        });
    }
    try {
        host.navigation.open(command.action.viewId);
        const finishedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
        pluginDeveloperDiagnostics.recordCommand(command, 'succeeded', finishedAt - startedAt);
        return Object.freeze({
            status: 'executed',
            commandId: command.id,
            pluginId: command.pluginId,
            action: command.action.kind,
            targetViewId: command.action.viewId,
        });
    } catch (error) {
        const finishedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
        pluginDeveloperDiagnostics.recordCommand(command, 'failed', finishedAt - startedAt);
        throw error;
    }
}
