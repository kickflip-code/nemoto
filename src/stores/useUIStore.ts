import { create } from 'zustand';
import type { CanvasClipboard } from '../lib/canvasClipboard';
import { leavePluginView } from '../plugins/pluginViewLeaveGuard';

export type ActiveTool = 'select' | 'pan' | 'node' | 'edge' | 'text';
export type PluginViewId = `${string}/${string}`;
export type ActiveView = 'designer' | 'journal' | 'dependency' | 'whitelabel' | PluginViewId;

interface UIState {
    inspectorOpen: boolean;
    activeTool: ActiveTool;
    omniboxOpen: boolean;
    exportDialogOpen: boolean;
    importDialogOpen: boolean;
    processCreationOpen: boolean;
    folderCreationRequested: boolean;
    draggedAsset: any | null; // Data payload for the dragged asset
    draggedEntity: { id: string, type: string, name: string, meta: string } | null;
    linkingTarget: { id: string, type: 'node' | 'asset', name: string } | null;
    settingsOpen: boolean;
    helpOpen: boolean;
    portfolioChatOpen: boolean;
    portfolioChatWidth: number;
    editingNodeId: string | null;

    // Clipboard
    clipboard: CanvasClipboard | null;
    setClipboard: (data: CanvasClipboard | null) => void;

    // Actions
    toggleInspector: () => void;
    openInspector: () => void;
    closeInspector: () => void;
    inspectCanvasSelection: () => void;
    clearCanvasInspection: () => void;
    toggleSettings: () => void;
    openSettings: () => void;
    closeSettings: () => void;
    openHelp: () => void;
    closeHelp: () => void;
    openPortfolioChat: () => void;
    closePortfolioChat: () => void;
    setPortfolioChatWidth: (width: number) => void;
    setEditingNodeId: (id: string | null) => void;
    setActiveTool: (tool: ActiveTool) => void;
    openOmnibox: () => void;
    closeOmnibox: () => void;
    openExportDialog: () => void;
    closeExportDialog: () => void;
    openImportDialog: () => void;
    closeImportDialog: () => void;
    openProcessCreation: () => void;
    closeProcessCreation: () => void;
    requestFolderCreation: () => void;
    consumeFolderCreationRequest: () => void;
    setDraggedAsset: (asset: any | null) => void;
    setDraggedEntity: (entity: { id: string, type: string, name: string, meta: string } | null) => void;
    setLinkingTarget: (target: { id: string, type: 'node' | 'asset', name: string } | null) => void;

    selectedAssetId: string | null;
    selectAsset: (id: string | null) => void;

    selectedSwimlaneId: string | null;
    selectSwimlane: (id: string | null) => void;

    activeView: ActiveView;
    setActiveView: (view: ActiveView) => void;

    // Right Panel Mode
    rightPanelMode: 'inspector' | 'journal';
    setRightPanelMode: (mode: 'inspector' | 'journal') => void;

    // Left Panel (SidePanel)
    leftPanelOpen: boolean;
    toggleLeftPanel: () => void;
    sidePanelWidth: number;
    setSidePanelWidth: (width: number) => void;

    // Journal Panel (Bottom Expandable)
    journalPanelExpanded: boolean;
    journalPanelMaximized: boolean;
    journalPanelHeight: number; // Height in pixels when expanded
    toggleJournalPanel: () => void;
    toggleJournalPanelMaximized: () => void;
    expandJournalPanel: () => void;
    collapseJournalPanel: () => void;
    setJournalPanelHeight: (height: number) => void;

    // Gravity Well State (persists across view switches)
    gravityWellFocalPoint: { id: string; label: string } | null;
    setGravityWellFocalPoint: (focalPoint: { id: string; label: string } | null) => void;

    // Resource Power View
    resourcePowerViewOpen: boolean;
    setResourcePowerViewOpen: (open: boolean) => void;

    // Gravity Well Process/Folder Filter
    gravityWellProcessIds: string[];
    setGravityWellProcessIds: (ids: string[]) => void;
    toggleGravityWellProcessId: (id: string) => void;
    gravityWellFolderId: string | null;
    setGravityWellFolderId: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
    inspectorOpen: false,
    settingsOpen: false,
    helpOpen: false,
    portfolioChatOpen: false,
    portfolioChatWidth: 500,
    editingNodeId: null,
    activeTool: 'select',
    omniboxOpen: false,
    exportDialogOpen: false,
    importDialogOpen: false,
    processCreationOpen: false,
    folderCreationRequested: false,
    draggedAsset: null,
    draggedEntity: null,
    linkingTarget: null,
    clipboard: null,

    toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
    openInspector: () => set({ inspectorOpen: true }),
    closeInspector: () => set({ inspectorOpen: false }),
    inspectCanvasSelection: () => set({
        selectedAssetId: null,
        selectedSwimlaneId: null,
        rightPanelMode: 'inspector',
        inspectorOpen: true,
    }),
    clearCanvasInspection: () => set({
        selectedAssetId: null,
        selectedSwimlaneId: null,
        inspectorOpen: false,
    }),
    toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
    openPortfolioChat: () => set({ portfolioChatOpen: true, inspectorOpen: false }),
    closePortfolioChat: () => set({ portfolioChatOpen: false }),
    setPortfolioChatWidth: (width) => set({
        portfolioChatWidth: Math.max(360, Math.min(width, 760)),
    }),
    setEditingNodeId: (id) => set({ editingNodeId: id }),
    setActiveTool: (tool) => set({ activeTool: tool }),
    openOmnibox: () => set({ omniboxOpen: true }),
    closeOmnibox: () => set({ omniboxOpen: false }),
    openExportDialog: () => set({ exportDialogOpen: true }),
    closeExportDialog: () => set({ exportDialogOpen: false }),
    openImportDialog: () => set({ importDialogOpen: true }),
    closeImportDialog: () => set({ importDialogOpen: false }),
    openProcessCreation: () => set({
        processCreationOpen: true,
        folderCreationRequested: false,
        activeView: 'designer',
        leftPanelOpen: true,
    }),
    closeProcessCreation: () => set({ processCreationOpen: false }),
    requestFolderCreation: () => set({
        folderCreationRequested: true,
        processCreationOpen: false,
        activeView: 'designer',
        leftPanelOpen: true,
    }),
    consumeFolderCreationRequest: () => set({ folderCreationRequested: false }),
    setDraggedAsset: (asset) => set({ draggedAsset: asset }),
    setDraggedEntity: (entity) => set({ draggedEntity: entity }),
    setLinkingTarget: (target) => set({ linkingTarget: target }),
    setClipboard: (data) => set({ clipboard: data }),

    // Asset Selection (for Inspector)
    selectedAssetId: null,
    selectAsset: (id) => set({ selectedAssetId: id, selectedSwimlaneId: null, inspectorOpen: !!id }), // Auto-open inspector only if id exists

    selectedSwimlaneId: null,
    selectSwimlane: (id) => set({ selectedSwimlaneId: id, selectedAssetId: null, inspectorOpen: !!id }),

    activeView: 'designer',
    setActiveView: (view) => leavePluginView(get().activeView, view, () => set({ activeView: view })),

    rightPanelMode: 'inspector',
    setRightPanelMode: (mode) => set({ rightPanelMode: mode, inspectorOpen: true }), // Auto-open if switching mode

    leftPanelOpen: true,
    toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),

    sidePanelWidth: 280, // Default width
    setSidePanelWidth: (width) => set({ sidePanelWidth: width }),

    // Journal Panel
    journalPanelExpanded: false,
    journalPanelMaximized: false,
    journalPanelHeight: 400, // Default height 400px
    toggleJournalPanel: () => set((s) => ({
        journalPanelExpanded: !s.journalPanelExpanded,
        journalPanelMaximized: false,
    })),
    toggleJournalPanelMaximized: () => set((s) => ({
        journalPanelExpanded: true,
        journalPanelMaximized: !s.journalPanelMaximized,
    })),
    expandJournalPanel: () => set({ journalPanelExpanded: true }),
    collapseJournalPanel: () => set({ journalPanelExpanded: false, journalPanelMaximized: false }),
    setJournalPanelHeight: (height) => set({ journalPanelHeight: Math.max(300, Math.min(height, window.innerHeight * 0.8)) }),

    // Gravity Well
    gravityWellFocalPoint: null,
    setGravityWellFocalPoint: (focalPoint) => set({ gravityWellFocalPoint: focalPoint }),

    // Resource Power View
    resourcePowerViewOpen: false,
    setResourcePowerViewOpen: (open) => set({ resourcePowerViewOpen: open }),

    // Gravity Well Process/Folder Filter
    gravityWellProcessIds: [],
    setGravityWellProcessIds: (ids) => set({ gravityWellProcessIds: ids, gravityWellFolderId: null }),
    toggleGravityWellProcessId: (id) => set((state) => {
        const current = new Set(state.gravityWellProcessIds);
        if (current.has(id)) {
            current.delete(id);
        } else {
            current.add(id);
        }
        return { gravityWellProcessIds: Array.from(current), gravityWellFolderId: null };
    }),
    gravityWellFolderId: null,
    setGravityWellFolderId: (id) => set({ gravityWellFolderId: id, gravityWellProcessIds: [] }),
}));
