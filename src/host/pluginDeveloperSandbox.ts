import { NEMOTO_PLUGIN_API_VERSION } from '../plugins/activation';
import { createActivePluginRuntime } from '../plugins/activeRuntime';
import {
    readPluginCollection,
    writePluginCollection,
} from '../plugins/collectionStorage';
import {
    createPluginStorageTransactionResult,
    getPluginStorageUsage,
    listPluginDocuments,
    readPluginDocument,
    writePluginDocuments,
} from '../plugins/documentStorage';
import { createMemoryPluginDeviceStorageBroker } from '../plugins/deviceStorageModel';
import {
    hasInstalledPluginGrant,
    InstalledPluginDocumentSchema,
    type InstalledPluginDocument,
} from '../plugins/installedPackages';
import {
    PluginHostPermissionError,
    PluginHostRevisionConflictError,
    type PluginHostEvent,
    type PluginHostServices,
    type PluginHostSnapshot,
} from '../plugins/hostServices';
import {
    createRoleJourneyProjection,
    listRoleJourneyOptions,
} from '../plugins/readModel';
import { searchPortfolio } from '../plugins/searchReadModel';
import {
    createPluginEntitySnapshot,
    queryPluginEntityRelations,
} from '../plugins/entityReadModel';
import type { PluginApiIdentity } from '../plugins/publicApi';
import { parsePluginStorageTransaction } from '../plugins/storageContracts';
import {
    createPluginHostDescriptor,
    createPluginWorkspaceContext,
    resolvePluginNavigationIntent,
} from '../plugins/workspaceModel';
import { parsePluginNavigationIntent } from '../plugins/workspaceContracts';
import type { UniversalEntityReference } from '../plugins/universalReference';
import type { Portfolio } from '../types';
import { usePluginStore } from '../stores/usePluginStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { pluginDeveloperDiagnostics } from './pluginDeveloperDiagnostics';
import { createPluginPublicApi } from './pluginPublicApi';

export type PluginDeveloperSandboxErrorCode =
    | 'developer-mode-disabled'
    | 'runtime-blocked'
    | 'session-disposed'
    | 'package-operation-unavailable'
    | 'unknown-view';

const SANDBOX_ERROR_MESSAGES: Record<PluginDeveloperSandboxErrorCode, string> = {
    'developer-mode-disabled': 'Enable Developer Mode before creating a sandbox clone.',
    'runtime-blocked': 'The sandbox could not start because the active declarative runtime is blocked.',
    'session-disposed': 'This sandbox session has already been discarded.',
    'package-operation-unavailable': 'Package installation, removal, and activation are unavailable inside the sandbox.',
    'unknown-view': 'That view is not part of the validated sandbox runtime.',
};

export class PluginDeveloperSandboxError extends Error {
    constructor(readonly code: PluginDeveloperSandboxErrorCode) {
        super(SANDBOX_ERROR_MESSAGES[code]);
        this.name = 'PluginDeveloperSandboxError';
    }
}

export interface PluginDeveloperSandboxSessionSummary {
    readonly id: string;
    readonly createdAt: string;
    readonly sourceRevision: number;
    readonly sandboxRevision: number;
    readonly changeCount: number;
    readonly packageCount: number;
    readonly activePluginCount: number;
    readonly navigationViewCount: number;
    readonly processCount: number;
    readonly resourceCount: number;
}

export interface PluginDeveloperSandboxSession {
    readonly id: string;
    readonly createdAt: string;
    readonly sourceRevision: number;
    readonly runtime: ReturnType<typeof createActivePluginRuntime>;
    readonly services: PluginHostServices;
    readonly getSummary: () => PluginDeveloperSandboxSessionSummary;
    readonly getPortfolioSnapshot: () => Portfolio;
    readonly dispose: () => void;
}

interface CreatePluginDeveloperSandboxSessionOptions {
    readonly portfolio: Portfolio;
    readonly sourceRevision: number;
    readonly installedPlugins: readonly InstalledPluginDocument[];
    readonly clock?: () => Date;
    readonly createId?: () => string;
    readonly onChanged?: () => void;
}

const createSessionId = (): string => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sandbox-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

export function createPluginDeveloperSandboxSession({
    portfolio: sourcePortfolio,
    sourceRevision,
    installedPlugins: sourceInstalledPlugins,
    clock = () => new Date(),
    createId = createSessionId,
    onChanged,
}: CreatePluginDeveloperSandboxSessionOptions): PluginDeveloperSandboxSession {
    let portfolio = structuredClone(sourcePortfolio);
    const installedPlugins = sourceInstalledPlugins.map(document => (
        InstalledPluginDocumentSchema.parse(structuredClone(document))
    ));
    const runtime = createActivePluginRuntime(
        installedPlugins,
        portfolio.plugins?.requirements || [],
    );
    if (runtime.status !== 'ready') {
        throw new PluginDeveloperSandboxError('runtime-blocked');
    }

    const id = createId();
    const createdAt = clock().toISOString();
    let revision = 0;
    let disposed = false;
    let activeView = runtime.navigationViews[0]?.id || 'designer';
    let activeProcessId: string | null = null;
    let explicitSelections: UniversalEntityReference[] = [];
    const deviceStorage = createMemoryPluginDeviceStorageBroker(clock);
    const snapshotListeners = new Set<() => void>();
    const eventListeners = new Set<(event: PluginHostEvent) => void>();

    const assertActive = () => {
        if (disposed) throw new PluginDeveloperSandboxError('session-disposed');
    };
    const buildSnapshot = (): PluginHostSnapshot => Object.freeze({
        portfolioRevision: revision,
        installedPlugins,
        pluginsInitialized: true,
        pluginLoadError: null,
        pluginRequirements: portfolio.plugins?.requirements || [],
        activeView,
    });
    let snapshot = buildSnapshot();

    const publish = (event: PluginHostEvent) => {
        snapshot = buildSnapshot();
        snapshotListeners.forEach(listener => {
            try {
                listener();
            } catch {
                // One sandbox subscriber cannot interrupt another.
            }
        });
        eventListeners.forEach(listener => {
            try {
                listener(event);
            } catch {
                // Plugin-facing event subscribers are isolated in the sandbox too.
            }
        });
        try {
            onChanged?.();
        } catch {
            // Developer UI observation must not interrupt a sandbox mutation.
        }
    };
    const rejectPackageOperation = (): never => {
        throw new PluginDeveloperSandboxError('package-operation-unavailable');
    };
    const getActiveIdentity = (pluginId: string): PluginApiIdentity | null => {
        const document = installedPlugins.find(candidate => candidate.manifest.id === pluginId);
        const requirements = (portfolio.plugins?.requirements || [])
            .filter(requirement => requirement.pluginId === pluginId);
        if (!document || requirements.length !== 1) return null;
        const requirement = requirements[0];
        if (
            requirement.activation !== 'active'
            || requirement.dataVersion !== document.manifest.dataVersion
        ) return null;
        return {
            pluginId,
            pluginVersion: document.manifest.version,
            dataVersion: document.manifest.dataVersion,
        };
    };

    const services: PluginHostServices = {
        apiVersion: NEMOTO_PLUGIN_API_VERSION,
        getSnapshot: () => snapshot,
        subscribe: listener => {
            snapshotListeners.add(listener);
            return () => snapshotListeners.delete(listener);
        },
        events: {
            subscribe: listener => {
                eventListeners.add(listener);
                return () => eventListeners.delete(listener);
            },
        },
        permissions: {
            has: (pluginId, capability) => hasInstalledPluginGrant(
                installedPlugins,
                pluginId,
                capability,
            ),
        },
        publicApi: {
            connect: pluginId => createPluginPublicApi(pluginId, {
                getActiveIdentity,
                hasCapability: (candidatePluginId, capability) => (
                    services.permissions.has(candidatePluginId, capability)
                ),
                search: (_candidatePluginId, request) => searchPortfolio(portfolio, request),
                getEntity: (_candidatePluginId, reference) => createPluginEntitySnapshot(
                    portfolio,
                    reference,
                    revision,
                ),
                queryRelations: (_candidatePluginId, query) => queryPluginEntityRelations(
                    portfolio,
                    query,
                    revision,
                ),
                readCollection: (candidatePluginId, collectionId) => readPluginCollection(
                    portfolio,
                    candidatePluginId,
                    collectionId,
                ),
                replaceCollection: input => services.pluginData.replaceCollection(input),
                getStorageDocument: (candidatePluginId, key) => services.pluginData.getDocument(
                    candidatePluginId,
                    key,
                ),
                listStorageDocuments: (candidatePluginId, request) => (
                    services.pluginData.listDocuments(candidatePluginId, request)
                ),
                getStorageUsage: candidatePluginId => services.pluginData.getUsage(
                    candidatePluginId,
                ),
                transactStorageDocuments: (candidatePluginId, transaction) => (
                    services.pluginData.transactDocuments({
                        pluginId: candidatePluginId,
                        transaction,
                    })
                ),
                getDeviceSetting: (candidatePluginId, key) => (
                    services.deviceStorage.settings.get(candidatePluginId, key)
                ),
                listDeviceSettings: (candidatePluginId, request) => (
                    services.deviceStorage.settings.list(candidatePluginId, request)
                ),
                getDeviceSettingsUsage: candidatePluginId => (
                    services.deviceStorage.settings.usage(candidatePluginId)
                ),
                transactDeviceSettings: (candidatePluginId, input) => (
                    services.deviceStorage.settings.transact(candidatePluginId, input)
                ),
                getDeviceSecret: (candidatePluginId, key) => (
                    services.deviceStorage.secrets.get(candidatePluginId, key)
                ),
                listDeviceSecrets: (candidatePluginId, request) => (
                    services.deviceStorage.secrets.list(candidatePluginId, request)
                ),
                getDeviceSecretsUsage: candidatePluginId => (
                    services.deviceStorage.secrets.usage(candidatePluginId)
                ),
                setDeviceSecret: (candidatePluginId, input) => (
                    services.deviceStorage.secrets.set(candidatePluginId, input)
                ),
                deleteDeviceSecret: (candidatePluginId, input) => (
                    services.deviceStorage.secrets.delete(candidatePluginId, input)
                ),
                describeWorkspace: candidatePluginId => services.workspace.describe(
                    candidatePluginId,
                ),
                getWorkspaceContext: candidatePluginId => services.workspace.getContext(
                    candidatePluginId,
                ),
                openWorkspaceIntent: (candidatePluginId, input) => services.workspace.open(
                    candidatePluginId,
                    input,
                ),
                submitProposal: () => rejectPackageOperation(),
            }),
        },
        plugins: {
            reviewVersionChange: () => rejectPackageOperation(),
            load: async () => { assertActive(); },
            install: async () => rejectPackageOperation(),
            uninstall: async () => rejectPackageOperation(),
            setActive: () => rejectPackageOperation(),
        },
        navigation: {
            open: viewId => {
                assertActive();
                if (viewId !== 'designer' && !runtime.content.getPayload(viewId, 'views')) {
                    throw new PluginDeveloperSandboxError('unknown-view');
                }
                activeView = viewId;
                explicitSelections = [];
                publish({
                    type: 'navigation.changed',
                    activeView,
                    timestamp: clock().toISOString(),
                });
            },
        },
        executableProposals: {
            run: async () => {
                assertActive();
                throw new PluginDeveloperSandboxError('package-operation-unavailable');
            },
        },
        deviceStorage: {
            settings: {
                get: (pluginId, key) => {
                    assertActive();
                    return deviceStorage.settings.get(pluginId, key);
                },
                list: (pluginId, request) => {
                    assertActive();
                    return deviceStorage.settings.list(pluginId, request);
                },
                usage: pluginId => {
                    assertActive();
                    return deviceStorage.settings.usage(pluginId);
                },
                transact: (pluginId, input) => {
                    assertActive();
                    if (!services.permissions.has(pluginId, 'plugin-device-settings.write')) {
                        throw new PluginHostPermissionError(
                            pluginId,
                            'plugin-device-settings.write',
                        );
                    }
                    return deviceStorage.settings.transact(pluginId, input);
                },
            },
            secrets: {
                get: (pluginId, key) => {
                    assertActive();
                    if (!services.permissions.has(pluginId, 'plugin-secrets.use')) {
                        throw new PluginHostPermissionError(pluginId, 'plugin-secrets.use');
                    }
                    return deviceStorage.secrets.get(pluginId, key);
                },
                list: (pluginId, request) => {
                    assertActive();
                    if (!services.permissions.has(pluginId, 'plugin-secrets.use')) {
                        throw new PluginHostPermissionError(pluginId, 'plugin-secrets.use');
                    }
                    return deviceStorage.secrets.list(pluginId, request);
                },
                usage: pluginId => {
                    assertActive();
                    if (!services.permissions.has(pluginId, 'plugin-secrets.use')) {
                        throw new PluginHostPermissionError(pluginId, 'plugin-secrets.use');
                    }
                    return deviceStorage.secrets.usage(pluginId);
                },
                set: (pluginId, input) => {
                    assertActive();
                    if (!services.permissions.has(pluginId, 'plugin-secrets.use')) {
                        throw new PluginHostPermissionError(pluginId, 'plugin-secrets.use');
                    }
                    return deviceStorage.secrets.set(pluginId, input);
                },
                delete: (pluginId, input) => {
                    assertActive();
                    if (!services.permissions.has(pluginId, 'plugin-secrets.use')) {
                        throw new PluginHostPermissionError(pluginId, 'plugin-secrets.use');
                    }
                    return deviceStorage.secrets.delete(pluginId, input);
                },
            },
        },
        workspace: {
            describe: pluginId => {
                assertActive();
                const document = installedPlugins.find(candidate => candidate.manifest.id === pluginId);
                if (!document) throw new PluginDeveloperSandboxError('runtime-blocked');
                return createPluginHostDescriptor(document);
            },
            getContext: pluginId => {
                assertActive();
                if (!services.permissions.has(pluginId, 'portfolio.read-scoped')) {
                    throw new PluginHostPermissionError(pluginId, 'portfolio.read-scoped');
                }
                return createPluginWorkspaceContext(portfolio, pluginId, {
                    activeView,
                    activeProcessId,
                    explicitSelections,
                }, revision);
            },
            open: (pluginId, input) => {
                assertActive();
                if (!services.permissions.has(pluginId, 'workspace.navigate')) {
                    throw new PluginHostPermissionError(pluginId, 'workspace.navigate');
                }
                const intent = parsePluginNavigationIntent(input);
                const result = resolvePluginNavigationIntent(portfolio, intent);
                if (result.status === 'opened') {
                    activeView = result.reference.kind === 'core.journal-entry'
                        ? 'journal'
                        : 'designer';
                    activeProcessId = result.reference.kind === 'core.process'
                        ? result.reference.id
                        : result.reference.location?.processId || activeProcessId;
                    explicitSelections = result.reference.kind === 'core.process'
                        ? []
                        : [result.reference];
                    publish({
                        type: 'navigation.changed',
                        activeView,
                        timestamp: clock().toISOString(),
                    });
                }
                return result;
            },
        },
        projections: {
            listRoleJourneyOptions: () => {
                assertActive();
                return listRoleJourneyOptions(portfolio);
            },
            getRoleJourney: roleId => {
                assertActive();
                return createRoleJourneyProjection(portfolio, roleId);
            },
        },
        search: {
            query: (pluginId, request) => {
                assertActive();
                if (!services.permissions.has(pluginId, 'portfolio.read-scoped')) {
                    throw new PluginHostPermissionError(pluginId, 'portfolio.read-scoped');
                }
                return searchPortfolio(portfolio, request);
            },
        },
        pluginData: {
            readCollection: (pluginId, collectionId) => {
                assertActive();
                return readPluginCollection(portfolio, pluginId, collectionId);
            },
            replaceCollection: input => {
                assertActive();
                if (!services.permissions.has(input.pluginId, 'plugin-data.write')) {
                    throw new PluginHostPermissionError(input.pluginId, 'plugin-data.write');
                }
                if (input.expectedRevision !== revision) {
                    throw new PluginHostRevisionConflictError(input.expectedRevision, revision);
                }
                portfolio = writePluginCollection(
                    portfolio,
                    input.pluginId,
                    input.view,
                    [...input.items],
                );
                revision += 1;
                publish({
                    type: 'portfolio.changed',
                    revision,
                    timestamp: clock().toISOString(),
                    origin: {
                        kind: 'plugin',
                        operation: 'sandbox.plugin-data.collection.replace',
                        pluginId: input.pluginId,
                    },
                });
                return { revision };
            },
            getDocument: (pluginId, key) => {
                assertActive();
                return readPluginDocument(portfolio, pluginId, key, revision);
            },
            listDocuments: (pluginId, request) => {
                assertActive();
                return listPluginDocuments(portfolio, pluginId, request, revision);
            },
            getUsage: pluginId => {
                assertActive();
                return getPluginStorageUsage(portfolio, pluginId, revision);
            },
            transactDocuments: input => {
                assertActive();
                if (!services.permissions.has(input.pluginId, 'plugin-data.write')) {
                    throw new PluginHostPermissionError(input.pluginId, 'plugin-data.write');
                }
                const transaction = parsePluginStorageTransaction(input.transaction);
                if (transaction.expectedPortfolioRevision !== revision) {
                    throw new PluginHostRevisionConflictError(
                        transaction.expectedPortfolioRevision,
                        revision,
                    );
                }
                const result = writePluginDocuments(portfolio, input.pluginId, transaction);
                if (result.changed) {
                    portfolio = result.portfolio;
                    revision += 1;
                    publish({
                        type: 'portfolio.changed',
                        revision,
                        timestamp: clock().toISOString(),
                        origin: {
                            kind: 'plugin',
                            operation: 'sandbox.plugin-data.documents.transact',
                            pluginId: input.pluginId,
                        },
                    });
                }
                return createPluginStorageTransactionResult(revision, result.operations);
            },
        },
    };

    const getSummary = (): PluginDeveloperSandboxSessionSummary => Object.freeze({
        id,
        createdAt,
        sourceRevision,
        sandboxRevision: revision,
        changeCount: revision,
        packageCount: installedPlugins.length,
        activePluginCount: runtime.activation.activePluginIds.length,
        navigationViewCount: runtime.navigationViews.length,
        processCount: portfolio.processes.length,
        resourceCount: portfolio.assets.length,
    });

    return Object.freeze({
        id,
        createdAt,
        sourceRevision,
        runtime,
        services,
        getSummary,
        getPortfolioSnapshot: () => {
            assertActive();
            return structuredClone(portfolio);
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            snapshotListeners.clear();
            eventListeners.clear();
        },
    });
}

export interface PluginDeveloperSandboxControllerSnapshot {
    readonly active: boolean;
    readonly session?: PluginDeveloperSandboxSessionSummary;
}

interface PluginDeveloperSandboxControllerDependencies {
    readonly isDeveloperModeEnabled: () => boolean;
    readonly getPortfolio: () => Portfolio;
    readonly getPortfolioRevision: () => number;
    readonly getInstalledPlugins: () => readonly InstalledPluginDocument[];
    readonly recordLifecycle: (operation: 'sandbox-open' | 'sandbox-close', outcome: 'succeeded' | 'failed') => void;
}

export class PluginDeveloperSandboxController {
    readonly #dependencies: PluginDeveloperSandboxControllerDependencies;
    readonly #listeners = new Set<() => void>();
    #session: PluginDeveloperSandboxSession | null = null;
    #snapshot: PluginDeveloperSandboxControllerSnapshot = Object.freeze({ active: false });

    constructor(dependencies: PluginDeveloperSandboxControllerDependencies) {
        this.#dependencies = dependencies;
    }

    getSnapshot = (): PluginDeveloperSandboxControllerSnapshot => this.#snapshot;

    getSession = (): PluginDeveloperSandboxSession | null => this.#session;

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };

    start(): PluginDeveloperSandboxSession {
        if (!this.#dependencies.isDeveloperModeEnabled()) {
            throw new PluginDeveloperSandboxError('developer-mode-disabled');
        }
        this.stop();
        let session: PluginDeveloperSandboxSession;
        try {
            session = createPluginDeveloperSandboxSession({
                portfolio: this.#dependencies.getPortfolio(),
                sourceRevision: this.#dependencies.getPortfolioRevision(),
                installedPlugins: this.#dependencies.getInstalledPlugins(),
                onChanged: () => this.#notify(),
            });
        } catch (error) {
            this.#recordLifecycle('sandbox-open', 'failed');
            throw error;
        }
        this.#session = session;
        this.#recordLifecycle('sandbox-open', 'succeeded');
        this.#notify();
        return session;
    }

    stop(sessionId?: string): void {
        if (!this.#session || (sessionId && this.#session.id !== sessionId)) return;
        this.#session.dispose();
        this.#session = null;
        this.#recordLifecycle('sandbox-close', 'succeeded');
        this.#notify();
    }

    #notify(): void {
        this.#snapshot = Object.freeze({
            active: !!this.#session,
            ...(this.#session ? { session: this.#session.getSummary() } : {}),
        });
        this.#listeners.forEach(listener => {
            try {
                listener();
            } catch {
                // Developer tooling listeners are fault-isolated.
            }
        });
    }

    #recordLifecycle(
        operation: 'sandbox-open' | 'sandbox-close',
        outcome: 'succeeded' | 'failed',
    ): void {
        try {
            this.#dependencies.recordLifecycle(operation, outcome);
        } catch {
            // Diagnostics must never affect sandbox lifetime semantics.
        }
    }
}

export const pluginDeveloperSandbox = new PluginDeveloperSandboxController({
    isDeveloperModeEnabled: () => useSettingsStore.getState().developerModeEnabled,
    getPortfolio: () => usePortfolioStore.getState().portfolio,
    getPortfolioRevision: () => usePortfolioStore.getState().changeRevision,
    getInstalledPlugins: () => usePluginStore.getState().installed,
    recordLifecycle: (operation, outcome) => pluginDeveloperDiagnostics.recordLifecycle(operation, outcome),
});

useSettingsStore.subscribe((state, previous) => {
    if (!state.developerModeEnabled && previous.developerModeEnabled) {
        pluginDeveloperSandbox.stop();
    }
});
