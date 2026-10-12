import { reviewPluginVersionTransition } from '../plugins/pluginVersionTransition';
import { NEMOTO_PLUGIN_API_VERSION } from '../plugins/activation';
import {
    readPluginCollection,
    readPluginCollectionPage,
    transactPluginCollection,
    writePluginCollection,
} from '../plugins/collectionStorage';
import { resolveRecordContext } from '../plugins/contextualRecordModel';
import { prepareCollectionReferences } from './pluginCollectionReferences';
import { waitForPluginUiSlot } from './pluginUiPacing';
import {
    createPluginStorageTransactionResult,
    getPluginStorageUsage,
    listPluginDocuments,
    readPluginDocument,
    writePluginDocuments,
} from '../plugins/documentStorage';
import type {
    PluginHostEvent,
    PluginHostServices,
    PluginHostSnapshot,
} from '../plugins/hostServices';
import {
    PluginHostPermissionError,
    PluginHostRevisionConflictError,
} from '../plugins/hostServices';
import { setPortfolioPluginActive } from '../plugins/portfolioActivation';
import {
    createRoleJourneyProjection,
    listRoleJourneyOptions,
} from '../plugins/readModel';
import { searchPortfolio } from '../plugins/searchReadModel';
import {
    createPluginEntitySnapshot,
    queryPluginEntityRelations,
} from '../plugins/entityReadModel';
import { satisfiesVersionRange } from '../plugins/versionRange';
import type { PluginApiIdentity } from '../plugins/publicApi';
import { parsePluginStorageTransaction } from '../plugins/storageContracts';
import {
    PluginNavigationResultSchema,
    parsePluginNavigationIntent,
} from '../plugins/workspaceContracts';
import {
    createPluginHostDescriptor,
    createPluginWorkspaceContext,
    resolvePluginNavigationIntent,
} from '../plugins/workspaceModel';
import { navigateToUniversalEntityReference } from '../lib/entityNavigation';
import { useCanvasStore } from '../stores/useCanvasStore';
import { useJournalStore } from '../stores/useJournalStore';
import { useProcessSessionStore } from '../stores/useProcessSessionStore';
import { usePluginStore } from '../stores/usePluginStore';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useProposalReviewStore } from '../stores/useProposalReviewStore';
import { useUIStore, type PluginViewId } from '../stores/useUIStore';
import { pluginDeveloperDiagnostics } from './pluginDeveloperDiagnostics';
import { queueExecutablePluginAuthoritySynchronization } from './pluginExecutableAuthority';
import { runExecutableProposalCommand } from './pluginExecutableProposalCommands';
import { runExecutablePluginUiReduction } from './pluginExecutablePackages';
import { createPluginPublicApi } from './pluginPublicApi';
import { pluginDeviceStorage } from './pluginDeviceStorage';
import { createPluginUiEffectBroker } from './pluginUiEffects';
import { copyPluginText, savePluginText } from './pluginTextOutput';
import { createPluginUiSession, type PluginUiSessionOptions } from './pluginUiSession';
import { resolveActiveComposedViewAuthority, type ActiveComposedViewAuthority } from '../plugins/activeRuntime';
import { toast } from 'sonner';

const EMPTY_REQUIREMENTS: PluginHostSnapshot['pluginRequirements'] = Object.freeze([]);

type PortfolioEventOrigin = Extract<PluginHostEvent, { type: 'portfolio.changed' }>['origin'];

const snapshotListeners = new Set<() => void>();
const eventListeners = new Set<(event: PluginHostEvent) => void>();

const buildSnapshot = (): PluginHostSnapshot => {
    const portfolioState = usePortfolioStore.getState();
    const pluginState = usePluginStore.getState();
    return Object.freeze({
        portfolioRevision: portfolioState.changeRevision,
        installedPlugins: pluginState.installed,
        pluginsInitialized: pluginState.initialized,
        pluginLoadError: pluginState.error,
        pluginRequirements: portfolioState.portfolio.plugins?.requirements || EMPTY_REQUIREMENTS,
        activeView: useUIStore.getState().activeView,
    });
};

let currentSnapshot = buildSnapshot();
let activePortfolioOrigin: PortfolioEventOrigin | null = null;
let queuedPortfolioOrigin: PortfolioEventOrigin | null = null;
let portfolioEventQueued = false;

const emit = (event: PluginHostEvent) => {
    pluginDeveloperDiagnostics.recordHostEvent(event);
    eventListeners.forEach(listener => {
        try {
            listener(event);
        } catch (error) {
            console.error('[PluginHostServices] Event listener failed:', error);
        }
    });
};

const refreshSnapshot = () => {
    const next = buildSnapshot();
    if (
        next.portfolioRevision === currentSnapshot.portfolioRevision
        && next.installedPlugins === currentSnapshot.installedPlugins
        && next.pluginsInitialized === currentSnapshot.pluginsInitialized
        && next.pluginLoadError === currentSnapshot.pluginLoadError
        && next.pluginRequirements === currentSnapshot.pluginRequirements
        && next.activeView === currentSnapshot.activeView
    ) return;

    currentSnapshot = next;
    snapshotListeners.forEach(listener => {
        try {
            listener();
        } catch (error) {
            console.error('[PluginHostServices] Snapshot listener failed:', error);
        }
    });
};

const queuePortfolioEvent = () => {
    const candidate = activePortfolioOrigin || {
        kind: 'host' as const,
        operation: 'portfolio.store-change',
    };
    if (!queuedPortfolioOrigin || candidate.kind === 'plugin') {
        queuedPortfolioOrigin = candidate;
    }
    if (portfolioEventQueued) return;

    portfolioEventQueued = true;
    queueMicrotask(() => {
        portfolioEventQueued = false;
        const origin = queuedPortfolioOrigin || {
            kind: 'host' as const,
            operation: 'portfolio.store-change',
        };
        queuedPortfolioOrigin = null;
        emit({
            type: 'portfolio.changed',
            revision: usePortfolioStore.getState().changeRevision,
            timestamp: new Date().toISOString(),
            origin,
        });
    });
};

usePortfolioStore.subscribe((state, previous) => {
    refreshSnapshot();
    if (state.portfolio !== previous.portfolio || state.changeRevision !== previous.changeRevision) {
        queuePortfolioEvent();
    }
    if (
        state.portfolio.plugins?.requirements !== previous.portfolio.plugins?.requirements
        && usePluginStore.getState().initialized
    ) {
        queueExecutablePluginAuthoritySynchronization(
            state.portfolio.plugins?.requirements || EMPTY_REQUIREMENTS,
        );
    }
});

usePluginStore.subscribe((state, previous) => {
    refreshSnapshot();
    if (
        state.installed !== previous.installed
        || state.initialized !== previous.initialized
        || state.error !== previous.error
    ) {
        emit({ type: 'plugins.changed', timestamp: new Date().toISOString() });
    }
    if (state.initialized && (
        state.installed !== previous.installed
        || state.initialized !== previous.initialized
    )) {
        queueExecutablePluginAuthoritySynchronization(
            usePortfolioStore.getState().portfolio.plugins?.requirements || EMPTY_REQUIREMENTS,
            true,
        );
    }
});

useUIStore.subscribe((state, previous) => {
    refreshSnapshot();
    if (state.activeView !== previous.activeView) {
        emit({
            type: 'navigation.changed',
            activeView: state.activeView,
            timestamp: new Date().toISOString(),
        });
    }
});

export const replacePortfolioFromPluginHost = (
    portfolio: ReturnType<typeof usePortfolioStore.getState>['portfolio'],
    origin: PortfolioEventOrigin,
) => {
    activePortfolioOrigin = origin;
    try {
        usePortfolioStore.getState().setPortfolio(portfolio);
    } finally {
        activePortfolioOrigin = null;
    }
};

const requireCapability = (
    pluginId: string,
    capability: Parameters<PluginHostServices['permissions']['has']>[1],
) => {
    if (!usePluginStore.getState().hasGrant(pluginId, capability)) {
        pluginDeveloperDiagnostics.recordPermissionDenied(pluginId, capability);
        throw new PluginHostPermissionError(pluginId, capability);
    }
};

const getActivePluginIdentity = (pluginId: string): PluginApiIdentity | null => {
    const document = usePluginStore.getState().installed.find(
        candidate => candidate.manifest.id === pluginId,
    );
    if (!document) return null;

    const requirements = (usePortfolioStore.getState().portfolio.plugins?.requirements || [])
        .filter(requirement => requirement.pluginId === pluginId);
    if (requirements.length !== 1) return null;
    const requirement = requirements[0];
    if (
        requirement.activation !== 'active'
        || !satisfiesVersionRange(document.manifest.version, requirement.version)
        || document.manifest.dataVersion !== requirement.dataVersion
        || !satisfiesVersionRange(
            NEMOTO_PLUGIN_API_VERSION,
            document.manifest.compatibility.axiomPluginApi,
        )
    ) return null;

    return {
        pluginId,
        pluginVersion: document.manifest.version,
        dataVersion: document.manifest.dataVersion,
    };
};

const getInstalledPluginDocument = (pluginId: string) => (
    usePluginStore.getState().installed.find(candidate => candidate.manifest.id === pluginId) || null
);

const monotonicNow = (): number => (
    typeof performance === 'undefined' ? Date.now() : performance.now()
);

const elapsedSince = (startedAt: number): number => (
    Math.max(0, Math.round((monotonicNow() - startedAt) * 100) / 100)
);

export const pluginHostServices: PluginHostServices = {
    apiVersion: NEMOTO_PLUGIN_API_VERSION,
    getSnapshot: () => currentSnapshot,
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
        has: (pluginId, capability) => usePluginStore.getState().hasGrant(pluginId, capability),
    },
    publicApi: {
        connect: pluginId => createPluginPublicApi(pluginId, {
            getActiveIdentity: getActivePluginIdentity,
            hasCapability: (candidatePluginId, capability) => (
                usePluginStore.getState().hasGrant(candidatePluginId, capability)
            ),
            search: (_candidatePluginId, request) => searchPortfolio(
                usePortfolioStore.getState().portfolio,
                request,
            ),
            getEntity: (_candidatePluginId, reference) => {
                const state = usePortfolioStore.getState();
                return createPluginEntitySnapshot(
                    state.portfolio,
                    reference,
                    state.changeRevision,
                );
            },
            queryRelations: (_candidatePluginId, query) => {
                const state = usePortfolioStore.getState();
                return queryPluginEntityRelations(
                    state.portfolio,
                    query,
                    state.changeRevision,
                );
            },
            readCollection: (candidatePluginId, collectionId) => readPluginCollection(
                usePortfolioStore.getState().portfolio,
                candidatePluginId,
                collectionId,
            ),
            replaceCollection: input => pluginHostServices.pluginData.replaceCollection(input),
            getStorageDocument: (candidatePluginId, key) => pluginHostServices.pluginData.getDocument(
                candidatePluginId,
                key,
            ),
            listStorageDocuments: (candidatePluginId, request) => (
                pluginHostServices.pluginData.listDocuments(candidatePluginId, request)
            ),
            getStorageUsage: candidatePluginId => pluginHostServices.pluginData.getUsage(
                candidatePluginId,
            ),
            transactStorageDocuments: (candidatePluginId, transaction) => (
                pluginHostServices.pluginData.transactDocuments({
                    pluginId: candidatePluginId,
                    transaction,
                })
            ),
            getDeviceSetting: (candidatePluginId, key) => (
                pluginHostServices.deviceStorage.settings.get(candidatePluginId, key)
            ),
            listDeviceSettings: (candidatePluginId, request) => (
                pluginHostServices.deviceStorage.settings.list(candidatePluginId, request)
            ),
            getDeviceSettingsUsage: candidatePluginId => (
                pluginHostServices.deviceStorage.settings.usage(candidatePluginId)
            ),
            transactDeviceSettings: (candidatePluginId, transaction) => (
                pluginHostServices.deviceStorage.settings.transact(
                    candidatePluginId,
                    transaction,
                )
            ),
            getDeviceSecret: (candidatePluginId, key) => (
                pluginHostServices.deviceStorage.secrets.get(candidatePluginId, key)
            ),
            listDeviceSecrets: (candidatePluginId, request) => (
                pluginHostServices.deviceStorage.secrets.list(candidatePluginId, request)
            ),
            getDeviceSecretsUsage: candidatePluginId => (
                pluginHostServices.deviceStorage.secrets.usage(candidatePluginId)
            ),
            setDeviceSecret: (candidatePluginId, input) => (
                pluginHostServices.deviceStorage.secrets.set(candidatePluginId, input)
            ),
            deleteDeviceSecret: (candidatePluginId, input) => (
                pluginHostServices.deviceStorage.secrets.delete(candidatePluginId, input)
            ),
            describeWorkspace: candidatePluginId => pluginHostServices.workspace.describe(
                candidatePluginId,
            ),
            getWorkspaceContext: candidatePluginId => pluginHostServices.workspace.getContext(
                candidatePluginId,
            ),
            openWorkspaceIntent: (candidatePluginId, input) => pluginHostServices.workspace.open(
                candidatePluginId,
                input,
            ),
            submitProposal: proposal => useProposalReviewStore.getState().submitProposal(proposal),
        }),
    },
    plugins: {
        reviewVersionChange: pluginId => reviewPluginVersionTransition(
            pluginId,
            () => usePortfolioStore.getState().portfolio,
            () => usePluginStore.getState().installed,
            portfolio => replacePortfolioFromPluginHost(portfolio, { kind: 'host', operation: 'plugin.version-change', pluginId }),
        ),
        load: async () => {
            const startedAt = monotonicNow();
            try {
                await usePluginStore.getState().load();
                pluginDeveloperDiagnostics.recordLifecycle(
                    'load',
                    usePluginStore.getState().error ? 'failed' : 'succeeded',
                    undefined,
                    elapsedSince(startedAt),
                );
            } catch (error) {
                pluginDeveloperDiagnostics.recordLifecycle(
                    'load',
                    'failed',
                    undefined,
                    elapsedSince(startedAt),
                );
                throw error;
            }
        },
        install: async document => {
            const startedAt = monotonicNow();
            try {
                await usePluginStore.getState().install(document);
                pluginDeveloperDiagnostics.recordLifecycle(
                    'install',
                    'succeeded',
                    document.manifest,
                    elapsedSince(startedAt),
                );
            } catch (error) {
                pluginDeveloperDiagnostics.recordLifecycle(
                    'install',
                    'failed',
                    document.manifest,
                    elapsedSince(startedAt),
                );
                throw error;
            }
        },
        uninstall: async document => {
            const startedAt = monotonicNow();
            try {
                const portfolio = usePortfolioStore.getState().portfolio;
                const active = portfolio.plugins?.requirements.some(requirement => (
                    requirement.pluginId === document.manifest.id
                    && requirement.activation === 'active'
                )) || false;
                await usePluginStore.getState().uninstall(document.manifest.id);
                if (active) {
                    replacePortfolioFromPluginHost(
                        setPortfolioPluginActive(portfolio, document, false),
                        { kind: 'host', operation: 'plugin.uninstall', pluginId: document.manifest.id },
                    );
                }
                if (useUIStore.getState().activeView.startsWith(`${document.manifest.id}/`)) {
                    useUIStore.getState().setActiveView('designer');
                }
                pluginDeveloperDiagnostics.recordLifecycle(
                    'uninstall',
                    'succeeded',
                    document.manifest,
                    elapsedSince(startedAt),
                );
            } catch (error) {
                pluginDeveloperDiagnostics.recordLifecycle(
                    'uninstall',
                    'failed',
                    document.manifest,
                    elapsedSince(startedAt),
                );
                throw error;
            }
        },
        setActive: (document, active) => {
            const startedAt = monotonicNow();
            try {
                const portfolio = usePortfolioStore.getState().portfolio;
                const previousRequirement = portfolio.plugins?.requirements.find(
                    requirement => requirement.pluginId === document.manifest.id,
                );
                if (active && previousRequirement) {
                    if (document.manifest.dataVersion !== previousRequirement.dataVersion) {
                        throw new Error(`Cannot activate ${document.manifest.name}: this portfolio requires data version ${previousRequirement.dataVersion}, but the installed package uses ${document.manifest.dataVersion}. Install a matching package or migrate the data before activation. Portfolio data was not changed.`);
                    }
                    if (!satisfiesVersionRange(document.manifest.version, previousRequirement.version)) {
                        throw new Error(`Cannot activate ${document.manifest.name}: this portfolio requires package ${previousRequirement.version}, but ${document.manifest.version} is installed. The data version matches (${document.manifest.dataVersion}), but activation cannot change the portfolio's package requirement. Install a matching package. Portfolio data was not changed.`);
                    }
                }

                replacePortfolioFromPluginHost(
                    setPortfolioPluginActive(portfolio, document, active),
                    {
                        kind: 'host',
                        operation: active ? 'plugin.activate' : 'plugin.deactivate',
                        pluginId: document.manifest.id,
                    },
                );
                if (!active && useUIStore.getState().activeView.startsWith(`${document.manifest.id}/`)) {
                    useUIStore.getState().setActiveView('designer');
                }
                pluginDeveloperDiagnostics.recordLifecycle(
                    active ? 'activate' : 'deactivate',
                    'succeeded',
                    document.manifest,
                    elapsedSince(startedAt),
                );
            } catch (error) {
                pluginDeveloperDiagnostics.recordLifecycle(
                    active ? 'activate' : 'deactivate',
                    'failed',
                    document.manifest,
                    elapsedSince(startedAt),
                );
                throw error;
            }
        },
    },
    navigation: {
        open: viewId => useUIStore.getState().setActiveView(viewId as PluginViewId),
    },
    executableProposals: {
        run: async command => {
            const document = getInstalledPluginDocument(command.pluginId);
            if (!document) throw new Error('The executable plugin is not installed.');
            const workspaceContext = pluginHostServices.workspace.getContext(command.pluginId);
            const portfolioState = usePortfolioStore.getState();
            const result = await runExecutableProposalCommand({
                command,
                installedDocument: document,
                portfolio: portfolioState.portfolio,
                portfolioRevision: portfolioState.changeRevision,
                workspaceContext,
                requirements: portfolioState.portfolio.plugins?.requirements || EMPTY_REQUIREMENTS,
            });
            const proposalId = useProposalReviewStore.getState().submitProposal(result.proposal);
            useProposalReviewStore.getState().openReview(proposalId);
            return Object.freeze({ proposalId });
        },
    },
    deviceStorage: {
        settings: {
            get: (pluginId, key) => pluginDeviceStorage.settings.get(pluginId, key),
            list: (pluginId, request) => pluginDeviceStorage.settings.list(pluginId, request),
            usage: pluginId => pluginDeviceStorage.settings.usage(pluginId),
            transact: (pluginId, input) => {
                requireCapability(pluginId, 'plugin-device-settings.write');
                return pluginDeviceStorage.settings.transact(pluginId, input);
            },
        },
        secrets: {
            get: (pluginId, key) => {
                requireCapability(pluginId, 'plugin-secrets.use');
                return pluginDeviceStorage.secrets.get(pluginId, key);
            },
            list: (pluginId, request) => {
                requireCapability(pluginId, 'plugin-secrets.use');
                return pluginDeviceStorage.secrets.list(pluginId, request);
            },
            usage: pluginId => {
                requireCapability(pluginId, 'plugin-secrets.use');
                return pluginDeviceStorage.secrets.usage(pluginId);
            },
            set: (pluginId, input) => {
                requireCapability(pluginId, 'plugin-secrets.use');
                return pluginDeviceStorage.secrets.set(pluginId, input);
            },
            delete: (pluginId, input) => {
                requireCapability(pluginId, 'plugin-secrets.use');
                return pluginDeviceStorage.secrets.delete(pluginId, input);
            },
        },
    },
    workspace: {
        describe: pluginId => {
            const document = getInstalledPluginDocument(pluginId);
            if (!document) throw new Error(`Installed plugin '${pluginId}' is unavailable.`);
            return createPluginHostDescriptor(document);
        },
        getContext: pluginId => {
            requireCapability(pluginId, 'portfolio.read-scoped');
            const portfolioState = usePortfolioStore.getState();
            const ui = useUIStore.getState();
            const canvas = useCanvasStore.getState();
            const processSession = useProcessSessionStore.getState();
            const journal = useJournalStore.getState();
            return createPluginWorkspaceContext(
                portfolioState.portfolio,
                pluginId,
                {
                    activeView: ui.activeView,
                    activeProcessId: processSession.activeProcessId,
                    selectedNodeIds: canvas.selectedNodeIds,
                    selectedEdgeIds: canvas.selectedEdgeIds,
                    selectedAssetId: ui.selectedAssetId,
                    selectedSwimlaneId: ui.selectedSwimlaneId,
                    selectedJournalEntryId: journal.selectedEntryId,
                    journalPanelExpanded: ui.journalPanelExpanded,
                    rightPanelMode: ui.rightPanelMode,
                },
                portfolioState.changeRevision,
            );
        },
        open: (pluginId, input) => {
            requireCapability(pluginId, 'workspace.navigate');
            const intent = parsePluginNavigationIntent(input);
            const resolved = resolvePluginNavigationIntent(
                usePortfolioStore.getState().portfolio,
                intent,
            );
            if (resolved.status !== 'opened') return resolved;
            const applied = navigateToUniversalEntityReference(
                resolved.reference,
                intent.action,
            );
            return PluginNavigationResultSchema.parse({
                schema: 'axiom.plugin-navigation-result',
                schemaVersion: 1,
                status: applied.ok ? 'opened' : 'not-found',
                reference: applied.reference,
            });
        },
    },
    projections: {
        listRoleJourneyOptions: () => listRoleJourneyOptions(usePortfolioStore.getState().portfolio),
        getRoleJourney: roleId => createRoleJourneyProjection(
            usePortfolioStore.getState().portfolio,
            roleId,
        ),
    },
    search: {
        query: (pluginId, request) => {
            requireCapability(pluginId, 'portfolio.read-scoped');
            return searchPortfolio(usePortfolioStore.getState().portfolio, request);
        },
    },
    pluginData: {
        readCollection: (pluginId, collectionId) => readPluginCollection(
            usePortfolioStore.getState().portfolio,
            pluginId,
            collectionId,
        ),
        replaceCollection: input => {
            requireCapability(input.pluginId, 'plugin-data.write');
            const state = usePortfolioStore.getState();
            if (state.changeRevision !== input.expectedRevision) {
                throw new PluginHostRevisionConflictError(
                    input.expectedRevision,
                    state.changeRevision,
                );
            }
            const next = writePluginCollection(
                state.portfolio,
                input.pluginId,
                input.view,
                [...input.items],
            );
            replacePortfolioFromPluginHost(next, {
                kind: 'plugin',
                operation: 'plugin-data.collection.replace',
                pluginId: input.pluginId,
            });
            return { revision: usePortfolioStore.getState().changeRevision };
        },
        getDocument: (pluginId, key) => {
            const state = usePortfolioStore.getState();
            return readPluginDocument(state.portfolio, pluginId, key, state.changeRevision);
        },
        listDocuments: (pluginId, request) => {
            const state = usePortfolioStore.getState();
            return listPluginDocuments(
                state.portfolio,
                pluginId,
                request,
                state.changeRevision,
            );
        },
        getUsage: pluginId => {
            const state = usePortfolioStore.getState();
            return getPluginStorageUsage(state.portfolio, pluginId, state.changeRevision);
        },
        transactDocuments: input => {
            requireCapability(input.pluginId, 'plugin-data.write');
            const transaction = parsePluginStorageTransaction(input.transaction);
            const state = usePortfolioStore.getState();
            if (state.changeRevision !== transaction.expectedPortfolioRevision) {
                throw new PluginHostRevisionConflictError(
                    transaction.expectedPortfolioRevision,
                    state.changeRevision,
                );
            }
            const result = writePluginDocuments(
                state.portfolio,
                input.pluginId,
                transaction,
            );
            if (result.changed) {
                replacePortfolioFromPluginHost(result.portfolio, {
                    kind: 'plugin',
                    operation: 'plugin-data.documents.transact',
                    pluginId: input.pluginId,
                });
            }
            return createPluginStorageTransactionResult(
                usePortfolioStore.getState().changeRevision,
                result.operations,
            );
        },
    },
};

export const pluginUiEffectBroker = createPluginUiEffectBroker({
    getInstalledDocument: getInstalledPluginDocument,
    getActiveIdentity: getActivePluginIdentity,
    hasCapability: (pluginId, capability) => usePluginStore.getState().hasGrant(pluginId, capability),
    getPortfolioRevision: () => usePortfolioStore.getState().changeRevision,
    connectPublicApi: pluginId => pluginHostServices.publicApi.connect(pluginId),
    readCollectionPage: input => {
        const state = usePortfolioStore.getState();
        return readPluginCollectionPage(
            state.portfolio,
            input.pluginId,
            input.collectionId,
            state.changeRevision,
            input.cursor,
            input.limit,
            input.query,
            input.query ? reference => resolveRecordContext(pluginHostServices.publicApi.connect(input.pluginId), reference) : undefined,
        );
    },
    transactCollection: input => {
        requireCapability(input.pluginId, 'plugin-data.write');
        const state = usePortfolioStore.getState();
        if (state.changeRevision !== input.expectedPortfolioRevision) {
            throw new PluginHostRevisionConflictError(
                input.expectedPortfolioRevision,
                state.changeRevision,
            );
        }
        const operations = input.view.contextual ? prepareCollectionReferences(
            readPluginCollection(state.portfolio, input.pluginId, input.collectionId).items,
            input.operations,
            reference => resolveRecordContext(pluginHostServices.publicApi.connect(input.pluginId), reference),
        ) : input.operations;
        const result = transactPluginCollection(
            state.portfolio,
            input.pluginId,
            input.view,
            input.collectionId,
            operations,
        );
        if (result.changed) {
            replacePortfolioFromPluginHost(result.portfolio, {
                kind: 'plugin',
                operation: 'plugin-data.collection.transact',
                pluginId: input.pluginId,
            });
        }
        return {
            portfolioRevision: usePortfolioStore.getState().changeRevision,
            operations: result.operations.map(operation => ({ ...operation })),
        };
    },
    showNotice: notice => {
        toast[notice.severity](notice.message);
    },
    saveTextOutput: input => savePluginText(input.suggestedBaseName, input.text),
    copyTextOutput: input => copyPluginText(input.text),
    isCapturedContextCurrent: reference => {
        const state = usePortfolioStore.getState();
        return createPluginEntitySnapshot(state.portfolio, reference, state.changeRevision) !== null;
    },
});

const localCalendarDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/** Host-owned adapter. The current API 1.7 gate keeps this inert until a later activation gate. */
export function createHostPluginUiSession(
    authority: ActiveComposedViewAuthority,
    options: Pick<PluginUiSessionOptions, 'surface' | 'capturedContext' | 'instanceId'>,
) {
    return createPluginUiSession({ authority, ...options }, {
        waitForReduction: () => waitForPluginUiSlot(authority.pluginId),
        reduce: runExecutablePluginUiReduction,
        applyEffects: pluginUiEffectBroker.apply,
        getPortfolioRevision: () => usePortfolioStore.getState().changeRevision,
        getEnvironment: () => {
            const now = new Date();
            const root = typeof document === 'undefined' ? null : document.documentElement;
            const density = root?.dataset.density;
            return {
                observedAt: now.toISOString(),
                localDate: localCalendarDate(now),
                timezoneOffsetMinutes: now.getTimezoneOffset(),
                viewport: typeof window !== 'undefined' && window.innerWidth < 768 ? 'compact' : 'wide',
                theme: {
                    colorScheme: root?.classList.contains('dark') ? 'dark' : 'light',
                    density: density === 'compact' || density === 'spacious' ? density : 'comfortable',
                },
                allocatedIds: [crypto.randomUUID()],
            };
        },
        isAuthorityCurrent: candidate => {
            const snapshot = pluginHostServices.getSnapshot();
            const current = resolveActiveComposedViewAuthority(
                snapshot.installedPlugins,
                snapshot.pluginRequirements,
                candidate.viewId,
            );
            return !!current
                && current.pluginId === candidate.pluginId
                && current.pluginVersion === candidate.pluginVersion
                && current.dataVersion === candidate.dataVersion
                && current.operation === candidate.operation;
        },
        subscribeHostEvents: pluginHostServices.events.subscribe,
        ...(options.surface === 'app-rail'
            ? { getActiveView: () => pluginHostServices.getSnapshot().activeView }
            : {}),
    });
}
