import { invoke, isTauri } from '@tauri-apps/api/core';
import {
    ExecutableAuthoritySyncOutcomeSchema,
    createExecutableActivationSnapshot,
    type ExecutableAuthoritySyncOutcome,
} from '../plugins/executableAuthority';
import type { PortfolioPluginRequirement } from '../plugins/portfolioData';

let synchronizationTail: Promise<void> = Promise.resolve();
let lastSynchronizedRequirements: string | null = null;
let pendingRequirements: string | null = null;
let pendingSynchronization: Promise<ExecutableAuthoritySyncOutcome> | null = null;

export function synchronizeExecutablePluginAuthority(
    requirements: readonly PortfolioPluginRequirement[],
    force = false,
): Promise<ExecutableAuthoritySyncOutcome | null> {
    if (!isTauri()) return Promise.resolve(null);
    const snapshot = createExecutableActivationSnapshot(requirements);
    const requirementsKey = JSON.stringify(snapshot.requirements);
    if (!force && requirementsKey === pendingRequirements && pendingSynchronization) {
        return pendingSynchronization;
    }
    if (!force && requirementsKey === lastSynchronizedRequirements) return Promise.resolve(null);

    const task = synchronizationTail.then(async () => (
        ExecutableAuthoritySyncOutcomeSchema.parse(
            await invoke<unknown>('synchronize_executable_plugin_authority', { snapshot }),
        )
    ));
    synchronizationTail = task.then(() => undefined, () => undefined);
    pendingRequirements = requirementsKey;
    pendingSynchronization = task;
    void task.then(() => {
        lastSynchronizedRequirements = requirementsKey;
        if (pendingSynchronization === task) {
            pendingRequirements = null;
            pendingSynchronization = null;
        }
    }, () => {
        if (pendingSynchronization === task) {
            pendingRequirements = null;
            pendingSynchronization = null;
        }
    });
    return task;
}

export function queueExecutablePluginAuthoritySynchronization(
    requirements: readonly PortfolioPluginRequirement[],
    force = false,
): void {
    void synchronizeExecutablePluginAuthority(requirements, force).catch(error => {
        console.error('[PluginHostServices] Executable authority synchronization failed closed:', error);
    });
}
