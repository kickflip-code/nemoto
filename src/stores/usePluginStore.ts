import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import {
    InstalledPluginDocumentSchema,
    hasInstalledPluginGrant,
    type InstalledPluginDocument,
} from '../plugins/installedPackages';
import {
    installPluginDocument,
    listInstalledPluginDocuments,
    uninstallPluginDocument,
} from '../lib/tauri';

interface PluginStoreState {
    installed: InstalledPluginDocument[];
    initialized: boolean;
    error: string | null;
    load: () => Promise<void>;
    install: (document: InstalledPluginDocument) => Promise<void>;
    uninstall: (pluginId: string) => Promise<void>;
    hasGrant: (pluginId: string, capability: string) => boolean;
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
    installed: [],
    initialized: false,
    error: null,

    load: async () => {
        if (!isTauri()) {
            set({ installed: [], initialized: true, error: null });
            return;
        }
        try {
            const values = await listInstalledPluginDocuments();
            const installed: InstalledPluginDocument[] = [];
            let invalidCount = 0;
            values.forEach(value => {
                const parsed = InstalledPluginDocumentSchema.safeParse(value);
                if (parsed.success) installed.push(parsed.data);
                else invalidCount += 1;
            });
            installed.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
            set({
                installed,
                initialized: true,
                error: invalidCount > 0
                    ? `${invalidCount} invalid installed plugin package(s) were ignored.`
                    : null,
            });
        } catch (error) {
            set({
                installed: [],
                initialized: true,
                error: error instanceof Error ? error.message : 'Installed plugins could not be loaded.',
            });
        }
    },

    install: async document => {
        const current = get().installed.find(item => item.manifest.id === document.manifest.id);
        if (current && current.manifest.version !== document.manifest.version) {
            throw new Error(
                `Plugin updates are not supported in this release candidate. ${current.manifest.name} ${current.manifest.version} remains installed.`,
            );
        }
        await installPluginDocument(document);
        set(state => ({
            installed: [
                ...state.installed.filter(item => item.manifest.id !== document.manifest.id),
                document,
            ].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name)),
            error: null,
        }));
    },

    uninstall: async pluginId => {
        await uninstallPluginDocument(pluginId);
        set(state => ({
            installed: state.installed.filter(item => item.manifest.id !== pluginId),
            error: null,
        }));
    },

    hasGrant: (pluginId, capability) => hasInstalledPluginGrant(
        get().installed,
        pluginId,
        capability as Parameters<typeof hasInstalledPluginGrant>[2],
    ),
}));
