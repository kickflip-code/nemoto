import { NEMOTO_PLUGIN_API_VERSION } from '../plugins/activation';
import {
    buildPluginDiagnosticInventory,
    createSanitizedPluginDiagnosticBundle,
    PluginDiagnosticBroker,
    type PluginDeveloperDiagnosticSnapshot,
    type PluginDiagnosticInput,
    type PluginDiagnosticSource,
    type SanitizedPluginDiagnosticBundle,
} from '../plugins/developerDiagnostics';
import type { DeclarativePluginRuntime } from '../plugins/declarativeRuntime';
import type { InstalledPluginDocument } from '../plugins/installedPackages';
import {
    MAX_PLUGIN_COLLECTION_ITEMS,
    MAX_PLUGIN_DATA_BYTES,
    MAX_PLUGIN_ENTRY_BYTES,
    MAX_PLUGIN_EXPANDED_BYTES,
    MAX_PLUGIN_PACKAGE_BYTES,
    MAX_PLUGIN_PACKAGE_ENTRIES,
} from '../plugins/pluginLimits';
import type { PortfolioPluginRequirement } from '../plugins/portfolioData';
import type { PluginHostEvent } from '../plugins/hostServices';
import { usePluginStore } from '../stores/usePluginStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useSettingsStore } from '../stores/useSettingsStore';

interface PluginDeveloperDiagnosticsDependencies {
    readonly broker: PluginDiagnosticBroker;
    readonly getInstalledPlugins: () => readonly InstalledPluginDocument[];
    readonly getRequirements: () => readonly PortfolioPluginRequirement[];
}

const runtimeDiagnosticSource = (
    diagnostic: DeclarativePluginRuntime['diagnostics'][number],
): PluginDiagnosticSource => {
    if (diagnostic.code === 'missing-command-target' || diagnostic.code === 'foreign-command-target') {
        return 'command';
    }
    if (diagnostic.code === 'missing-linked-contribution' || 'family' in diagnostic) return 'content';
    return 'activation';
};

export class PluginDeveloperDiagnosticsService {
    readonly #broker: PluginDiagnosticBroker;
    readonly #getInstalledPlugins: () => readonly InstalledPluginDocument[];
    readonly #getRequirements: () => readonly PortfolioPluginRequirement[];
    #capturedRuntimes = new WeakSet<DeclarativePluginRuntime>();

    constructor(dependencies: PluginDeveloperDiagnosticsDependencies) {
        this.#broker = dependencies.broker;
        this.#getInstalledPlugins = dependencies.getInstalledPlugins;
        this.#getRequirements = dependencies.getRequirements;
    }

    get enabled(): boolean {
        return this.#broker.enabled;
    }

    setEnabled(enabled: boolean): void {
        this.#broker.setEnabled(enabled);
        if (!enabled) this.#capturedRuntimes = new WeakSet<DeclarativePluginRuntime>();
    }

    clear(): void {
        this.#broker.clear();
        this.#capturedRuntimes = new WeakSet<DeclarativePluginRuntime>();
    }

    subscribe(listener: () => void): () => void {
        return this.#broker.subscribe(listener);
    }

    record(input: PluginDiagnosticInput): void {
        this.#broker.record(input);
    }

    captureRuntime(runtime: DeclarativePluginRuntime, durationMs?: number): void {
        if (!this.enabled || this.#capturedRuntimes.has(runtime)) return;
        this.#capturedRuntimes.add(runtime);
        this.#broker.record({
            source: 'activation',
            severity: runtime.status === 'ready' ? 'info' : 'error',
            code: runtime.status === 'ready' ? 'runtime.ready' : 'runtime.blocked',
            durationMs,
            context: {
                status: runtime.status,
                count: runtime.activation.activePluginIds.length,
            },
        });

        const installedById = new Map(this.#getInstalledPlugins().map(document => [
            document.manifest.id,
            document,
        ]));
        runtime.diagnostics.forEach(diagnostic => {
            const pluginId = 'pluginId' in diagnostic ? diagnostic.pluginId : undefined;
            const document = pluginId ? installedById.get(pluginId) : undefined;
            this.#broker.record({
                source: runtimeDiagnosticSource(diagnostic),
                severity: diagnostic.severity,
                code: `runtime.${diagnostic.code}`,
                ...(pluginId ? { pluginId } : {}),
                ...(document ? { pluginVersion: document.manifest.version } : {}),
                ...('contributionId' in diagnostic && diagnostic.contributionId
                    ? { contributionId: diagnostic.contributionId }
                    : {}),
                context: {
                    ...('family' in diagnostic ? { family: diagnostic.family } : {}),
                    status: runtime.status,
                },
            });
        });
    }

    recordHostEvent(event: PluginHostEvent): void {
        const origin = event.type === 'portfolio.changed' ? event.origin : undefined;
        const document = origin?.pluginId
            ? this.#getInstalledPlugins().find(item => item.manifest.id === origin.pluginId)
            : undefined;
        this.#broker.record({
            source: 'host-event',
            severity: 'debug',
            code: `event.${event.type}`,
            ...(origin?.pluginId ? { pluginId: origin.pluginId } : {}),
            ...(document ? { pluginVersion: document.manifest.version } : {}),
            context: {
                eventType: event.type,
                ...(origin ? {
                    operation: origin.operation,
                    originKind: origin.kind,
                } : {}),
                ...('revision' in event ? { revision: event.revision } : {}),
            },
        });
    }

    recordPermissionDenied(pluginId: string, capability: string): void {
        const document = this.#getInstalledPlugins().find(item => item.manifest.id === pluginId);
        this.#broker.record({
            source: 'permission',
            severity: 'warning',
            code: 'permission.denied',
            pluginId,
            ...(document ? { pluginVersion: document.manifest.version } : {}),
            context: { capability, outcome: 'denied' },
        });
    }

    recordLifecycle(
        operation: string,
        outcome: 'succeeded' | 'failed',
        plugin?: Pick<InstalledPluginDocument['manifest'], 'id' | 'version'>,
        durationMs?: number,
    ): void {
        this.#broker.record({
            source: 'lifecycle',
            severity: outcome === 'succeeded' ? 'info' : 'error',
            code: `lifecycle.${operation}.${outcome}`,
            ...(plugin ? { pluginId: plugin.id, pluginVersion: plugin.version } : {}),
            durationMs,
            context: { operation, outcome },
        });
    }

    recordCommand(
        command: {
            readonly id: string;
            readonly pluginId: string;
            readonly pluginVersion: string;
            readonly action: { readonly kind: string };
        },
        outcome: 'succeeded' | 'failed',
        durationMs?: number,
        status?: string,
    ): void {
        this.#broker.record({
            source: 'command',
            severity: outcome === 'succeeded' ? 'info' : 'error',
            code: `command.${outcome}`,
            pluginId: command.pluginId,
            pluginVersion: command.pluginVersion,
            contributionId: command.id,
            durationMs,
            context: {
                action: command.action.kind,
                outcome,
                ...(status ? { status } : {}),
            },
        });
    }

    getSnapshot(): PluginDeveloperDiagnosticSnapshot {
        const log = this.#broker.getSnapshot();
        const packages = buildPluginDiagnosticInventory(
            this.#getInstalledPlugins(),
            this.#getRequirements(),
            NEMOTO_PLUGIN_API_VERSION,
        );
        return Object.freeze({
            enabled: log.enabled,
            hostPluginApiVersion: NEMOTO_PLUGIN_API_VERSION,
            packages: Object.freeze(packages),
            limits: Object.freeze({
                ...log.limits,
                maxPackageBytes: MAX_PLUGIN_PACKAGE_BYTES,
                maxExpandedPackageBytes: MAX_PLUGIN_EXPANDED_BYTES,
                maxPackageEntries: MAX_PLUGIN_PACKAGE_ENTRIES,
                maxPackageEntryBytes: MAX_PLUGIN_ENTRY_BYTES,
                maxPluginDataBytes: MAX_PLUGIN_DATA_BYTES,
                maxPluginCollectionItems: MAX_PLUGIN_COLLECTION_ITEMS,
            }),
            entries: log.entries,
        });
    }

    createSanitizedBundle(generatedAt?: string): SanitizedPluginDiagnosticBundle {
        return createSanitizedPluginDiagnosticBundle(this.getSnapshot(), generatedAt);
    }
}

const pluginDiagnosticBroker = new PluginDiagnosticBroker();

export const pluginDeveloperDiagnostics = new PluginDeveloperDiagnosticsService({
    broker: pluginDiagnosticBroker,
    getInstalledPlugins: () => usePluginStore.getState().installed,
    getRequirements: () => usePortfolioStore.getState().portfolio.plugins?.requirements || [],
});

let unbindSettings: (() => void) | undefined;

export function bindPluginDeveloperDiagnosticsSettings(): () => void {
    unbindSettings?.();
    pluginDeveloperDiagnostics.setEnabled(
        useSettingsStore.getState()?.developerModeEnabled || false,
    );
    const unsubscribe = useSettingsStore.subscribe((state, previous) => {
        if (state.developerModeEnabled !== previous.developerModeEnabled) {
            pluginDeveloperDiagnostics.setEnabled(state.developerModeEnabled);
        }
    });
    unbindSettings = unsubscribe;
    return () => {
        unsubscribe();
        if (unbindSettings === unsubscribe) {
            unbindSettings = undefined;
            pluginDeveloperDiagnostics.setEnabled(false);
        }
    };
}
