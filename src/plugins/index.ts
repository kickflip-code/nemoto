/**
 * Public plugin-contract entry point.
 *
 * Keep host adapters, application stores, package administration, proposal
 * application, migrations, and native bridges out of this barrel. Core code
 * imports those modules by their private paths.
 */
export { AXIOM_PLUGIN_API_VERSION } from './activation';
export * from './publicApi';
export * from './manifest';
export * from './contributionSchemas';
export * from './entityReadContracts';
export * from './executableCompute';
export * from './identifiers';
export * from './proposals';
export * from './runtimeTransport';
export * from './semanticData';
export * from './storageContracts';
export * from './deviceStorageContracts';
export * from './universalReference';
export * from './versionRange';
export * from './workspaceContracts';
export * from './pluginUiProtocol';
export * from './pluginUiContracts';

export type {
    PluginCollectionItem,
    ReadPluginCollectionResult,
} from './collectionStorage';
export type {
    PluginSearchRequest,
    PluginSearchResult,
} from './searchReadModel';
