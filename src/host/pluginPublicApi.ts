import { AXIOM_PLUGIN_API_VERSION } from '../plugins/activation';
import type {
    PluginCollectionItem,
    ReadPluginCollectionResult,
} from '../plugins/collectionStorage';
import type { PluginCollectionListView } from '../plugins/contributionSchemas';
import type { PluginCapability } from '../plugins/manifest';
import type {
    PluginEntityRelationPage,
    PluginEntityRelationQueryInput,
    PluginEntitySnapshot,
} from '../plugins/entityReadContracts';
import {
    PluginApiIdentityError,
    PluginApiPermissionError,
    PluginApiSessionError,
    type AxiomPluginApi,
    type PluginApiIdentity,
    type PluginStorageWriteResult,
} from '../plugins/publicApi';
import { parsePluginProposal, type PluginProposal } from '../plugins/proposals';
import type { PluginSearchRequest, PluginSearchResult } from '../plugins/searchReadModel';
import type { UniversalEntityReference } from '../plugins/universalReference';
import type {
    PluginStorageDocumentSnapshot,
    PluginStorageListPage,
    PluginStorageListRequestInput,
    PluginStorageTransactionInput,
    PluginStorageTransactionResult,
    PluginStorageUsage,
} from '../plugins/storageContracts';
import type {
    PluginDeviceSecretDeleteInput,
    PluginDeviceSecretMutationResult,
    PluginDeviceSecretSetInput,
    PluginDeviceSecretSnapshot,
    PluginDeviceSecretsListPage,
    PluginDeviceSecretsListRequestInput,
    PluginDeviceSecretsUsage,
    PluginDeviceSettingSnapshot,
    PluginDeviceSettingsListPage,
    PluginDeviceSettingsListRequestInput,
    PluginDeviceSettingsTransactionInput,
    PluginDeviceSettingsTransactionResult,
    PluginDeviceSettingsUsage,
} from '../plugins/deviceStorageContracts';
import type {
    PluginHostDescriptor,
    PluginNavigationIntentInput,
    PluginNavigationResult,
    PluginWorkspaceContext,
} from '../plugins/workspaceContracts';

export interface PluginPublicApiDependencies {
    readonly getActiveIdentity: (pluginId: string) => PluginApiIdentity | null;
    readonly hasCapability: (pluginId: string, capability: PluginCapability) => boolean;
    readonly search: (
        pluginId: string,
        request: PluginSearchRequest,
    ) => readonly PluginSearchResult[];
    readonly getEntity: (
        pluginId: string,
        reference: UniversalEntityReference,
    ) => PluginEntitySnapshot | null;
    readonly queryRelations: (
        pluginId: string,
        query: PluginEntityRelationQueryInput,
    ) => PluginEntityRelationPage;
    readonly readCollection: (
        pluginId: string,
        collectionId: string,
    ) => ReadPluginCollectionResult;
    readonly replaceCollection: (input: {
        readonly pluginId: string;
        readonly view: PluginCollectionListView;
        readonly items: readonly PluginCollectionItem[];
        readonly expectedRevision: number;
    }) => PluginStorageWriteResult;
    readonly getStorageDocument: (
        pluginId: string,
        key: string,
    ) => PluginStorageDocumentSnapshot | null;
    readonly listStorageDocuments: (
        pluginId: string,
        request: PluginStorageListRequestInput,
    ) => PluginStorageListPage;
    readonly getStorageUsage: (pluginId: string) => PluginStorageUsage;
    readonly transactStorageDocuments: (
        pluginId: string,
        input: PluginStorageTransactionInput,
    ) => PluginStorageTransactionResult;
    readonly getDeviceSetting: (
        pluginId: string,
        key: string,
    ) => Promise<PluginDeviceSettingSnapshot | null>;
    readonly listDeviceSettings: (
        pluginId: string,
        request: PluginDeviceSettingsListRequestInput,
    ) => Promise<PluginDeviceSettingsListPage>;
    readonly getDeviceSettingsUsage: (pluginId: string) => Promise<PluginDeviceSettingsUsage>;
    readonly transactDeviceSettings: (
        pluginId: string,
        input: PluginDeviceSettingsTransactionInput,
    ) => Promise<PluginDeviceSettingsTransactionResult>;
    readonly getDeviceSecret: (
        pluginId: string,
        key: string,
    ) => Promise<PluginDeviceSecretSnapshot | null>;
    readonly listDeviceSecrets: (
        pluginId: string,
        request: PluginDeviceSecretsListRequestInput,
    ) => Promise<PluginDeviceSecretsListPage>;
    readonly getDeviceSecretsUsage: (pluginId: string) => Promise<PluginDeviceSecretsUsage>;
    readonly setDeviceSecret: (
        pluginId: string,
        input: PluginDeviceSecretSetInput,
    ) => Promise<PluginDeviceSecretMutationResult>;
    readonly deleteDeviceSecret: (
        pluginId: string,
        input: PluginDeviceSecretDeleteInput,
    ) => Promise<PluginDeviceSecretMutationResult>;
    readonly describeWorkspace: (pluginId: string) => PluginHostDescriptor;
    readonly getWorkspaceContext: (pluginId: string) => PluginWorkspaceContext;
    readonly openWorkspaceIntent: (
        pluginId: string,
        input: PluginNavigationIntentInput,
    ) => PluginNavigationResult;
    readonly submitProposal: (proposal: PluginProposal) => string;
}

export const samePluginApiIdentity = (left: PluginApiIdentity, right: PluginApiIdentity): boolean => (
    left.pluginId === right.pluginId
    && left.pluginVersion === right.pluginVersion
    && left.dataVersion === right.dataVersion
);

const cloneJson = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

export function createPluginPublicApi(
    pluginId: string,
    dependencies: PluginPublicApiDependencies,
): AxiomPluginApi {
    const identity = dependencies.getActiveIdentity(pluginId);
    if (!identity) throw new PluginApiSessionError(pluginId);
    const frozenIdentity = Object.freeze({ ...identity });

    const requireCurrentIdentity = (): PluginApiIdentity => {
        const current = dependencies.getActiveIdentity(pluginId);
        if (!current || !samePluginApiIdentity(frozenIdentity, current)) {
            throw new PluginApiSessionError(pluginId);
        }
        return current;
    };
    const requireCapability = (capability: PluginCapability): void => {
        requireCurrentIdentity();
        if (!dependencies.hasCapability(pluginId, capability)) {
            throw new PluginApiPermissionError(pluginId, capability);
        }
    };

    return Object.freeze({
        apiVersion: AXIOM_PLUGIN_API_VERSION,
        identity: frozenIdentity,
        read: Object.freeze({
            search: (request: PluginSearchRequest) => {
                requireCapability('portfolio.read-scoped');
                return deepFreeze(cloneJson(
                    dependencies.search(pluginId, cloneJson(request)),
                ));
            },
            getEntity: (reference: UniversalEntityReference) => {
                requireCapability('portfolio.read-scoped');
                return deepFreeze(cloneJson(
                    dependencies.getEntity(pluginId, cloneJson(reference)),
                ));
            },
            queryRelations: (query: PluginEntityRelationQueryInput) => {
                requireCapability('portfolio.read-scoped');
                return deepFreeze(cloneJson(
                    dependencies.queryRelations(pluginId, cloneJson(query)),
                ));
            },
        }),
        storage: Object.freeze({
            portfolio: Object.freeze({
                get: (key: string) => {
                    requireCurrentIdentity();
                    return deepFreeze(cloneJson(
                        dependencies.getStorageDocument(pluginId, key),
                    ));
                },
                list: (request: PluginStorageListRequestInput) => {
                    requireCurrentIdentity();
                    return deepFreeze(cloneJson(
                        dependencies.listStorageDocuments(pluginId, cloneJson(request)),
                    ));
                },
                usage: () => {
                    requireCurrentIdentity();
                    return deepFreeze(cloneJson(
                        dependencies.getStorageUsage(pluginId),
                    ));
                },
                transact: (input: PluginStorageTransactionInput) => {
                    requireCapability('plugin-data.write');
                    return deepFreeze(cloneJson(
                        dependencies.transactStorageDocuments(pluginId, cloneJson(input)),
                    ));
                },
            }),
            device: Object.freeze({
                settings: Object.freeze({
                    get: async (key: string) => {
                        requireCurrentIdentity();
                        const result = await dependencies.getDeviceSetting(pluginId, key);
                        requireCurrentIdentity();
                        return deepFreeze(cloneJson(result));
                    },
                    list: async (request: PluginDeviceSettingsListRequestInput) => {
                        requireCurrentIdentity();
                        const result = await dependencies.listDeviceSettings(
                            pluginId,
                            cloneJson(request),
                        );
                        requireCurrentIdentity();
                        return deepFreeze(cloneJson(result));
                    },
                    usage: async () => {
                        requireCurrentIdentity();
                        const result = await dependencies.getDeviceSettingsUsage(pluginId);
                        requireCurrentIdentity();
                        return deepFreeze(cloneJson(result));
                    },
                    transact: async (input: PluginDeviceSettingsTransactionInput) => {
                        requireCapability('plugin-device-settings.write');
                        const result = await dependencies.transactDeviceSettings(
                            pluginId,
                            cloneJson(input),
                        );
                        return deepFreeze(cloneJson(result));
                    },
                }),
                secrets: Object.freeze({
                    get: async (key: string) => {
                        requireCapability('plugin-secrets.use');
                        const result = await dependencies.getDeviceSecret(pluginId, key);
                        requireCapability('plugin-secrets.use');
                        return deepFreeze(cloneJson(result));
                    },
                    list: async (request: PluginDeviceSecretsListRequestInput) => {
                        requireCapability('plugin-secrets.use');
                        const result = await dependencies.listDeviceSecrets(
                            pluginId,
                            cloneJson(request),
                        );
                        requireCapability('plugin-secrets.use');
                        return deepFreeze(cloneJson(result));
                    },
                    usage: async () => {
                        requireCapability('plugin-secrets.use');
                        const result = await dependencies.getDeviceSecretsUsage(pluginId);
                        requireCapability('plugin-secrets.use');
                        return deepFreeze(cloneJson(result));
                    },
                    set: async (input: PluginDeviceSecretSetInput) => {
                        requireCapability('plugin-secrets.use');
                        const result = await dependencies.setDeviceSecret(
                            pluginId,
                            cloneJson(input),
                        );
                        return deepFreeze(cloneJson(result));
                    },
                    delete: async (input: PluginDeviceSecretDeleteInput) => {
                        requireCapability('plugin-secrets.use');
                        const result = await dependencies.deleteDeviceSecret(
                            pluginId,
                            cloneJson(input),
                        );
                        return deepFreeze(cloneJson(result));
                    },
                }),
            }),
            readCollection: (collectionId: string) => {
                requireCurrentIdentity();
                return deepFreeze(cloneJson(
                    dependencies.readCollection(pluginId, collectionId),
                ));
            },
            replaceCollection: (input: {
                readonly view: PluginCollectionListView;
                readonly items: readonly PluginCollectionItem[];
                readonly expectedRevision: number;
            }) => {
                requireCapability('plugin-data.write');
                if (!input.view.id.startsWith(`${pluginId}/`)) {
                    throw new PluginApiIdentityError(frozenIdentity, {
                        pluginId: input.view.id.split('/')[0] || input.view.id,
                        pluginVersion: frozenIdentity.pluginVersion,
                    });
                }
                return Object.freeze(dependencies.replaceCollection({
                    pluginId,
                    view: cloneJson(input.view),
                    items: cloneJson(input.items),
                    expectedRevision: input.expectedRevision,
                }));
            },
        }),
        proposals: Object.freeze({
            submit: (input: unknown) => {
                requireCapability('proposal.create');
                const proposal = parsePluginProposal(cloneJson(input));
                if (
                    proposal.proposedBy.pluginId !== frozenIdentity.pluginId
                    || proposal.proposedBy.pluginVersion !== frozenIdentity.pluginVersion
                ) {
                    throw new PluginApiIdentityError(frozenIdentity, proposal.proposedBy);
                }
                return Object.freeze({
                    proposalId: dependencies.submitProposal(proposal),
                });
            },
        }),
        workspace: Object.freeze({
            describe: () => {
                requireCurrentIdentity();
                return deepFreeze(cloneJson(dependencies.describeWorkspace(pluginId)));
            },
            getContext: () => {
                requireCapability('portfolio.read-scoped');
                return deepFreeze(cloneJson(dependencies.getWorkspaceContext(pluginId)));
            },
            open: (input: PluginNavigationIntentInput) => {
                requireCapability('workspace.navigate');
                return deepFreeze(cloneJson(
                    dependencies.openWorkspaceIntent(pluginId, cloneJson(input)),
                ));
            },
        }),
    });
}
