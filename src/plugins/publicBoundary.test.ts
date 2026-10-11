import { describe, expect, it } from 'vitest';
import entityReadContract from './entityReadContracts.ts?raw';
import storageContract from './storageContracts.ts?raw';
import deviceStorageContract from './deviceStorageContracts.ts?raw';
import workspaceContract from './workspaceContracts.ts?raw';
import runtimeTransportContract from './runtimeTransport.ts?raw';
import publicEntry from './index.ts?raw';
import publicApiContract from './publicApi.ts?raw';
import uiProtocolContract from './pluginUiProtocol.ts?raw';
import uiWireContract from './pluginUiContracts.ts?raw';
import runtimeBroker from '../host/pluginRuntimeBroker.ts?raw';
import messagePortAdapter from '../host/pluginRuntimeMessagePort.ts?raw';

describe('Core-plugin source boundary', () => {
    it('keeps framework, store, host, and native imports out of the public API contract', () => {
        [
            publicApiContract,
            entityReadContract,
            storageContract,
            deviceStorageContract,
            workspaceContract,
            runtimeTransportContract,
            uiProtocolContract,
            uiWireContract,
        ].forEach(contract => {
            expect(contract).not.toMatch(/from ['"][^'"]*(?:stores|host|lib\/tauri)[^'"]*['"]/);
            expect(contract).not.toMatch(/(?:zustand|react|@tauri-apps)/);
        });
    });

    it('does not export private mutation or administration modules from the public entry point', () => {
        [
            'hostServices',
            'installedPackages',
            'packageInspection',
            'pluginDataMigrations',
            'portfolioActivation',
            'portfolioRevision',
            'proposalReview',
            'entityReadModel',
            'documentStorage',
            'deviceStorageModel',
            'pluginDeviceStorageAdmin',
            'workspaceModel',
        ].forEach(privateModule => expect(publicEntry).not.toContain(privateModule));

        expect(publicEntry).toContain("export * from './publicApi'");
        expect(publicEntry).toContain("export * from './proposals'");
        expect(publicEntry).toContain("export * from './runtimeTransport'");
        expect(publicEntry).toContain("export * from './pluginUiContracts'");
    });

    it('contains no public apply, approval, lifecycle, navigation, or undo method', () => {
        expect(publicApiContract).not.toMatch(
            /readonly\s+(?:apply|approve|accept|install|uninstall|activate|navigate|undo|redo)\s*:/,
        );
    });

    it('keeps the runtime broker detached from stores, native bridges, and the private control plane', () => {
        [runtimeBroker, messagePortAdapter].forEach(contract => {
            expect(contract).not.toMatch(/from ['"][^'"]*(?:stores|lib\/tauri)[^'"]*['"]/);
            expect(contract).not.toMatch(/(?:zustand|@tauri-apps)/);
        });
        expect(runtimeBroker).not.toContain('PluginHostServices');
    });
});
