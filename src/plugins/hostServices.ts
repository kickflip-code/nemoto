import type { PluginVersionTransitionReview } from './pluginVersionTransition';
import type { PluginCollectionListView } from './contributionSchemas';
import type { RegisteredPluginCommand } from './commandRegistry';
import type {
    PluginCollectionItem,
    ReadPluginCollectionResult,
} from './collectionStorage';
import type { InstalledPluginDocument } from './installedPackages';
import type { PluginCapability } from './manifest';
import type { PortfolioPluginRequirement } from './portfolioData';
import type {
    RoleJourneyOption,
    RoleJourneyProjection,
} from './readModel';
import type { PluginSearchRequest, PluginSearchResult } from './searchReadModel';
import { NEMOTO_PLUGIN_API_VERSION } from './activation';
import type { NemotoPluginApi } from './publicApi';
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
import {
    PluginApiPermissionError,
    PluginApiRevisionConflictError,
} from './publicApi';

export interface PluginHostSnapshot {
    readonly portfolioRevision: number;
    readonly installedPlugins: readonly InstalledPluginDocument[];
    readonly pluginsInitialized: boolean;
    readonly pluginLoadError: string | null;
    readonly pluginRequirements: readonly PortfolioPluginRequirement[];
    readonly activeView: string;
}

export type PluginHostEvent =
    | {
        readonly type: 'portfolio.changed';
        readonly revision: number;
        readonly timestamp: string;
        readonly origin: {
            readonly kind: 'host' | 'plugin';
            readonly operation: string;
            readonly pluginId?: string;
        };
    }
    | {
        readonly type: 'plugins.changed';
        readonly timestamp: string;
    }
    | {
        readonly type: 'navigation.changed';
        readonly activeView: string;
        readonly timestamp: string;
    };

export interface ReplacePluginCollectionInput {
    readonly pluginId: string;
    readonly view: PluginCollectionListView;
    readonly items: readonly PluginCollectionItem[];
    readonly expectedRevision: number;
}

export interface PluginDataWriteResult {
    readonly revision: number;
}

export interface TransactPluginDocumentsInput {
    readonly pluginId: string;
    readonly transaction: PluginStorageTransactionInput;
}

export class PluginHostPermissionError extends PluginApiPermissionError {
    constructor(
        readonly pluginId: string,
        readonly capability: PluginCapability,
    ) {
        super(pluginId, capability);
        this.name = 'PluginHostPermissionError';
    }
}

export class PluginHostRevisionConflictError extends PluginApiRevisionConflictError {
    constructor(
        readonly expectedRevision: number,
        readonly actualRevision: number,
    ) {
        super(expectedRevision, actualRevision);
        this.name = 'PluginHostRevisionConflictError';
    }
}

export interface PluginHostServices {
    readonly apiVersion: typeof NEMOTO_PLUGIN_API_VERSION;
    readonly getSnapshot: () => PluginHostSnapshot;
    readonly subscribe: (listener: () => void) => () => void;
    readonly events: {
        subscribe: (listener: (event: PluginHostEvent) => void) => () => void;
    };
    readonly permissions: {
        has: (pluginId: string, capability: PluginCapability) => boolean;
    };
    /** Host-only factory. Isolated runtimes receive only the returned bound API. */
    readonly publicApi: {
        connect: (pluginId: string) => NemotoPluginApi;
    };
    readonly plugins: {
        reviewVersionChange: (pluginId: string) => PluginVersionTransitionReview;
        load: () => Promise<void>;
        install: (document: InstalledPluginDocument) => Promise<void>;
        uninstall: (document: InstalledPluginDocument) => Promise<void>;
        setActive: (document: InstalledPluginDocument, active: boolean) => void;
    };
    readonly navigation: {
        open: (viewId: string) => void;
    };
    readonly executableProposals: {
        run: (command: RegisteredPluginCommand) => Promise<{ readonly proposalId: string }>;
    };
    readonly deviceStorage: {
        readonly settings: {
            get: (pluginId: string, key: string) => Promise<PluginDeviceSettingSnapshot | null>;
            list: (
                pluginId: string,
                request: PluginDeviceSettingsListRequestInput,
            ) => Promise<PluginDeviceSettingsListPage>;
            usage: (pluginId: string) => Promise<PluginDeviceSettingsUsage>;
            transact: (
                pluginId: string,
                input: PluginDeviceSettingsTransactionInput,
            ) => Promise<PluginDeviceSettingsTransactionResult>;
        };
        readonly secrets: {
            get: (pluginId: string, key: string) => Promise<PluginDeviceSecretSnapshot | null>;
            list: (
                pluginId: string,
                request: PluginDeviceSecretsListRequestInput,
            ) => Promise<PluginDeviceSecretsListPage>;
            usage: (pluginId: string) => Promise<PluginDeviceSecretsUsage>;
            set: (
                pluginId: string,
                input: PluginDeviceSecretSetInput,
            ) => Promise<PluginDeviceSecretMutationResult>;
            delete: (
                pluginId: string,
                input: PluginDeviceSecretDeleteInput,
            ) => Promise<PluginDeviceSecretMutationResult>;
        };
    };
    readonly workspace: {
        describe: (pluginId: string) => PluginHostDescriptor;
        getContext: (pluginId: string) => PluginWorkspaceContext;
        open: (
            pluginId: string,
            input: PluginNavigationIntentInput,
        ) => PluginNavigationResult;
    };
    readonly projections: {
        listRoleJourneyOptions: () => readonly RoleJourneyOption[];
        getRoleJourney: (roleId: string) => RoleJourneyProjection | null;
    };
    readonly search: {
        query: (
            pluginId: string,
            request: PluginSearchRequest,
        ) => readonly PluginSearchResult[];
    };
    readonly pluginData: {
        readCollection: (pluginId: string, collectionId: string) => ReadPluginCollectionResult;
        replaceCollection: (input: ReplacePluginCollectionInput) => PluginDataWriteResult;
        getDocument: (
            pluginId: string,
            key: string,
        ) => PluginStorageDocumentSnapshot | null;
        listDocuments: (
            pluginId: string,
            request: PluginStorageListRequestInput,
        ) => PluginStorageListPage;
        getUsage: (pluginId: string) => PluginStorageUsage;
        transactDocuments: (
            input: TransactPluginDocumentsInput,
        ) => PluginStorageTransactionResult;
    };
}
