import type { StateCreator } from 'zustand';
import type { PreparedPluginImport } from '../actions/preparedPluginImport';
import type { Portfolio, Process, Asset, Incident, CanvasGraph, AssetCategory, ProcessFolder, ImportedPortfolio, ThemeConfig } from '../../types';

export interface CoreSlice {
    portfolio: Portfolio;
    isLoading: boolean;
    isDirty: boolean;
    isSaving: boolean;
    isRestoring: boolean;
    lastSavedAt: string | null;
    saveError: string | null;
    loadError: string | null;
    recoveryAvailable: boolean;
    changeRevision: number;
    importedPortfolios: ImportedPortfolio[];

    loadPortfolio: () => Promise<void>;
    recoverPortfolioBackup: () => Promise<void>;
    savePortfolio: () => Promise<void>;

    markDirty: () => void;
    markClean: () => void;
    setPortfolio: (portfolio: Portfolio) => void;
    hydratePortfolio: (portfolio: Portfolio, dirty?: boolean) => void;
    updateCustomThemes: (themes: ThemeConfig[]) => void;
    setActiveThemeId: (id: string | null) => void;
}

export interface ProcessSlice {
    addProcess: (process: Process) => void;
    updateProcess: (id: string, updates: Partial<Process>) => void;
    deleteProcess: (ids: string[], deleteOrphanedAssets?: boolean) => void;
    duplicateProcess: (id: string) => void;
    updateProcessGraph: (processId: string, graph: CanvasGraph, copiedGraphs?: { add: Record<string, CanvasGraph>; remove: string[] }) => void;
    convertProcess: (id: string, newMode: 'swimlane' | 'swimlane-vertical' | 'blank', subprocessId?: string) => void;
}

export interface FolderSlice {
    addFolder: (title: string, parentId?: string) => void;
    updateFolder: (id: string, updates: Partial<ProcessFolder>) => void;
    deleteFolder: (id: string) => void;
    moveItem: (itemId: string, itemType: 'process' | 'folder', targetFolderId: string | undefined) => void;
}

export interface AssetSlice {
    setAssets: (assets: Asset[]) => void;
    addAsset: (asset: Asset) => void;
    importResources: (resources: Asset[]) => void;
    updateAsset: (id: string, updates: Partial<Asset>) => void;
    deleteAsset: (id: string) => void;
    deleteAssets: (ids: string[]) => void;
    purgeAsset: (id: string) => void;
    duplicateAsset: (id: string) => void;

    addAssetCategory: (category: AssetCategory) => void;
    updateAssetCategory: (id: string, updates: Partial<AssetCategory>) => void;
    deleteAssetCategory: (id: string) => void;
}

export interface IncidentSlice {
    setIncidents: (incidents: Incident[]) => void;
    addIncident: (incident: Incident) => void;
    updateIncident: (id: string, updates: Partial<Incident>) => void;
    deleteIncident: (id: string) => void;
}

export interface ImportSlice {
    preparePluginImport: (source: ImportedPortfolio) => PreparedPluginImport;
    commitPluginImport: (plan: PreparedPluginImport) => void;
    addImportedPortfolio: (imported: ImportedPortfolio) => void;
    removeImportedPortfolio: (id: string) => void;
    importProcess: (process: Process, source: ImportedPortfolio) => { processId: string, nodeMap: Map<string, string> };
    importAsset: (asset: Asset, source: ImportedPortfolio) => string;
    importAssetCategory: (category: AssetCategory) => void;
    importNotebook: (notebook: { id: string, title: string }) => void;
    importJournalTag: (tag: { id: string, label: string, color: string }) => string;
    importJournalEntry: (entry: any, source?: ImportedPortfolio) => void;
    mergeImportedPortfolio: (source: ImportedPortfolio) => { mergedItemCount: number };
}

export interface JournalSlice {
    // Notebooks & Folders
    createJournalFolder: (title: string, parentId?: string) => string;
    deleteJournalFolder: (id: string) => void;
    moveJournalItem: (itemId: string, itemType: 'notebook' | 'folder' | 'variable', targetFolderId?: string) => void;
    renameJournalItem: (itemId: string, itemType: 'notebook' | 'folder', newTitle: string) => void;
    createNotebook: (title: string, folderId?: string) => string;
    deleteNotebook: (id: string) => void;

    // Entries
    createEntry: (notebookId: string, title?: string) => string;
    updateEntry: (id: string, updates: Partial<any>) => void; // Using any or importing JournalEntry inline
    deleteEntry: (id: string) => void;
    moveEntry: (entryId: string, targetNotebookId: string) => void;

    // Tags & Linking
    createTag: (label: string, color: string) => void;
    deleteTag: (id: string) => void;
    purgeTag: (id: string) => void;
    linkContext: (entryId: string, entityRef: any) => void; // Using any or importing EntityReference
    unlinkContext: (entryId: string, entityId: string) => void;
}

export type PortfolioStore = CoreSlice & ProcessSlice & FolderSlice & AssetSlice & IncidentSlice & ImportSlice & JournalSlice;

export type PortfolioSlice<T> = StateCreator<
    PortfolioStore,
    [],
    [],
    T
>;
