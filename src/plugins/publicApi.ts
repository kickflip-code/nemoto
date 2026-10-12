import type {
    PluginCollectionItem,
} from './collectionStorage';
import type { PluginCollectionListView } from './contributionSchemas';
import type { PluginCapability } from './manifest';
import type { PluginProposal } from './proposals';
import type { PluginSearchRequest, PluginSearchResult } from './searchReadModel';
import { NEMOTO_PLUGIN_API_VERSION } from './activation';
import type {
    PluginEntityRelationPage,
    PluginEntityRelationQueryInput,
    PluginEntitySnapshot,
} from './entityReadContracts';
import type { UniversalEntityReference } from './universalReference';
import type {
    PluginStorageDocumentSnapshot,
    PluginStorageListPage,
    PluginStorageListRequestInput,
    PluginStorageTransactionInput,
    PluginStorageTransactionResult,
    PluginStorageUsage,
} from './storageContracts';
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
} from './deviceStorageContracts';
import type {
    PluginHostDescriptor,
    PluginNavigationIntentInput,
    PluginNavigationResult,
    PluginWorkspaceContext,
} from './workspaceContracts';

/**
 * The only API object that may eventually cross into an isolated executable
 * plugin runtime. Host lifecycle, arbitrary routing, stores, proposal
 * application, and native commands deliberately do not appear here.
 * ADR-034 composed UI uses a separate contribution-bound effect broker. This
 * synchronous API object is not a native guest RPC service or a UI entrypoint.
 */
export interface NemotoPluginApi {
    readonly apiVersion: typeof NEMOTO_PLUGIN_API_VERSION;
    readonly identity: PluginApiIdentity;
    readonly read: PluginReadApi;
    readonly storage: PluginStorageApi;
    readonly proposals: PluginProposalApi;
    readonly workspace: PluginWorkspaceApi;
}

export interface PluginApiIdentity {
    readonly pluginId: string;
    readonly pluginVersion: string;
    readonly dataVersion: number;
}

export interface PluginReadApi {
    readonly search: (request: PluginSearchRequest) => readonly PluginSearchResult[];
    readonly getEntity: (reference: UniversalEntityReference) => PluginEntitySnapshot | null;
    readonly queryRelations: (
        query: PluginEntityRelationQueryInput,
    ) => PluginEntityRelationPage;
}

export interface ReplacePluginStorageCollectionInput {
    readonly view: PluginCollectionListView;
    readonly items: readonly PluginCollectionItem[];
    readonly expectedRevision: number;
}

export interface PluginStorageWriteResult {
    readonly revision: number;
}

export interface PluginStorageCollectionSnapshot {
    readonly items: readonly PluginCollectionItem[];
    readonly error: string | null;
}

export interface PluginStorageApi {
    /** Generic JSON documents that travel with the Portfolio. */
    readonly portfolio: PluginPortfolioStorageApi;
    /** Device-local settings and OS-protected secrets. Never exported with a Portfolio. */
    readonly device: PluginDeviceStorageApi;
    /** Compatibility surface for host-rendered collection-list contributions. */
    readonly readCollection: (collectionId: string) => PluginStorageCollectionSnapshot;
    readonly replaceCollection: (
        input: ReplacePluginStorageCollectionInput,
    ) => PluginStorageWriteResult;
}

export interface PluginDeviceStorageApi {
    readonly settings: PluginDeviceSettingsApi;
    readonly secrets: PluginDeviceSecretsApi;
}

export interface PluginDeviceSettingsApi {
    readonly get: (key: string) => Promise<PluginDeviceSettingSnapshot | null>;
    readonly list: (
        request: PluginDeviceSettingsListRequestInput,
    ) => Promise<PluginDeviceSettingsListPage>;
    readonly usage: () => Promise<PluginDeviceSettingsUsage>;
    readonly transact: (
        input: PluginDeviceSettingsTransactionInput,
    ) => Promise<PluginDeviceSettingsTransactionResult>;
}

export interface PluginDeviceSecretsApi {
    readonly get: (key: string) => Promise<PluginDeviceSecretSnapshot | null>;
    readonly list: (
        request: PluginDeviceSecretsListRequestInput,
    ) => Promise<PluginDeviceSecretsListPage>;
    readonly usage: () => Promise<PluginDeviceSecretsUsage>;
    readonly set: (
        input: PluginDeviceSecretSetInput,
    ) => Promise<PluginDeviceSecretMutationResult>;
    readonly delete: (
        input: PluginDeviceSecretDeleteInput,
    ) => Promise<PluginDeviceSecretMutationResult>;
}

export interface PluginPortfolioStorageApi {
    readonly get: (key: string) => PluginStorageDocumentSnapshot | null;
    readonly list: (request: PluginStorageListRequestInput) => PluginStorageListPage;
    readonly usage: () => PluginStorageUsage;
    readonly transact: (
        input: PluginStorageTransactionInput,
    ) => PluginStorageTransactionResult;
}

export interface PluginProposalSubmissionResult {
    readonly proposalId: string;
}

export interface PluginProposalApi {
    /** Submit only. Review, approval, application, history, and undo stay in Core. */
    readonly submit: (input: unknown) => PluginProposalSubmissionResult;
}

export interface PluginWorkspaceApi {
    /** Discover only the bound plugin's contracts and capability state. */
    readonly describe: () => PluginHostDescriptor;
    /** Returns references only; entity fields remain behind the read API. */
    readonly getContext: () => PluginWorkspaceContext;
    /** Core resolves and applies a constrained UI intent; no arbitrary view IDs. */
    readonly open: (input: PluginNavigationIntentInput) => PluginNavigationResult;
}

export class PluginApiPermissionError extends Error {
    readonly code = 'PLUGIN_CAPABILITY_DENIED';

    constructor(
        readonly pluginId: string,
        readonly capability: PluginCapability,
    ) {
        super(`Plugin '${pluginId}' does not have the '${capability}' capability.`);
        this.name = 'PluginApiPermissionError';
    }
}

export class PluginApiRevisionConflictError extends Error {
    readonly code = 'PLUGIN_REVISION_CONFLICT';

    constructor(
        readonly expectedRevision: number,
        readonly actualRevision: number,
    ) {
        super(`Portfolio changed from revision ${expectedRevision} to ${actualRevision}. Refresh and try again.`);
        this.name = 'PluginApiRevisionConflictError';
    }
}

export class PluginApiSessionError extends Error {
    readonly code = 'PLUGIN_SESSION_UNAVAILABLE';

    constructor(readonly pluginId: string) {
        super(`Plugin '${pluginId}' is not installed, active, and compatible with this portfolio.`);
        this.name = 'PluginApiSessionError';
    }
}

export class PluginApiIdentityError extends Error {
    readonly code = 'PLUGIN_IDENTITY_MISMATCH';

    constructor(
        readonly expected: PluginApiIdentity,
        readonly actual: Pick<PluginProposal['proposedBy'], 'pluginId' | 'pluginVersion'>,
    ) {
        super(`Proposal identity '${actual.pluginId}@${actual.pluginVersion}' does not match the bound plugin session.`);
        this.name = 'PluginApiIdentityError';
    }
}
