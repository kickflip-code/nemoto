import {
    ChevronRight, Folder, LayoutGrid, Check, Plus, X, Trash2, FolderPlus,
    FileText, Network, Import, FilePlus, Maximize2, Minimize2, Box, CheckSquare,
    Square, DownloadCloud, Settings2, GripVertical, FolderOpen, Server
} from 'lucide-react';

import { Search as SearchIcon, icons } from 'lucide-react';
import { getIconComponent } from '../../lib/iconMap';
import { useUIStore } from '../../stores/useUIStore';

import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type { Asset, Process, AssetCategory, CanvasMode, ImportedPortfolio } from '../../types';
import TemplateSelectionModal from './TemplateSelectionModal';
import { PALETTE, getPaletteColor } from '../../constants/palette';
import { createPortal } from 'react-dom';
import ContextMenu from '../shared/ContextMenu';
import ShowUsageModal from '../shared/ShowUsageModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import { Copy, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { generateId } from '../../lib/id';
import PluginImportReviewDialog from '../import/PluginImportReviewDialog';
import type { PreparedPluginImport } from '../../stores/actions/preparedPluginImport';
import { exportProcessWithFeedback } from '../shared/exportProcessWithFeedback';
import { sanitizeHtml } from '../../lib/sanitize';
import {
    buildDrilldownTree,
    removeDrilldownNodeAtPath,
    renameDrilldownNodeAtPath,
} from '../../lib/drilldownGraph';
import { getGraphAtPath } from '../../lib/entityResolver';
import {
    NemotoButton,
    NemotoColorSwatch,
    NemotoDialog,
    NemotoDialogFooter,
    NemotoInput,
    NemotoIconTile,
    NemotoPanel,
    NemotoPanelDivider,
    NemotoPanelHeader,
    NemotoPanelIconButton,
    NemotoPanelRowButton,
    NemotoSelect,
} from '../ui';

const MarkdownPreview = React.lazy(() => import('../shared/MarkdownPreview'));

// --- HELPER COMPONENTS ---

// --- HELPER COMPONENTS ---

const InlineInput = ({ value, onCommit, onCancel }: { value: string, onCommit: (val: string) => void, onCancel: () => void }) => {
    const [tempValue, setTempValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    return (
        <NemotoInput
            ref={inputRef}
            type="text"
            controlSize="xs"
            className="flex-1 h-5 min-w-[50px]"
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={() => onCommit(tempValue)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onCommit(tempValue);
                if (e.key === 'Escape') onCancel();
            }}
            onClick={(e) => e.stopPropagation()}
        />
    );
};


// --- COMPONENTS ---

export default function SidePanel() {
    const [topPanelRatio, setTopPanelRatio] = useState(55); // Default 55% for top panel

    const {
        selectAsset,
        selectedAssetId,
        sidePanelWidth,
        setSidePanelWidth,
        setResourcePowerViewOpen,
        processCreationOpen,
        closeProcessCreation,
        openProcessCreation,
        folderCreationRequested,
        consumeFolderCreationRequest,
    } = useUIStore();
    const {
        portfolio,
        addProcess,
        deleteProcess,
        moveItem,
        deleteFolder,
        addAsset // Ported from library store
    } = usePortfolioStore();
    const { activeProcessId, setActiveProcess } = useProcessSessionStore();

    // Consolidated assets from portfolio
    const assets = portfolio.assets || [];


    const [creationPopoverOpen, setCreationPopoverOpen] = useState(false);
    const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
    const [showUsageResource, setShowUsageResource] = useState<{ id: string; name: string } | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmLabel?: string;
        variant?: 'danger' | 'warning' | 'primary';
        onConfirm: () => void;
    } | null>(null);
    const [resourcesExpanded, setResourcesExpanded] = useState(false);

    // Import State
    const { importedPortfolios, importProcess, importAsset, removeImportedPortfolio } = usePortfolioStore();

    const [newItemName, setNewItemName] = useState('');
    // const [newProcessName, setNewProcessName] = useState(''); // Moved to Modal
    const [newItemCategory, setNewItemCategory] = useState<string>(''); // AssetCategory ID
    const [renamingId, setRenamingId] = useState<string | null>(null);

    const popoverTriggerRef = useRef<HTMLButtonElement>(null);

    // --- FOLDER SELECTION STATE ---
    // Track the currently selected folder (either directly clicked, or inferred from selected process)
    const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(() => {
        const activeProcess = portfolio.processes.find(process => process.id === activeProcessId);
        return activeProcess?.folderId ?? undefined;
    });



    // Ensure we have a valid selection for new items
    useEffect(() => {
        if (!newItemCategory && portfolio.assetCategories?.length > 0) {
            setNewItemCategory(portfolio.assetCategories[0].id);
        }
    }, [portfolio.assetCategories, newItemCategory]);

    // Sync selectedFolderId when activeProcessId changes (infer folder from process)
    useEffect(() => {
        if (activeProcessId) {
            // Use getState() to avoid adding portfolio.processes to dependencies
            const processes = usePortfolioStore.getState().portfolio.processes;
            const proc = processes.find(p => p.id === activeProcessId);
            // Set folder to the process's folder (or undefined for root)
            setSelectedFolderId(proc?.folderId ?? undefined);
        }
    }, [activeProcessId]); // Only depend on activeProcessId, not portfolio.processes

    // Group assets based on dynamic categories
    const groupedResources = useMemo(() => {
        if (!portfolio.assetCategories) return [];

        const groups = portfolio.assetCategories.map(cat => ({
            ...cat,
            items: [] as Asset[]
        }));

        const uncategorized: Asset[] = [];

        assets.forEach(asset => {
            const catIndex = groups.findIndex(g => g.id === asset.type);
            if (catIndex !== -1) {
                groups[catIndex].items.push(asset);
            } else {
                uncategorized.push(asset);
            }
        });

        const finalGroups = groups.filter(g => g.items.length > 0);
        if (uncategorized.length > 0) {
            finalGroups.push({
                id: 'uncategorized',
                label: 'Uncategorized',
                icon: 'Box',
                color: 'gray',
                items: uncategorized
            });
        }

        return finalGroups;
    }, [assets, portfolio.assetCategories]);

    const handleQuickCreate = () => {
        if (!newItemName.trim() || !newItemCategory) return;

        const newAsset: Asset = {
            id: generateId('res'),
            name: newItemName.trim(),
            type: newItemCategory, // Now directly linking to Category ID
            parentId: undefined
        };

        addAsset(newAsset);
        setNewItemName('');
        setCreationPopoverOpen(false);
        selectAsset(newAsset.id);
    };

    const handleCreateProcess = (name: string, mode: CanvasMode) => {
        const newProcess: Process = {
            id: generateId('proc'),
            title: name.trim(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            graph: { nodes: [], edges: [], swimlanes: [], mode: 'blank', division: { version: 1, rowsVisible: false, columnsVisible: false } },
            // NEW: Create in the currently selected folder
            folderId: selectedFolderId,
            mode: mode
        };

        addProcess(newProcess);
        closeProcessCreation();
        // Activate the new process
        setActiveProcess(newProcess.id);
    };

    const handleCreateFolder = () => {
        setCreatingFolderIn(selectedFolderId || undefined);
    }

    useEffect(() => {
        if (!folderCreationRequested) return;
        setCreatingFolderIn(selectedFolderId || undefined);
        consumeFolderCreationRequest();
    }, [folderCreationRequested, consumeFolderCreationRequest, selectedFolderId]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleQuickCreate();
        if (e.key === 'Escape') setCreationPopoverOpen(false);
    };



    const deleteProcessById = (id: string) => {
        const isCurrent = activeProcessId === id;
        deleteProcess([id]);

        if (isCurrent) {
            const { activeProcessId: newId } = useProcessSessionStore.getState();
            const { portfolio } = usePortfolioStore.getState();
            if (newId) {
                const nextProc = portfolio.processes.find(p => p.id === newId);
                if (nextProc) {
                    useCanvasStore.getState().loadGraph(nextProc.graph);
                }
            } else {
                useCanvasStore.getState().loadGraph({ nodes: [], edges: [], swimlanes: [] });
            }
        }
    };

    const handleDeleteProcess = (id: string) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Process',
            message: 'Are you sure you want to delete this process? This action cannot be undone.',
            confirmLabel: 'Delete',
            variant: 'danger',
            onConfirm: () => deleteProcessById(id)
        });
    };

    const handleDeleteFolder = (id: string) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Folder',
            message: 'Delete this folder? Items inside will be moved to root.',
            confirmLabel: 'Delete',
            variant: 'danger',
            onConfirm: () => {
                deleteFolder(id);
                if (selectedFolderId === id) {
                    setSelectedFolderId(undefined);
                }
            }
        });
    }

    // --- CONTEXT MENU STATE ---
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        type: 'process' | 'folder' | 'subprocess' | 'resource';
        id: string;
        parentId?: string;
        breadcrumbPath?: string[];
        cyclic?: boolean;
    } | null>(null);
    const [mentionContextMenu, setMentionContextMenu] = useState<{ x: number, y: number, id: string, type: string, label: string } | null>(null);

    // Handle Ctrl+Click on mentions in preview
    const handleMentionClick = useCallback((e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const mention = target.closest('.mention') as HTMLElement;

        if (mention && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();

            const mentionId = mention.dataset.mentionId;
            const mentionType = mention.dataset.mentionType;
            const mentionLabel = mention.textContent?.replace('@', '') || 'Entity';

            if (!mentionId || !mentionType) return;

            setMentionContextMenu({
                x: e.clientX,
                y: e.clientY,
                id: mentionId,
                type: mentionType,
                label: mentionLabel
            });
        }
    }, []);

    useEffect(() => {
        document.addEventListener('click', handleMentionClick);
        return () => document.removeEventListener('click', handleMentionClick);
    }, [handleMentionClick]);

    const handleContextMenu = (
        e: Pick<React.MouseEvent, 'preventDefault' | 'stopPropagation' | 'clientX' | 'clientY'>,
        type: 'process' | 'folder' | 'subprocess' | 'resource',
        id: string,
        parentId?: string,
        breadcrumbPath?: string[],
        cyclic?: boolean,
    ) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, type, id, parentId, breadcrumbPath, cyclic });
    };

    const handleContextAction = (action: 'delete' | 'rename') => {
        if (!contextMenu) return;
        const { id, type, parentId, breadcrumbPath } = contextMenu;

        if (action === 'delete') {
            if (type === 'process') handleDeleteProcess(id);
            if (type === 'folder') handleDeleteFolder(id);
            if (type === 'resource') {
                const { portfolio } = usePortfolioStore.getState();

                // Check usage in processes
                const usedInProcesses = portfolio.processes.filter(p =>
                    p.graph.nodes.some(n => n.assetIds?.includes(id))
                );

                // Check usage in journal
                const usedInJournal = portfolio.journal?.entries.filter(e =>
                    (e.linkedContext || []).some(ctx => ctx.id === id)
                ) || [];

                if (usedInProcesses.length > 0 || usedInJournal.length > 0) {
                    let message = "This resource is currently used in:";

                    if (usedInProcesses.length > 0) {
                        message += "\n\nProcesses:\n" + usedInProcesses.map(p => `- ${p.title}`).slice(0, 5).join('\n');
                        if (usedInProcesses.length > 5) message += `\n...and ${usedInProcesses.length - 5} more`;
                    }

                    if (usedInJournal.length > 0) {
                        message += "\n\nJournal Entries:\n" + usedInJournal.map(e => `- ${e.title || 'Untitled'}`).slice(0, 5).join('\n');
                        if (usedInJournal.length > 5) message += `\n...and ${usedInJournal.length - 5} more`;
                    }

                    message += "\n\nAre you sure you want to delete it anyway? This will break links.";

                    setConfirmDialog({
                        isOpen: true,
                        title: 'Delete Linked Resource',
                        message,
                        confirmLabel: 'Delete Anyway',
                        variant: 'warning',
                        onConfirm: () => {
                            usePortfolioStore.getState().purgeAsset(id);
                            usePortfolioStore.getState().deleteAsset(id);
                            toast.success('Resource deleted and links removed');
                        }
                    });
                } else {
                    setConfirmDialog({
                        isOpen: true,
                        title: 'Delete Resource',
                        message: 'Delete this resource? This action cannot be undone.',
                        confirmLabel: 'Delete',
                        variant: 'danger',
                        onConfirm: () => {
                            usePortfolioStore.getState().purgeAsset(id);
                            usePortfolioStore.getState().deleteAsset(id);
                            toast.success('Resource deleted');
                        }
                    });
                }
            }
            if (type === 'subprocess') {
                setConfirmDialog({
                    isOpen: true,
                    title: 'Delete Drilldown Node',
                    message: 'Are you sure you want to delete this drilldown node? This will remove the node from the parent graph.',
                    confirmLabel: 'Delete',
                    variant: 'danger',
                    onConfirm: () => {
                        if (!parentId || !breadcrumbPath?.length) {
                            toast.error('Could not locate this drilldown in its parent process');
                            return;
                        }

                        const store = usePortfolioStore.getState();
                        const process = store.portfolio.processes.find(candidate => candidate.id === parentId);
                        if (!process) {
                            toast.error('Parent process not found');
                            return;
                        }

                        const result = removeDrilldownNodeAtPath(process, breadcrumbPath);
                        if (!result.removed) {
                            toast.error('Could not remove this drilldown');
                            return;
                        }

                        store.updateProcess(process.id, {
                            graph: result.process.graph,
                            subGraphs: result.process.subGraphs,
                        });

                        const session = useProcessSessionStore.getState();
                        if (session.activeProcessId === process.id) {
                            const currentPath = session.breadcrumbStack;
                            const currentInsideDeletedBranch = breadcrumbPath.every(
                                (nodeId, index) => currentPath[index] === nodeId,
                            );
                            const nextPath = currentInsideDeletedBranch
                                ? breadcrumbPath.slice(0, -1)
                                : currentPath;
                            const nextGraph = getGraphAtPath(result.process, nextPath) || result.process.graph;

                            session.setBreadcrumbStack(nextPath);
                            useCanvasStore.getState().loadGraph(nextGraph);
                            useUIStore.getState().clearCanvasInspection();
                        }

                        toast.success('Drilldown deleted');
                    }
                });
            }
        } else if (action === 'rename') {
            setRenamingId(id);
        }
        setContextMenu(null);
    };

    // --- TREE DATA PREP ---
    // Organize folders and processes into a hierarchy
    const rootItems = useMemo(() => {
        const folders = portfolio.processFolders || [];
        const processes = portfolio.processes || [];

        // Helper to match IDs handling null/undefined correctly
        // Rust sends null for Option::None, TS uses undefined. Treat them as equivalent for "root".
        const isChildOf = (itemParentId: string | null | undefined, targetParentId: string | undefined): boolean => {
            if (targetParentId === undefined) {
                // Looking for root items: matches if parentId is null, undefined, or empty string
                return !itemParentId;
            }
            // Looking for children of a specific folder
            return itemParentId === targetParentId;
        };

        const extractSubprocesses = (process: Process): any[] => {
            const toTreeItem = (branch: ReturnType<typeof buildDrilldownTree>[number]): any => ({
                type: 'subprocess',
                data: {
                    id: branch.node.id,
                    title: branch.node.label,
                    processId: process.id,
                    breadcrumbPath: branch.breadcrumbPath,
                    graph: branch.graph,
                    cyclic: branch.cyclic,
                },
                children: branch.children.map(toTreeItem),
            });

            return buildDrilldownTree(process).map(toTreeItem);
        };

        const renderedFolderIds = new Set<string>();
        const processItemsFor = (folderId: string | undefined): any[] => processes
            .filter(process => isChildOf(process.folderId, folderId))
            .map(process => ({
                type: 'process',
                data: process,
                children: extractSubprocesses(process)
            }));

        const buildFolder = (folder: (typeof folders)[number]): any | null => {
            if (renderedFolderIds.has(folder.id)) return null;
            renderedFolderIds.add(folder.id);

            const childFolders = folders
                .filter(candidate => candidate.parentId === folder.id)
                .map(buildFolder)
                .filter(Boolean);

            return {
                type: 'folder',
                data: folder,
                children: [...childFolders, ...processItemsFor(folder.id)],
            };
        };

        const folderIds = new Set(folders.map(folder => folder.id));
        const rootItems = folders
            .filter(folder => !folder.parentId || !folderIds.has(folder.parentId))
            .map(buildFolder)
            .filter(Boolean);

        // Keep restored/imported cyclic branches visible and make recursion finite.
        folders.forEach(folder => {
            if (renderedFolderIds.has(folder.id)) return;
            const recovered = buildFolder(folder);
            if (recovered) rootItems.push(recovered);
        });

        return [...rootItems, ...processItemsFor(undefined)];
    }, [portfolio.processFolders, portfolio.processes]);


    // --- CUSTOM DRAG HANDLERS (Mouse-based, works in Tauri) ---
    const [customDragState, setCustomDragState] = useState<{
        isDragging: boolean;
        itemId: string | null;
        itemType: 'process' | 'folder' | 'imported-process' | 'imported-asset' | 'imported-journal-entry' | null;
        sourcePortfolioId?: string | null; // For imports
        startY: number;
    }>({ isDragging: false, itemId: null, itemType: null, startY: 0 });

    const [dropTargetId, setDropTargetId] = useState<string | undefined>(undefined);

    const handleMouseDown = (e: React.MouseEvent, id: string, type: 'process' | 'folder') => {
        // Only left mouse button
        if (e.button !== 0) return;

        setCustomDragState({
            isDragging: false, // Will become true on mouse move
            itemId: id,
            itemType: type,
            startY: e.clientY
        });
    };

    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

    const handleMouseMove = (e: React.MouseEvent) => {
        // Update cursor tracker for drag proxy
        setCursorPos({ x: e.clientX, y: e.clientY });

        // Only proceed with drag logic if an item is potentially being dragged
        if (!customDragState.itemId) return;

        e.preventDefault(); // Prevent default browser drag behavior

        // Start dragging if moved more than 5px
        const distance = Math.abs(e.clientY - customDragState.startY);
        if (distance > 5 && !customDragState.isDragging) {
            setCustomDragState(prev => ({ ...prev, isDragging: true }));
        }
    };

    const handleImportDragStart = (e: React.MouseEvent, id: string, type: 'imported-process' | 'imported-asset' | 'imported-journal-entry', sourcePortfolioId: string) => {
        if (e.button === 0) {
            e.preventDefault();
            setCustomDragState({
                isDragging: false,
                itemId: id,
                itemType: type,
                sourcePortfolioId,
                startY: e.clientY
            });
        }
    };

    const handleMouseUp = () => {
        if (!customDragState.isDragging || !customDragState.itemId) {
            // Just a click, not a drag
            setCustomDragState({ isDragging: false, itemId: null, itemType: null, startY: 0 });
            return;
        }

        // Perform the move or import
        if (customDragState.itemId && customDragState.itemType) {
            if (customDragState.itemType === 'imported-process') {
                const sourcePortfolio = importedPortfolios.find(p => p.id === customDragState.sourcePortfolioId);
                if (sourcePortfolio) {
                    const process = (sourcePortfolio.data.processes || []).find(p => p.id === customDragState.itemId);
                    if (process) {
                        importProcess(process as any, sourcePortfolio);
                    }
                }
            } else if (customDragState.itemType === 'imported-asset') {
                const sourcePortfolio = importedPortfolios.find(p => p.id === customDragState.sourcePortfolioId);
                if (sourcePortfolio) {
                    const asset = (sourcePortfolio.data.assets || []).find(a => a.id === customDragState.itemId);
                    if (asset) {
                        importAsset(asset, sourcePortfolio);
                    }
                }
            } else if (customDragState.itemType === 'imported-journal-entry') {
                const sourcePortfolio = importedPortfolios.find(p => p.id === customDragState.sourcePortfolioId);
                if (sourcePortfolio) {
                    const entry = (sourcePortfolio.data.journal?.entries || []).find((e: any) => e.id === customDragState.itemId);
                    if (entry) {
                        usePortfolioStore.getState().importJournalEntry(entry, sourcePortfolio);
                    }
                }
            } else if (customDragState.itemType === 'process' || customDragState.itemType === 'folder') {
                // Normal Move Logic
                if (dropTargetId !== undefined) {
                    moveItem(customDragState.itemId, customDragState.itemType, dropTargetId);
                } else {
                    moveItem(customDragState.itemId, customDragState.itemType, undefined);
                }
            }
        }

        // Reset
        setCustomDragState({ isDragging: false, itemId: null, itemType: null, startY: 0 });
        setDropTargetId(undefined);
    };

    const handleMouseLeave = () => {
        // Cancel drag if mouse leaves the component
        if (customDragState.isDragging) {
            setCustomDragState({ isDragging: false, itemId: null, itemType: null, startY: 0 });
            setDropTargetId(undefined);
        }
    };


    // Helper to determine folder display name for creation hint
    const selectedFolderName = useMemo(() => {
        if (!selectedFolderId) return null;
        const folder = portfolio.processFolders?.find(f => f.id === selectedFolderId);
        return folder?.title || null;
    }, [selectedFolderId, portfolio.processFolders]);

    // --- PREVIEW STATE ---
    const [previewEntry, setPreviewEntry] = useState<any | null>(null);
    const [pluginImportPlan, setPluginImportPlan] = useState<PreparedPluginImport | null>(null);

    // --- BULK IMPORT STATE ---
    const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
    const [processExpansionToggle, setProcessExpansionToggle] = useState({ count: 0, action: 'expand' as 'expand' | 'collapse' });
    const [resourceExpansionToggle, setResourceExpansionToggle] = useState({ count: 0, action: 'expand' as 'expand' | 'collapse' });
    const [creatingFolderIn, setCreatingFolderIn] = useState<string | undefined | null>(null);
    const [selectionMap, setSelectionMap] = useState<Map<string, { type: 'process' | 'asset' | 'journal', data: any, source?: any }>>(new Map());

    const toggleImportSelection = (e: React.MouseEvent, id: string, type: 'process' | 'asset' | 'journal', data: any, source?: any) => {
        e.stopPropagation();
        const newSet = new Set(selectedImports);
        const newMap = new Map(selectionMap);

        if (newSet.has(id)) {
            newSet.delete(id);
            newMap.delete(id);
        } else {
            newSet.add(id);
            newMap.set(id, { type, data, source });
        }

        setSelectedImports(newSet);
        setSelectionMap(newMap);
    };

    const handleImportSelected = () => {
        let count = 0;
        selectionMap.forEach(({ type, data, source }) => {
            if (type === 'process' && source) {
                if (!usePortfolioStore.getState().importProcess(data, source).processId) return;
            }
            else if (type === 'asset' && source) usePortfolioStore.getState().importAsset(data, source);
            else if (type === 'journal') usePortfolioStore.getState().importJournalEntry(data);
            count++;
        });

        if (count > 0) toast.success(`Imported ${count} items`);
        setSelectedImports(new Set());
        setSelectionMap(new Map());
    };

    const handleImportAll = (imported: ImportedPortfolio) => {
        try {
            const plan = usePortfolioStore.getState().preparePluginImport(imported);
            if (plan.rows.length) { setPluginImportPlan(plan); return; }
            const { mergedItemCount } = usePortfolioStore.getState().mergeImportedPortfolio(imported);
            toast.success(`Merged ${mergedItemCount} supported item(s) from "${imported.sourceName}"`);
        } catch (error) {
            console.error('[Import] Atomic merge failed:', error);
            toast.error(`Nothing was merged. ${error instanceof Error ? error.message : 'The imported file could not be merged.'}`);
        }
    };

    // --- RESIZE LOGIC ---
    const isResizingRef = useRef(false);

    const startResizing = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const startX = e.clientX;
        const startWidth = useUIStore.getState().sidePanelWidth; // Read fresh from store to be safe, though context has it

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingRef.current) return;
            const newWidth = Math.max(200, Math.min(startWidth + (e.clientX - startX), 600));
            setSidePanelWidth(newWidth);
        };

        const handleMouseUp = () => {
            isResizingRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    const startVerticalResizing = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const sidebar = e.currentTarget.closest('aside');
        if (!sidebar) return;
        const topOffsetY = sidebar.getBoundingClientRect().top;
        const totalHeight = sidebar.clientHeight;

        const handleMouseMove = (e: MouseEvent) => {
            let currentY = e.clientY - topOffsetY;
            let ratio = (currentY / totalHeight) * 100;
            // Bound the ratio between 15% and 85%
            ratio = Math.max(15, Math.min(ratio, 85));
            setTopPanelRatio(ratio);
        };

        const handleMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <NemotoPanel
            as="aside"
            className="nemoto-side-panel h-full border-r flex flex-col shrink-0 z-10 transition-none cursor-default select-none relative"
            style={{ width: sidePanelWidth }}
        >
            {/* ... (Existing Drag Proxy) ... */}
            {pluginImportPlan && <PluginImportReviewDialog plan={pluginImportPlan}
                onClose={() => setPluginImportPlan(null)} onCommit={() => {
                    usePortfolioStore.getState().commitPluginImport(pluginImportPlan);
                    setPluginImportPlan(null);
                    toast.success('Imported reviewed data');
                }} />}
            {customDragState.isDragging && (
                createPortal(
                    <div
                        className="nemoto-drag-proxy fixed pointer-events-none z-[100] flex items-center gap-2 px-3 py-2 text-xs backdrop-blur-md"
                        style={{
                            left: cursorPos.x + 10,
                            top: cursorPos.y + 10,
                        }}
                    >
                        {customDragState.itemType === 'folder' ? <FolderPlus size={14} className="text-accent-warning" /> : <FileText size={14} className="text-accent-primary" />}
                        <span className="font-medium">Moving item...</span>
                    </div>,
                    document.body
                )
            )}



            {/* RESIZE HANDLE */}
            <div
                className="nemoto-panel-resizer absolute right-0 top-0 bottom-0 w-1 hover:w-1.5 cursor-col-resize z-50 delay-75"
                onMouseDown={startResizing}
            />

            {/* PREVIEW MODAL */}
            {previewEntry && (
                <NemotoDialog
                    aria-labelledby="side-panel-preview-title"
                    onClose={() => setPreviewEntry(null)}
                    panelClassName="nemoto-modal-panel w-[500px] max-h-[80vh] flex flex-col"
                    rootClassName="z-[10050]"
                >
                        <NemotoPanelHeader className="p-4 border-b flex items-center justify-between">
                            <h3 id="side-panel-preview-title" className="font-semibold text-text-main flex items-center gap-2">
                                <FileText size={16} />
                                {previewEntry.title || previewEntry.name || 'Untitled Item'}
                            </h3>
                            <NemotoPanelIconButton aria-label="Close preview" onClick={() => setPreviewEntry(null)}>
                                <X size={16} />
                            </NemotoPanelIconButton>
                        </NemotoPanelHeader>
                        <div className="nemoto-modal-content p-0 overflow-y-auto flex-1 text-sm text-text-muted custom-scrollbar">
                            {previewEntry.content ? (
                                <div className="p-8 prose prose-invert prose-sm max-w-none prose-headings:text-text-main prose-a:text-accent-primary prose-li:my-1">
                                    {previewEntry.content.trim().startsWith('<') ? (
                                        <div
                                            className="journal-preview-content"
                                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewEntry.content || '') }}
                                        />
                                    ) : (
                                        <React.Suspense fallback={<div className="text-text-faint">Loading preview...</div>}>
                                            <MarkdownPreview content={previewEntry.content} />
                                        </React.Suspense>
                                    )}
                                </div>
                            ) : (
                                <div className="p-6 space-y-6">
                                    {/* Resource Header */}
                                    <div className="nemoto-panel-card flex items-center gap-4 p-4">
                                        <div className="w-12 h-12 rounded-lg bg-accent-primary/10 flex items-center justify-center text-accent-primary border border-accent-primary/20 shadow-glow-primary/10">
                                            {React.createElement(getIconComponent(previewEntry.type), { size: 24 })}
                                        </div>
                                        <div>
                                            <div className="text-lg font-bold text-text-main leading-tight">{previewEntry.name}</div>
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint flex items-center gap-1.5 mt-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse"></span>
                                                {previewEntry.type || 'Resource'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Metadata Grid */}
                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-faint px-1">Attributes</h4>
                                        <div className="nemoto-icon-grid grid grid-cols-2 gap-px overflow-hidden shadow-sm">
                                            <div className="nemoto-panel-section p-3">
                                                <div className="text-[9px] uppercase text-text-faint font-bold mb-1">Created</div>
                                                <div className="text-xs text-text-main">
                                                    {previewEntry.createdAt ? new Date(previewEntry.createdAt).toLocaleDateString() : 'Unknown'}
                                                </div>
                                            </div>
                                            <div className="nemoto-panel-section p-3">
                                                <div className="text-[9px] uppercase text-text-faint font-bold mb-1">Status</div>
                                                <div className="text-xs text-accent-success flex items-center gap-1.5">
                                                    <Check size={10} /> Active
                                                </div>
                                            </div>

                                            {/* Custom Metadata Render */}
                                            {Object.entries(previewEntry)
                                                .filter(([key]) => !['id', 'name', 'type', 'content', 'createdAt', 'updatedAt', 'parentId', 'icon', 'color'].includes(key))
                                                .map(([key, value]) => (
                                                    <div key={key} className="nemoto-panel-section p-3 col-span-2 border-t">
                                                        <div className="text-[9px] uppercase text-text-faint font-bold mb-1">{key}</div>
                                                        <div className="text-xs text-text-main truncate">
                                                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                                        </div>
                                                    </div>
                                                ))
                                            }
                                        </div>
                                    </div>

                                    {/* Technical Details (Toggleable/Hidden) */}
                                    <details className="group/tech">
                                        <summary className="text-[9px] font-bold uppercase tracking-widest text-text-faint/50 cursor-pointer hover:text-text-faint transition-colors list-none flex items-center gap-1">
                                            <ChevronRight size={10} className="group-open/tech:rotate-90 transition-transform" />
                                            Technical ID
                                        </summary>
                                        <div className="mt-2 text-[10px] font-mono bg-black/20 p-2 rounded text-text-faint/50 select-text">
                                            {previewEntry.id}
                                        </div>
                                    </details>

                                    {/* Mention Context Menu */}
                                    {mentionContextMenu && (
                                        <ContextMenu
                                            x={mentionContextMenu.x}
                                            y={mentionContextMenu.y}
                                            onClose={() => setMentionContextMenu(null)}
                                            items={[
                                                {
                                                    label: `Show in Dependency Map`,
                                                    icon: Network,
                                                    action: () => {
                                                        useUIStore.getState().setGravityWellFocalPoint({
                                                            id: mentionContextMenu.id,
                                                            label: mentionContextMenu.label
                                                        });
                                                        useUIStore.getState().setActiveView('dependency');
                                                        setPreviewEntry(null);
                                                    }
                                                },
                                                {
                                                    label: 'View in Inspector',
                                                    icon: Eye,
                                                    action: () => {
                                                        if (mentionContextMenu.type === 'resource') {
                                                            useUIStore.getState().selectAsset(mentionContextMenu.id);
                                                        } else if (mentionContextMenu.type === 'process') {
                                                            useProcessSessionStore.getState().setActiveProcess(mentionContextMenu.id);
                                                            // Sync Canvas for inspector preview if needed
                                                            const process = usePortfolioStore.getState().portfolio.processes.find(p => p.id === mentionContextMenu.id);
                                                            if (process) {
                                                                useCanvasStore.getState().loadGraph(process.graph);
                                                            }
                                                        }
                                                        useUIStore.getState().openInspector();
                                                        setPreviewEntry(null);
                                                    }
                                                },
                                                {
                                                    label: 'Navigate to Process',
                                                    icon: LayoutGrid,
                                                    disabled: mentionContextMenu.type === 'resource',
                                                    action: () => {
                                                        const procId = mentionContextMenu.id;
                                                        useProcessSessionStore.getState().setActiveProcess(procId);

                                                        // Sync Canvas!
                                                        const process = usePortfolioStore.getState().portfolio.processes.find(p => p.id === procId);
                                                        if (process) {
                                                            useCanvasStore.getState().loadGraph(process.graph);
                                                        }

                                                        useUIStore.getState().setActiveView('designer');
                                                        setPreviewEntry(null);
                                                    }
                                                },
                                                { separator: true },
                                                {
                                                    label: 'Copy ID',
                                                    icon: Copy,
                                                    action: () => {
                                                        navigator.clipboard.writeText(mentionContextMenu.id);
                                                        toast.success('ID copied');
                                                    }
                                                }
                                            ]}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                        <NemotoDialogFooter className="p-3 border-t flex justify-end gap-2">
                            <NemotoButton
                                size="sm"
                                variant="ghost"
                                onClick={() => setPreviewEntry(null)}
                            >
                                Close
                            </NemotoButton>
                            {previewEntry.content && (
                                <NemotoButton
                                    size="sm"
                                    variant="primary"
                                    onClick={() => {
                                        usePortfolioStore.getState().importJournalEntry(previewEntry);
                                        setPreviewEntry(null);
                                    }}
                                >
                                    Import Note
                                </NemotoButton>
                            )}
                        </NemotoDialogFooter>
                </NemotoDialog>
            )}


            {/* PART A: PROCESS PORTFOLIO */}
            <div className="nemoto-panel-section flex flex-col min-h-0 border-b overflow-hidden relative" style={{ flex: resourcesExpanded ? `${topPanelRatio} 1 0%` : '1 1 0%' }}>
                <NemotoPanelHeader
                    className="h-8 px-3 flex items-center justify-between border-b transition-colors"
                    onMouseEnter={() => {
                        if (customDragState.isDragging) {
                            setDropTargetId(undefined);
                        }
                    }}
                    onClick={() => setSelectedFolderId(undefined)} // Click header to select root
                >
                    <span className="text-[10px] font-bold uppercase text-text-muted tracking-wider">Process Portfolio</span>
                    <div className="flex gap-1 relative">
                        <IconButton icon={FolderPlus} title="New Folder" iconSize={15} onClick={(e) => { e.stopPropagation(); handleCreateFolder(); }} />
                        <NemotoPanelIconButton
                            aria-label="New process"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); openProcessCreation(); }}
                            title="New Process"
                        >
                            <FilePlus size={15} />
                        </NemotoPanelIconButton>
                    </div>
                </NemotoPanelHeader>

                {/* TREE VIEW */}
                <div
                    className="flex-1 overflow-y-auto p-1 app-scroll flex flex-col"
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    onContextMenu={(e) => e.preventDefault()} // Disable native context menu on tree bg
                >
                    <div className="space-y-0.5">
                        {/* Root Creation Row (Processes) */}
                        {creatingFolderIn === undefined && (
                            <div
                                style={{ paddingLeft: '8px' }}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-accent-primary/5 text-accent-primary mb-1"
                            >
                                <Folder size={12} className="text-accent-warning" />
                                <InlineInput
                                    value=""
                                    onCommit={(val) => {
                                        if (val) usePortfolioStore.getState().addFolder(val, undefined);
                                        setCreatingFolderIn(null);
                                    }}
                                    onCancel={() => setCreatingFolderIn(null)}
                                />
                            </div>
                        )}
                        {rootItems.length === 0 ? (
                            <div className="p-4 text-center">
                                <p className="text-xs text-text-faint">No processes yet.</p>
                                <NemotoButton
                                    size="sm"
                                    variant="ghost"
                                    onClick={openProcessCreation}
                                    className="mt-1 px-0 text-[10px] text-accent-primary"
                                >
                                    Create your first process
                                </NemotoButton>
                            </div>
                        ) : (
                            rootItems.map(item => (
                                <TreeItem
                                    key={item.data.id}
                                    item={item}
                                    level={0}
                                    activeProcessId={activeProcessId}
                                    selectedFolderId={selectedFolderId}
                                    setActiveProcess={setActiveProcess}
                                    setSelectedFolderId={setSelectedFolderId}
                                    onContextMenu={handleContextMenu}
                                    onDeleteProcess={handleDeleteProcess}
                                    onDeleteFolder={handleDeleteFolder}
                                    onMouseDown={handleMouseDown}
                                    onSetDropTarget={setDropTargetId}
                                    dropTargetId={dropTargetId}
                                    isDragging={customDragState.isDragging}
                                    draggedItemId={customDragState.itemId}
                                    onCreateFolder={(name: string, parentId?: string) => {
                                        if (name) usePortfolioStore.getState().addFolder(name, parentId);
                                    }}
                                    expansionToggle={processExpansionToggle}
                                    creatingFolderIn={creatingFolderIn}
                                    setCreatingFolderIn={setCreatingFolderIn}
                                    renamingId={renamingId}
                                    setRenamingId={setRenamingId}
                                />
                            ))
                        )}
                    </div>

                    {/* DROP ZONE */}
                    <div
                        className={`
                            flex-1 min-h-[60px] mt-2 mx-1 rounded-md border-2 border-dashed nemoto-transition-interactive
                            ${customDragState.isDragging && dropTargetId === undefined
                                ? 'border-accent-primary bg-accent-primary/10 opacity-100'
                                : 'border-transparent opacity-0'
                            }
                        `}
                        onMouseEnter={() => {
                            if (customDragState.isDragging) setDropTargetId(undefined);
                        }}
                    >
                        {customDragState.isDragging && dropTargetId === undefined && (
                            <div className="flex items-center justify-center h-full text-[10px] text-accent-primary font-medium">
                                Drop here to move to root
                            </div>
                        )}
                    </div>
                </div>

                {/* CONTEXT MENU */}
                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        onClose={() => setContextMenu(null)}
                        items={[
                            {
                                label: 'Rename',
                                icon: FileText,
                                action: () => handleContextAction('rename')
                            },
                            {
                                label: 'Duplicate',
                                icon: Copy,
                                action: () => {
                                    if (contextMenu.type === 'process') {
                                        usePortfolioStore.getState().duplicateProcess(contextMenu.id);
                                    } else if (contextMenu.type === 'resource') {
                                        usePortfolioStore.getState().duplicateAsset(contextMenu.id);
                                    }
                                }
                            },
                            {
                                label: 'Expand All',
                                icon: Maximize2,
                                action: () => {
                                    if (contextMenu.type === 'resource') {
                                        setResourceExpansionToggle(prev => ({ count: prev.count + 1, action: 'expand' }));
                                    } else {
                                        setProcessExpansionToggle(prev => ({ count: prev.count + 1, action: 'expand' }));
                                    }
                                }
                            },
                            {
                                label: 'Collapse All',
                                icon: Minimize2,
                                action: () => {
                                    if (contextMenu.type === 'resource') {
                                        setResourceExpansionToggle(prev => ({ count: prev.count + 1, action: 'collapse' }));
                                    } else {
                                        setProcessExpansionToggle(prev => ({ count: prev.count + 1, action: 'collapse' }));
                                    }
                                }
                            },
                            { separator: true },
                            // Show in Dependency Map (for processes and resources)
                            ...(contextMenu.type !== 'folder' ? [{
                                label: 'Show in Dependency Map',
                                icon: Network,
                                action: () => {
                                    // Get label for focal point
                                    let label = '';
                                    if (contextMenu.type === 'process' || contextMenu.type === 'subprocess') {
                                        const process = portfolio.processes.find(p => p.id === contextMenu.id);
                                        label = process?.title || 'Process';
                                    } else if (contextMenu.type === 'resource') {
                                        const asset = assets.find(a => a.id === contextMenu.id);
                                        label = asset?.name || 'Resource';
                                    }
                                    // Set focal point and navigate
                                    useUIStore.getState().setGravityWellFocalPoint({ id: contextMenu.id, label });
                                    useUIStore.getState().setActiveView('dependency');
                                }
                            }] : []),
                            // EXPORT (Process Only)
                            ...(contextMenu.type === 'process' ? [{
                                label: 'Export Process (.nemoto-process)',
                                icon: Import, // Using Import icon rotated or similar? Or ArrowUp. Import icon is fine if context is clear.
                                action: () => {
                                    void exportProcessWithFeedback(contextMenu.id);
                                }
                            }] : []),
                            // Copy Link
                            {
                                label: 'Copy Link',
                                icon: Copy,
                                action: () => {
                                    const link = `axiom://${contextMenu.type}/${contextMenu.id}`;
                                    navigator.clipboard.writeText(link);
                                    toast.success('Link copied to clipboard');

                                }
                            },
                            // Show Usage (for resources only)
                            ...(contextMenu.type === 'resource' && assets.find(a => a.id === contextMenu.id) ? [{
                                label: 'Show Usage',
                                icon: Eye,
                                action: () => {
                                    const asset = assets.find(a => a.id === contextMenu.id);
                                    setShowUsageResource({ id: contextMenu.id, name: asset?.name || 'Resource' });
                                }
                            }] : []),
                            { separator: true },
                            {
                                label: 'Delete',
                                icon: Trash2,
                                danger: true,
                                action: () => handleContextAction('delete')
                            }
                        ]}
                    />
                )}
            </div>

            {/* HORIZONTAL RESIZE HANDLE (for Imported panel if active) */}
            {importedPortfolios.length > 0 && (
                <div
                    className="nemoto-panel-resizer w-full h-1 hover:h-[6px] shrink-0 cursor-row-resize z-20 -my-[3px]"
                    onMouseDown={startVerticalResizing}
                />
            )}

            {/* PART A.5: IMPORTED PORTFOLIOS */}
            {importedPortfolios.length > 0 && (
                <div className="nemoto-panel-section flex flex-col min-h-0 border-b overflow-hidden relative" style={{ flex: `40 1 0%` }}>
                    <NemotoPanelHeader className="h-8 px-3 flex items-center justify-between border-b">
                        <span className="text-[10px] font-bold uppercase text-accent-primary tracking-wider">Temporary Imports</span>
                    </NemotoPanelHeader>
                    <div className="flex-1 overflow-y-auto p-0 app-scroll">
                        {importedPortfolios.map(imported => (
                            <details key={imported.id} className="group/imp" open>
                                <summary className="nemoto-panel-row flex items-center px-2 py-1.5 cursor-pointer select-none group">
                                    <ChevronRight size={12} className="mr-1.5 transition-transform group-open/imp:rotate-90 text-text-muted/50" />
                                    <span className="font-medium text-[10px] uppercase truncate flex-1">{imported.sourceName}</span>
                                </summary>
                                <div className="pl-4 pb-1 space-y-1">
                                    {/* Action Buttons for Portfolio */}
                                    <div className="flex gap-2 mb-2 pr-2">
                                        <NemotoButton
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                setConfirmDialog({
                                                    isOpen: true,
                                                    title: 'Discard Import',
                                                    message: `Remove import "${imported.sourceName}"? Imported items that were not merged will be discarded.`,
                                                    confirmLabel: 'Discard',
                                                    variant: 'warning',
                                                    onConfirm: () => removeImportedPortfolio(imported.id)
                                                });
                                            }}
                                            className="flex-1 gap-1.5 text-xs"
                                            title="Discard Import"
                                        >
                                            <X size={12} />
                                            Discard
                                        </NemotoButton>
                                        <NemotoButton
                                            size="sm"
                                            variant="primary"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                handleImportAll(imported);
                                            }}
                                            className="flex-[1.5] gap-1.5 text-xs"
                                            title="Merge supported content and review plugin reference mappings"
                                        >
                                            <Check size={12} />
                                            Merge content
                                        </NemotoButton>
                                    </div>
                                    <p className="mb-2 pr-2 text-[9px] leading-relaxed text-text-faint">
                                        Temporary references disappear when Nemoto closes. Merge supported content to keep it.
                                    </p>
                                    {/* Processes */}
                                    {(imported.data.processes || []).length > 0 && (
                                        <div className="pt-0">
                                            <div className="text-[9px] text-text-faint uppercase font-bold px-2 mb-1">Processes</div>
                                            {(imported.data.processes || []).map((p: any) => {
                                                const isSelected = selectedImports.has(p.id);
                                                return (
                                                    <div
                                                        key={p.id}
                                                        className={`nemoto-panel-row flex items-center gap-2 px-2 py-1 text-xs group/item cursor-pointer ${isSelected ? 'nemoto-panel-row-active' : ''}`}
                                                        onClick={() => useCanvasStore.getState().setPreviewGraph(p.graph)}
                                                        onMouseDown={(e) => handleImportDragStart(e, p.id, 'imported-process', imported.id)}
                                                    >
                                                        <NemotoPanelIconButton
                                                            aria-label={`${isSelected ? 'Deselect' : 'Select'} ${p.title}`}
                                                            aria-pressed={isSelected}
                                                            size="sm"
                                                            onClick={(e) => toggleImportSelection(e, p.id, 'process', p, imported)}
                                                            className={`shrink-0 ${isSelected ? 'text-accent-primary' : 'text-text-faint'}`}
                                                        >
                                                            {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                                                        </NemotoPanelIconButton>
                                                        <FileText size={12} className="shrink-0" />
                                                        <span className="truncate flex-1">{p.title}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Assets */}
                                    {(imported.data.assets || []).length > 0 && (
                                        <div className="pt-1">
                                            <div className="text-[9px] text-text-faint uppercase font-bold px-2 mb-1">Resources</div>
                                            {(imported.data.assets || []).map((a: any) => {
                                                const isSelected = selectedImports.has(a.id);
                                                return (
                                                    <div
                                                        key={a.id}
                                                        className={`nemoto-panel-row flex items-center gap-2 px-2 py-1 text-xs group/item cursor-pointer ${isSelected ? 'nemoto-panel-row-active' : ''}`}
                                                        onClick={() => setPreviewEntry(a)}
                                                        onMouseDown={(e) => handleImportDragStart(e, a.id, 'imported-asset', imported.id)}
                                                    >
                                                        <NemotoPanelIconButton
                                                            aria-label={`${isSelected ? 'Deselect' : 'Select'} ${a.name}`}
                                                            aria-pressed={isSelected}
                                                            size="sm"
                                                            onClick={(e) => toggleImportSelection(e, a.id, 'asset', a, imported)}
                                                            className={`shrink-0 ${isSelected ? 'text-accent-primary' : 'text-text-faint'}`}
                                                        >
                                                            {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                                                        </NemotoPanelIconButton>
                                                        <Box size={12} className="shrink-0" />
                                                        <span className="truncate flex-1">{a.name}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Journal */}
                                    {(imported.data.journal?.entries || []).length > 0 && (
                                        <div className="pt-1">
                                            <div className="text-[9px] text-text-faint uppercase font-bold px-2 mb-1">Journal</div>
                                            {(imported.data.journal?.entries || []).map((entry: any) => {
                                                const isSelected = selectedImports.has(entry.id);
                                                return (
                                                    <div
                                                        key={entry.id}
                                                        className={`nemoto-panel-row flex items-center gap-2 px-2 py-1 text-xs group/item cursor-pointer ${isSelected ? 'nemoto-panel-row-active' : ''}`}
                                                        onClick={() => setPreviewEntry(entry)}
                                                        onMouseDown={(e) => handleImportDragStart(e, entry.id, 'imported-journal-entry', imported.id)}
                                                    >
                                                        <NemotoPanelIconButton
                                                            aria-label={`${isSelected ? 'Deselect' : 'Select'} ${entry.title || 'Untitled Note'}`}
                                                            aria-pressed={isSelected}
                                                            size="sm"
                                                            onClick={(e) => toggleImportSelection(e, entry.id, 'journal', entry, imported)}
                                                            className={`shrink-0 ${isSelected ? 'text-accent-primary' : 'text-text-faint'}`}
                                                        >
                                                            {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                                                        </NemotoPanelIconButton>
                                                        <FileText size={12} className="shrink-0" />
                                                        <span className="truncate flex-1">{entry.title || 'Untitled Note'}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </details>
                        ))}
                    </div>

                    {/* Bulk Actions Floating Bar */}
                    {selectedImports.size > 0 && (
                        <div className="nemoto-panel-bulk-bar p-2 border-t backdrop-blur-sm nemoto-motion-feedback-bottom">
                            <NemotoButton
                                size="sm"
                                variant="primary"
                                onClick={handleImportSelected}
                                className="w-full gap-2"
                            >
                                <DownloadCloud size={12} />
                                Import Selected ({selectedImports.size})
                            </NemotoButton>
                        </div>
                    )}
                </div>
            )}

            {/* HORIZONTAL RESIZE HANDLE (for Resources panel) */}
            {resourcesExpanded && (
                <div
                    className="nemoto-panel-resizer w-full h-1 hover:h-[6px] shrink-0 cursor-row-resize z-20 -my-[3px] relative"
                    onMouseDown={startVerticalResizing}
                />
            )}

            {/* PART B: RESOURCE LIBRARY */}
            <div className="nemoto-panel-section flex flex-col min-h-0 relative overflow-hidden" style={resourcesExpanded ? { flex: `${100 - topPanelRatio} 1 0%` } : { flex: '0 0 auto' }}>
                <NemotoPanelHeader
                    className="h-9 px-3 flex items-center justify-between border-b shadow-sm z-10 cursor-pointer transition-colors"
                    onClick={() => setResourcesExpanded((expanded) => !expanded)}
                    title={resourcesExpanded ? "Collapse resources" : "Expand resources"}
                >
                    <button type="button" className="nemoto-text-button min-w-0 flex items-center gap-2 rounded-sm"
                        aria-label="Resources" aria-expanded={resourcesExpanded}
                        onClick={(event) => { event.stopPropagation(); setResourcesExpanded(expanded => !expanded); }}>
                        <ChevronRight size={12} className={`text-text-faint transition-transform ${resourcesExpanded ? 'rotate-90' : ''}`} />
                        <span className="text-[10px] font-bold uppercase text-text-muted tracking-wider">Resources</span>
                        <span className="text-[9px] text-text-faint">{assets.length}</span>
                    </button>
                    <div className="flex gap-1 relative">
                        <NemotoPanelIconButton
                            aria-label="Open Portfolio"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setResourcePowerViewOpen(true); }}
                            title="Open Portfolio"
                        >
                            <Server size={12} />
                        </NemotoPanelIconButton>
                        <NemotoPanelDivider orientation="vertical" className="h-3 mx-1 self-center" />
                        <NemotoPanelIconButton
                            aria-label="Manage Categories"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setManageCategoriesOpen(true); }}
                            title="Manage Categories"
                        >
                            <Settings2 size={12} />
                        </NemotoPanelIconButton>
                        <NemotoPanelDivider orientation="vertical" className="h-3 mx-1 self-center" />
                        <NemotoPanelIconButton
                            aria-label="Quick Create Resource"
                            size="sm"
                            ref={popoverTriggerRef}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!resourcesExpanded) setResourcesExpanded(true);
                                setCreationPopoverOpen((open) => !open);
                            }}
                            className={creationPopoverOpen ? 'text-accent-primary' : undefined}
                            title="Quick Create Resource"
                        >
                            <Plus size={12} />
                        </NemotoPanelIconButton>

                        {/* Quick Create Popover */}
                        {creationPopoverOpen && (
                            <div
                                className="nemoto-popover absolute top-8 right-0 w-[220px] p-3 z-50 flex flex-col gap-3 nemoto-motion-popover"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div>
                                    <label className="text-[9px] uppercase text-text-muted font-bold block mb-1">Category</label>
                                    <div className="relative">
                                        <NemotoSelect
                                            autoFocus
                                            controlSize="sm"
                                            value={newItemCategory}
                                            aria-label="Category"
                                            onChange={(e) => setNewItemCategory(e.target.value)}
                                            className="w-full appearance-none cursor-pointer"
                                        >
                                            {portfolio.assetCategories?.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.label}</option>
                                            ))}
                                        </NemotoSelect>
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
                                            <ChevronRight size={10} className="rotate-90" />
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[9px] uppercase text-text-muted font-bold block mb-1">Resource Name</label>
                                    <NemotoInput
                                        type="text"
                                        controlSize="sm"
                                        className="w-full placeholder:text-text-faint"
                                        placeholder="e.g. Laptop-001..."
                                        value={newItemName}
                                        aria-label="Resource Name"
                                        onChange={(e) => setNewItemName(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                </div>
                                <div className="flex justify-end pt-1">
                                    <NemotoButton
                                        size="sm"
                                        variant="primary"
                                        onClick={handleQuickCreate}
                                        disabled={!newItemName.trim() || !newItemCategory}
                                    >
                                        Create Resource
                                    </NemotoButton>
                                </div>
                            </div>
                        )}
                    </div>
                </NemotoPanelHeader>

                {resourcesExpanded && (
                <div className="flex-1 overflow-y-auto p-0 app-scroll">
                    {groupedResources.length === 0 && (
                        <div className="p-4 text-center">
                            <p className="text-xs text-text-faint">No resources found.</p>
                            <NemotoButton size="sm" variant="ghost" onClick={() => setCreationPopoverOpen(true)} className="mt-1 text-accent-primary">Create your first resource</NemotoButton>
                        </div>
                    )}

                    {groupedResources.map(cat => {
                        const Icon = getIconComponent(cat.icon);
                        const colorHex = getPaletteColor(cat.color);
                        const isExpanded = resourceExpansionToggle.action === 'expand';

                        return (
                            <details key={`${cat.id}-${resourceExpansionToggle.count}`} open={isExpanded} className="group/cat">
                                <summary
                                    className="nemoto-panel-row nemoto-panel-row-border flex items-center px-2 py-1.5 cursor-pointer select-none first:border-t-0"
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setContextMenu({
                                            x: e.clientX,
                                            y: e.clientY,
                                            type: 'resource', // We'll repurpose the type or add a new one if needed
                                            id: cat.id
                                        });
                                    }}
                                >
                                    <ChevronRight size={12} className="mr-1.5 transition-transform group-open/cat:rotate-90 text-text-muted/50" />
                                    <Icon size={12} className="mr-2" style={{ color: colorHex }} />
                                    <span className="font-medium text-[10px] uppercase tracking-wide">{cat.label}</span>
                                    <span className="ml-auto text-[9px] text-text-faint opacity-0 group-hover/cat:opacity-100 transition-opacity">{cat.items.length}</span>
                                </summary>

                                <div className="pl-0 pb-1.5 space-y-[1px]">
                                    {cat.items.map(asset => (
                                        <div
                                            key={asset.id}
                                            onClick={() => selectAsset(asset.id)}
                                            onMouseDown={(e) => {
                                                if (e.button === 0 && !e.shiftKey) {
                                                    const startX = e.clientX;
                                                    const startY = e.clientY;
                                                    const currentTarget = e.currentTarget;
                                                    let dragStarted = false;

                                                    const assetData = {
                                                        id: asset.id,
                                                        name: asset.name,
                                                        type: asset.type,
                                                        meta: asset.type
                                                    };

                                                    const handleMouseMove = (moveEvent: MouseEvent) => {
                                                        const dx = moveEvent.clientX - startX;
                                                        const dy = moveEvent.clientY - startY;
                                                        if (!dragStarted && Math.sqrt(dx * dx + dy * dy) > 5) {
                                                            dragStarted = true;
                                                            currentTarget.addEventListener('click', (ev) => ev.stopPropagation(), { once: true, capture: true });
                                                            useUIStore.getState().setDraggedAsset(assetData);
                                                            useUIStore.getState().setDraggedEntity(assetData);
                                                            document.body.style.cursor = 'grabbing';
                                                        }
                                                    };

                                                    const handleMouseUp = () => {
                                                        window.removeEventListener('mousemove', handleMouseMove);
                                                        window.removeEventListener('mouseup', handleMouseUp);
                                                    };

                                                    window.addEventListener('mousemove', handleMouseMove);
                                                    window.addEventListener('mouseup', handleMouseUp);
                                                }
                                            }}
                                            onContextMenu={(e) => handleContextMenu(e, 'resource', asset.id)}
                                            className={`
                                                nemoto-panel-row nemoto-resource-row flex items-center px-2 py-0.5 cursor-grab active:cursor-grabbing border-l-2 border-transparent group/row relative nemoto-transition-interactive
                                                ${selectedAssetId === asset.id ? 'nemoto-panel-row-selected border-l-accent-primary' : 'hover:border-l-accent-warning'}
                                            `}
                                        >
                                            <div className="nemoto-panel-row-handle absolute left-1 top-1/2 -translate-y-1/2 opacity-0 -translate-x-1 group-hover/row:opacity-100 group-hover/row:translate-x-0 transition-[opacity,transform] nemoto-transition-fast">
                                                <GripVertical size={12} />
                                            </div>
                                            <div className="pl-4 flex-1 flex flex-col">
                                                {renamingId === asset.id ? (
                                                    <InlineInput
                                                        value={asset.name}
                                                        onCommit={(newName) => {
                                                            if (newName && newName !== asset.name) {
                                                                usePortfolioStore.getState().updateAsset(asset.id, { name: newName });
                                                            }
                                                            setRenamingId(null);
                                                        }}
                                                        onCancel={() => setRenamingId(null)}
                                                    />
                                                ) : (
                                                    <button type="button" className="nemoto-text-button nemoto-row-title text-xs truncate text-left rounded-sm"
                                                        aria-pressed={selectedAssetId === asset.id}
                                                        onKeyDown={(event) => {
                                                            if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
                                                            const bounds = event.currentTarget.getBoundingClientRect();
                                                            handleContextMenu({
                                                                preventDefault: () => event.preventDefault(),
                                                                stopPropagation: () => event.stopPropagation(),
                                                                clientX: bounds.left,
                                                                clientY: bounds.bottom,
                                                            }, 'resource', asset.id);
                                                        }}
                                                    >{asset.name}</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )
                    })}
                </div>
                )}
            </div>

            {/* CATEGORY MANAGER MODAL */}
            {manageCategoriesOpen && createPortal(
                <CategoryManager onClose={() => setManageCategoriesOpen(false)} />,
                document.body
            )}

            <TemplateSelectionModal
                isOpen={processCreationOpen}
                onClose={closeProcessCreation}
                onCreate={handleCreateProcess}
                folderName={selectedFolderName}
            />

            {showUsageResource && (
                <ShowUsageModal
                    resourceId={showUsageResource.id}
                    resourceName={showUsageResource.name}
                    onClose={() => setShowUsageResource(null)}
                />
            )}

            {confirmDialog && (
                <ConfirmationModal
                    isOpen={confirmDialog.isOpen}
                    onClose={() => setConfirmDialog(null)}
                    onConfirm={confirmDialog.onConfirm}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmLabel={confirmDialog.confirmLabel}
                    variant={confirmDialog.variant}
                />
            )}

        </NemotoPanel>
    );
}

// --- TREE COMPONENT ---

function TreeItem({
    item,
    level,
    activeProcessId,
    selectedFolderId,
    setActiveProcess,
    setSelectedFolderId,
    onDeleteProcess,
    onDeleteFolder,
    onContextMenu, // NEW prop
    onMouseDown,
    onSetDropTarget,
    dropTargetId,
    isDragging,
    draggedItemId,
    onCreateFolder,
    expansionToggle,
    creatingFolderIn,
    setCreatingFolderIn,
    renamingId,
    setRenamingId
}: any) {
    // Local expansion state for folders AND processes with children
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (expansionToggle?.count > 0) {
            setExpanded(expansionToggle.action === 'expand');
        }
    }, [expansionToggle]);

    const hasChildren = item.children && item.children.length > 0;

    const isFolder = item.type === 'folder';
    const isSubprocess = item.type === 'subprocess';
    const isProcess = item.type === 'process';

    const isActive =
        (isProcess && item.data.id === activeProcessId) ||
        (isFolder && item.data.id === selectedFolderId);

    const isDropTarget = isFolder && dropTargetId === item.data.id;
    const isBeingDragged = item.data.id === draggedItemId;

    const handleArrowClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    }

    const handleClick = () => {
        if (isDragging) return;

        if (isFolder) {
            setExpanded(!expanded); // Folders toggle on main click too
            setSelectedFolderId(item.data.id);
        } else if (isSubprocess) {
            if (item.data.cyclic) {
                toast.error('This drilldown contains a cyclic link. Delete it to repair the process tree.');
                return;
            }

            // DRILLDOWN NAV
            console.log('[Tree] Navigating to drilldown:', item.data.title);

            // 1. Activate parent process
            setActiveProcess(item.data.processId);

            // 2. Set breadcrumb stack
            const stack = item.data.breadcrumbPath;
            useProcessSessionStore.getState().setBreadcrumbStack(stack);

            // 3. LOAD THE GRAPH!
            // We need to traverse from the top-level process graph down to this node
            const process = usePortfolioStore.getState().portfolio.processes.find(p => p.id === item.data.processId);
            if (process) {
                let currentGraph = process.graph;
                const visitedSubGraphs = new Set<string>();
                // Traverse stack to find correct graph
                // stack contains [topNodeId, subNodeId, ...]
                // Actually, the stack in breadcrumbPath ends with the TARGET node ID
                for (const nodeId of stack) {
                    const node = currentGraph.nodes.find(n => n.id === nodeId);
                    const childGraphId = node?.subGraphId;
                    const childGraph = childGraphId && process.subGraphs?.[childGraphId];
                    if (!childGraphId || !childGraph || visitedSubGraphs.has(childGraphId)) {
                        toast.error('This drilldown path is invalid or cyclic');
                        return;
                    }
                    visitedSubGraphs.add(childGraphId);
                    currentGraph = childGraph;
                }
                // Set this graph as active
                useCanvasStore.getState().loadGraph(currentGraph);
            }

        } else if (isProcess) {
            setActiveProcess(item.data.id);
            useProcessSessionStore.getState().setBreadcrumbStack([]);
            // Also load the graph (usually handled by setActiveProcess effect but let's be sure)
            const process = usePortfolioStore.getState().portfolio.processes.find(p => p.id === item.data.id);
            if (process) {
                useCanvasStore.getState().loadGraph(process.graph);
            }
        }
    };

    const handleRenameCommit = (newName: string) => {
        if (newName && newName !== item.data.title) {
            const { updateProcess, updateFolder } = usePortfolioStore.getState();
            if (isProcess) updateProcess(item.data.id, { title: newName });
            if (isFolder) updateFolder(item.data.id, { title: newName });
            if (isSubprocess) {
                const store = usePortfolioStore.getState();
                const process = store.portfolio.processes.find(candidate => candidate.id === item.data.processId);
                const renamed = process
                    ? renameDrilldownNodeAtPath(process, item.data.breadcrumbPath, newName)
                    : null;
                if (renamed) {
                    store.updateProcess(renamed.id, {
                        graph: renamed.graph,
                        subGraphs: renamed.subGraphs,
                    });
                }
            }
        }
        setRenamingId(null);
    };

    return (
        <div className="select-none">
            <div
                className={`
                    nemoto-panel-row flex items-center py-1.5 px-2 cursor-pointer text-xs font-medium group relative
                    ${isBeingDragged ? 'opacity-40' : ''}
                    ${isActive
                        ? 'nemoto-panel-row-selected'
                        : isDropTarget
                            ? 'nemoto-panel-row-active ring-1 ring-inset ring-accent-primary'
                            : ''
                    }
                `}
                style={{ paddingLeft: `${(level * 12) + 8}px` }}
                onClick={handleClick}
                onContextMenu={(e) => onContextMenu && onContextMenu(
                    e,
                    item.type,
                    item.data.id,
                    item.type === 'subprocess' ? item.data.processId : item.data.parentId,
                    item.type === 'subprocess' ? item.data.breadcrumbPath : undefined,
                    item.type === 'subprocess' ? item.data.cyclic : undefined,
                )}
                onMouseDown={(e) => {
                    // Don't start drag if clicking on arrow or buttons
                    if ((e.target as HTMLElement).closest('.interaction-btn')) return;
                    if (isSubprocess) return; // Cannot drag subprocesses logic yet
                    onMouseDown(e, item.data.id, item.type);
                }}
                onMouseEnter={() => {
                    if (isDragging && isFolder) onSetDropTarget(item.data.id);
                }}
            >
                {/* Expand Arrow - Only for folders or items with children */}
                {(isFolder || hasChildren) ? (
                    <NemotoPanelIconButton
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.data.title}`}
                        size="sm"
                        className={`mr-1 interaction-btn ${expanded ? 'rotate-90' : ''}`}
                        onClick={handleArrowClick}
                    >
                        <ChevronRight size={10} className="opacity-70" />
                    </NemotoPanelIconButton>
                ) : (
                    <div className="w-[14px] mr-1" /> // Spacer
                )}

                {/* Icon */}
                <span className={`mr-2 ${isActive ? 'text-accent-primary' : 'opacity-70'}`}>
                    {isFolder ? (
                        expanded ? <FolderOpen size={12} className="text-accent-warning" /> : <Folder size={12} className="text-accent-warning" />
                    ) : isSubprocess ? (
                        <Server size={12} />
                    ) : (
                        <LayoutGrid size={12} />
                    )}
                </span>

                {renamingId === item.data.id ? (
                    <InlineInput
                        value={item.data.title}
                        onCommit={handleRenameCommit}
                        onCancel={() => setRenamingId(null)}
                    />
                ) : (
                    <button
                        type="button"
                        className="nemoto-text-button truncate flex-1 min-w-0 text-left rounded-sm"
                        aria-current={isActive && !isFolder ? 'page' : undefined}
                        aria-expanded={isFolder ? expanded : undefined}
                        onClick={(event) => { event.stopPropagation(); handleClick(); }}
                        onKeyDown={(event) => {
                            if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
                            if (!onContextMenu) return;
                            const bounds = event.currentTarget.getBoundingClientRect();
                            onContextMenu({
                                preventDefault: () => event.preventDefault(),
                                stopPropagation: () => event.stopPropagation(),
                                clientX: bounds.left,
                                clientY: bounds.bottom,
                            }, item.type, item.data.id,
                            item.type === 'subprocess' ? item.data.processId : item.data.parentId,
                            item.type === 'subprocess' ? item.data.breadcrumbPath : undefined,
                            item.type === 'subprocess' ? item.data.cyclic : undefined);
                        }}
                    >{item.data.title}</button>
                )}

                {/* Hover Actions (Folder only mostly) */}
                {isFolder && (
                    <NemotoPanelIconButton
                        aria-label={`Add folder inside ${item.data.title}`}
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 interaction-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCreateFolder(item.data.id);
                        }}
                    >
                        <Plus size={10} />
                    </NemotoPanelIconButton>
                )}
            </div>

            {/* Inline Creation Row */}
            {creatingFolderIn === item.data.id && (
                <div
                    style={{ paddingLeft: `${((level + 1) * 12) + 8}px` }}
                    className="nemoto-panel-row nemoto-panel-row-active flex items-center gap-2 px-2 py-1.5"
                >
                    <Folder size={12} className="text-accent-warning" />
                    <InlineInput
                        value=""
                        onCommit={(val) => {
                            if (val) onCreateFolder(val, item.data.id);
                            setCreatingFolderIn(null);
                        }}
                        onCancel={() => setCreatingFolderIn(null)}
                    />
                </div>
            )}

            {/* Recursion */}
            {expanded && hasChildren && (
                <div>
                    {item.children.map((child: any) => (
                        <TreeItem
                            key={child.data.id}
                            item={child}
                            level={level + 1}
                            activeProcessId={activeProcessId}
                            selectedFolderId={selectedFolderId}
                            setActiveProcess={setActiveProcess}
                            setSelectedFolderId={setSelectedFolderId}
                            onContextMenu={onContextMenu}
                            onDeleteProcess={onDeleteProcess} // Keep for safety
                            onDeleteFolder={onDeleteFolder}
                            onMouseDown={onMouseDown}
                            onSetDropTarget={onSetDropTarget}
                            dropTargetId={dropTargetId}
                            isDragging={isDragging}
                            draggedItemId={draggedItemId}
                            onCreateFolder={onCreateFolder}
                            expansionToggle={expansionToggle}
                            creatingFolderIn={creatingFolderIn}
                            setCreatingFolderIn={setCreatingFolderIn}
                            renamingId={renamingId}
                            setRenamingId={setRenamingId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function IconButton({ icon: Icon, title, iconSize = 12, onClick }: { icon: any, title: string, iconSize?: number, onClick?: (e: React.MouseEvent) => void }) {
    return (
        <NemotoPanelIconButton aria-label={title} size="sm" onClick={onClick} title={title}>
            <Icon size={iconSize} />
        </NemotoPanelIconButton>
    )
}

function CategoryManager({ onClose }: { onClose: () => void }) {
    const { portfolio, addAssetCategory, updateAssetCategory, deleteAssetCategory } = usePortfolioStore();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<AssetCategory>>({});

    const handleEdit = (cat: AssetCategory) => {
        setEditingId(cat.id);
        setFormData(cat);
    };

    const handleCreate = () => {
        const newCat: AssetCategory = {
            id: generateId('cat'),
            label: 'New Category',
            icon: 'Box',
            color: 'gray'
        };
        addAssetCategory(newCat);
        handleEdit(newCat);
    };

    const handleSave = () => {
        if (editingId && formData.label) {
            updateAssetCategory(editingId, formData);
            setEditingId(null);
        }
    };

    const handleDelete = (id: string) => {
        setDeleteConfirmId(id);
    };

    // Search state for icons
    const [iconSearch, setIconSearch] = useState('');
    const [searchIcons, setSearchIcons] = useState<
        typeof import('../../lib/iconSearch').searchIcons | null
    >(null);

    useEffect(() => {
        let cancelled = false;

        void import('../../lib/iconSearch').then(module => {
            if (!cancelled) setSearchIcons(() => module.searchIcons);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    // Dynamically get all valid Lucide icons for the picker using the 'icons' export
    const iconNames = useMemo(() => {
        return Object.keys(icons).filter(key => {
            // Must start with Uppercase (React component)
            if (!/^[A-Z]/.test(key)) return false;
            return true;
        });
    }, []);

    // Filter by search
    const filteredIconNames = useMemo(() => {
        if (!iconSearch.trim()) return iconNames; // Only show all if no search? Actually, maybe show all (virtualized or limited)
        if (!searchIcons) return [];
        return searchIcons(iconSearch, iconNames, 50);
    }, [iconNames, iconSearch, searchIcons]);

    // To prevent rendering 1000 icons at once and lagging the modal, limit to top 150 unless searched
    const displayIcons = iconSearch.trim() ? filteredIconNames : filteredIconNames.slice(0, 150);

    return (
        <NemotoDialog
            aria-labelledby="category-manager-title"
            onClose={onClose}
            panelClassName="nemoto-category-manager nemoto-modal-panel w-[600px] h-[580px] flex overflow-hidden"
        >
                {/* LIST */}
                <div className="nemoto-category-sidebar nemoto-modal-sidebar w-[200px] border-r flex flex-col">
                    <NemotoPanelHeader className="nemoto-category-sidebar-header p-3 border-b flex justify-between items-center">
                        <span id="category-manager-title" className="text-xs font-bold text-text-muted uppercase">Categories</span>
                        <NemotoPanelIconButton aria-label="Create category" size="sm" onClick={handleCreate} className="nemoto-category-create text-accent-success">
                            <Plus size={14} />
                        </NemotoPanelIconButton>
                    </NemotoPanelHeader>
                    <div className="nemoto-category-list flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                        {portfolio.assetCategories?.map(cat => {
                            const Icon = getIconComponent(cat.icon);
                            return (
                                <NemotoPanelRowButton
                                    key={cat.id}
                                    active={editingId === cat.id}
                                    onClick={() => handleEdit(cat)}
                                    className="nemoto-category-row flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
                                >
                                    <span
                                        className="nemoto-category-icon-chip"
                                        style={{ '--category-color': getPaletteColor(cat.color) } as React.CSSProperties}
                                    >
                                        <Icon size={12} />
                                    </span>
                                    <span className="nemoto-category-label truncate">{cat.label}</span>
                                </NemotoPanelRowButton>
                            )
                        })}
                    </div>
                </div>

                {/* EDITOR */}
                <div className="nemoto-modal-content flex-1 flex flex-col">
                    <NemotoPanelHeader className="h-10 border-b flex items-center justify-between px-4">
                        <span className="text-xs font-bold text-text-main">
                            {editingId ? 'Edit Category' : 'Select a category'}
                        </span>
                        <NemotoPanelIconButton aria-label="Close category manager" size="sm" onClick={onClose}><X size={14} /></NemotoPanelIconButton>
                    </NemotoPanelHeader>

                    {editingId ? (
                        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                            <div className="space-y-6">
                                {/* Label Input */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-text-muted">Category Name</label>
                                    <NemotoInput
                                        type="text"
                                        controlSize="sm"
                                        value={formData.label || ''}
                                        onChange={e => setFormData({ ...formData, label: e.target.value })}
                                        className="w-full text-sm"
                                    />
                                </div>

                                {/* Color Picker */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-text-muted">Color Tag</label>
                                    <div className="flex flex-wrap gap-2">
                                        {PALETTE.map(c => (
                                            <NemotoColorSwatch
                                                aria-label={`Use ${c.label} color`}
                                                selected={formData.color === c.id}
                                                key={c.id}
                                                onClick={() => setFormData({ ...formData, color: c.id })}
                                                className="w-6 h-6 rounded-full"
                                                style={{ backgroundColor: c.hex }}
                                                title={c.label}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {/* Icon Picker */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium text-text-muted">Icon</label>
                                        <div className="relative">
                                            <SearchIcon
                                                size={12}
                                                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
                                                aria-hidden="true"
                                            />
                                            <NemotoInput
                                                type="search"
                                                aria-label="Search category icons"
                                                controlSize="xs"
                                                placeholder="Search icons..."
                                                value={iconSearch}
                                                onChange={e => setIconSearch(e.target.value)}
                                                className="nemoto-field-leading-icon w-40 rounded-full"
                                            />
                                        </div>
                                    </div>

                                    <div className="nemoto-icon-grid grid grid-cols-6 gap-2 p-3 h-[200px] overflow-y-auto custom-scrollbar">
                                        {/* Ensure the currently selected icon is ALWAYS in the list, even if it's past the 150 limit */}
                                        {formData.icon && !displayIcons.includes(formData.icon) && !iconSearch && (
                                            <NemotoIconTile
                                                aria-label={`Use ${formData.icon} icon`}
                                                selected
                                                key={`selected-${formData.icon}`}
                                                onClick={() => setFormData({ ...formData, icon: formData.icon })}
                                                className="flex flex-col items-center justify-center gap-1 p-2"
                                                title={formData.icon}
                                            >
                                                {(() => {
                                                    const Icon = getIconComponent(formData.icon);
                                                    return <Icon size={16} />;
                                                })()}
                                            </NemotoIconTile>
                                        )}

                                        {displayIcons.map(name => {
                                            const Icon = getIconComponent(name);
                                            const isSelected = formData.icon === name;
                                            return (
                                                <NemotoIconTile
                                                    aria-label={`Use ${name} icon`}
                                                    selected={isSelected}
                                                    key={name}
                                                    onClick={() => setFormData({ ...formData, icon: name })}
                                                    className="flex flex-col items-center justify-center gap-1 p-2"
                                                    title={name}
                                                >
                                                    <Icon size={16} />
                                                </NemotoIconTile>
                                            )
                                        })}

                                        {!iconSearch && iconNames.length > 150 && (
                                            <div className="col-span-6 text-center text-[10px] text-text-faint italic py-2">
                                                Showing 150 of {iconNames.length} icons. Search to find more.
                                            </div>
                                        )}
                                        {iconSearch && searchIcons && displayIcons.length === 0 && (
                                            <div className="col-span-6 text-center text-[10px] text-text-faint italic py-2">
                                                No icons found matching "{iconSearch}"
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-text-faint text-xs">
                            Select or create a category to edit
                        </div>
                    )}

                    {/* Footer Actions */}
                    {editingId && (
                        <NemotoDialogFooter className="p-4 border-t flex justify-between">
                            <NemotoButton
                                size="sm"
                                variant="danger"
                                onClick={() => handleDelete(editingId)}
                                className="gap-2"
                            >
                                <Trash2 size={12} /> Delete
                            </NemotoButton>
                            <NemotoButton
                                size="sm"
                                variant="primary"
                                onClick={handleSave}
                                className="gap-2 px-6"
                            >
                                <Check size={12} /> Save Changes
                            </NemotoButton>
                        </NemotoDialogFooter>
                    )}
                </div>
            <ConfirmationModal
                isOpen={Boolean(deleteConfirmId)}
                onClose={() => setDeleteConfirmId(null)}
                onConfirm={() => {
                    if (!deleteConfirmId) return;
                    deleteAssetCategory(deleteConfirmId);
                    if (editingId === deleteConfirmId) setEditingId(null);
                }}
                title="Delete Category"
                message="Delete this category? Its resources will move to Uncategorized."
                confirmLabel="Delete"
                variant="danger"
            />
        </NemotoDialog>
    );
}
