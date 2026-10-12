import { lazy, Suspense, useState, useEffect, memo, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ChevronsUp, Plus, Book, BookPlus, FileText, FolderPlus, GripHorizontal, GripVertical, Trash2, FolderInput, Edit2, Maximize2, Minimize2, PanelBottom, PanelLeft, Search, X } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useJournalStore } from '../../stores/useJournalStore';
import { filterJournalEntries } from '../../lib/journalLibrarySearch';
import TagSelector from './TagSelector';
import LinkedEntitiesSection from '../shared/LinkedEntitiesSection';
import EntityPickerModal from '../shared/EntityPickerModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import JournalSharingControl from './JournalSharingControl';
import {
    NemotoButton,
    NemotoInput,
    NemotoMenu,
    NemotoMenuDivider,
    NemotoMenuItem,
    NemotoPanelIconButton,
} from '../ui';

const TipTapEditor = lazy(() => import('./TipTapEditor'));

interface JournalPanelProps {
    dock?: 'bottom' | 'left';
    sideDockAvailable?: boolean;
}

// ---------------------------------------------------------------------------
// Pointer-based Drag-and-Drop
// ---------------------------------------------------------------------------
// Tauri v2 / WebView2 on Windows does not correctly propagate dropEffect back
// to the Windows Shell OLE sink, so the native HTML5 DnD API always shows the
// forbidden cursor for same-window intra-app drags.
//
// This hook replaces HTML5 DnD with a pointer-capture system:
//   - onPointerDown  → capture pointer, record dragged item
//   - pointermove    → move ghost, hit-test with elementFromPoint
//   - pointerup      → resolve drop target, call the appropriate move action
//
// Drop targets expose three data attributes on their DOM nodes:
//   data-drop-target="true"
//   data-item-id="<id>"
//   data-item-type="folder|notebook|entry|root"
//
// Drag sources expose two data attributes:
//   data-drag-id="<id>"
//   data-drag-type="folder|notebook|journalEntry"
// ---------------------------------------------------------------------------

const DRAG_THRESHOLD = 6; // px before drag activates

interface DragState {
    id: string;
    type: string;
    label: string;
    startX: number;
    startY: number;
    active: boolean;
    pointerId: number;
    sourceEl: HTMLElement;
}

interface DropInfo {
    itemId: string;
    itemType: string;
}

function createGhost(label: string, type: string): HTMLDivElement {
    const ghost = document.createElement('div');
    ghost.id = '__journal-drag-ghost__';
    ghost.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:9998',
        'padding:4px 10px',
        'border-radius:3px',
        'font-size:11px',
        'font-weight:600',
        'white-space:nowrap',
        'background:var(--color-app-surface)',
        'border:1px solid var(--color-accent-warning)',
        'color:var(--color-accent-warning)',
        'box-shadow:var(--app-shadow-lg)',
        'opacity:0',
        'transition:opacity 80ms',
        'user-select:none',
    ].join(';');

    const icon = type === 'journalEntry' ? '📄' : type === 'folder' ? '📁' : '📓';
    ghost.textContent = `${icon} ${label}`;
    document.body.appendChild(ghost);
    requestAnimationFrame(() => { ghost.style.opacity = '1'; });
    return ghost;
}

function removeGhost() {
    const el = document.getElementById('__journal-drag-ghost__');
    if (el) el.remove();
}

function findDropTarget(x: number, y: number, ghostEl: HTMLElement | null): DropInfo | null {
    // Temporarily hide ghost so elementFromPoint can see through it
    if (ghostEl) ghostEl.style.display = 'none';
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (ghostEl) ghostEl.style.display = '';

    if (!el) return null;

    // Walk up the DOM to find the nearest element with data-drop-target
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
        if (node.dataset.dropTarget === 'true') {
            return {
                itemId: node.dataset.itemId || '',
                itemType: node.dataset.itemType || '',
            };
        }
        node = node.parentElement;
    }
    return null;
}

function highlightDropTarget(info: DropInfo | null, prevId: string | null): void {
    // Remove highlight from previous
    if (prevId) {
        const prev = document.querySelector(`[data-item-id="${prevId}"][data-drop-target="true"]`) as HTMLElement | null;
        if (prev) {
            prev.style.outline = '';
            prev.style.background = '';
        }
    }
    if (info) {
        const next = document.querySelector(`[data-item-id="${info.itemId}"][data-drop-target="true"]`) as HTMLElement | null;
        if (next) {
            next.style.outline = '1px solid color-mix(in srgb, var(--color-accent-warning) 70%, transparent)';
            next.style.background = 'color-mix(in srgb, var(--color-accent-warning) 8%, transparent)';
        }
    }
}

/**
 * useJournalDrag
 *
 * Returns an `onPointerDown` handler to attach to any draggable element.
 * The element must have data-drag-id and data-drag-type attributes.
 * The element must also have data-drag-label for the ghost text (optional, falls back to id).
 */
function useJournalDrag(
    onMoveItem: (itemId: string, itemType: string, targetFolderId: string | undefined) => void,
    onMoveEntry: (entryId: string, targetNotebookId: string) => void,
) {
    const dragRef = useRef<DragState | null>(null);
    const currentDropRef = useRef<DropInfo | null>(null);
    const ghostRef = useRef<HTMLDivElement | null>(null);

    const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
        // Only left-button, skip inputs/buttons/anchors
        if (e.button !== 0) return;
        const nativeTarget = e.target as HTMLElement;
        const tag = nativeTarget.tagName;
        if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA') return;

        const target = e.currentTarget as HTMLElement;
        const dragId = target.dataset.dragId;
        const dragType = target.dataset.dragType;
        if (!dragId || !dragType) return;

        // Do NOT preventDefault here — that would swallow click events.
        // We capture silently and only activate after the threshold is crossed.

        dragRef.current = {
            id: dragId,
            type: dragType,
            label: target.dataset.dragLabel || dragId,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            pointerId: e.pointerId,
            sourceEl: target,
        };

        target.setPointerCapture(e.pointerId);
    };

    useEffect(() => {
        const onPointerMove = (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;

            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;

            if (!drag.active) {
                if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
                // Activate drag — suppress the click that would fire on pointerup
                drag.active = true;
                drag.sourceEl.addEventListener('click', (ev) => ev.stopPropagation(), { once: true, capture: true });
                drag.sourceEl.style.opacity = '0.4';
                document.body.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';
                ghostRef.current = createGhost(drag.label, drag.type);

                // Register draggedEntity in UIStore for any listeners
                useUIStore.getState().setDraggedEntity({
                    id: drag.id,
                    type: drag.type,
                    name: drag.label,
                    meta: '',
                });
            }

            // Move ghost
            const ghost = ghostRef.current;
            if (ghost) {
                ghost.style.left = `${e.clientX + 14}px`;
                ghost.style.top = `${e.clientY - 10}px`;
            }

            // Hit-test drop target
            const prevDrop = currentDropRef.current;
            const newDrop = findDropTarget(e.clientX, e.clientY, ghost);
            currentDropRef.current = newDrop;

            const prevId = prevDrop?.itemId ?? null;
            const newId = newDrop?.itemId ?? null;
            if (prevId !== newId) {
                highlightDropTarget(newDrop, prevId);
            }
        };

        const onPointerUp = (_e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;

            // Clean up regardless
            drag.sourceEl.releasePointerCapture(drag.pointerId);
            drag.sourceEl.style.opacity = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            removeGhost();
            ghostRef.current = null;

            useUIStore.getState().setDraggedEntity(null);

            const drop = currentDropRef.current;

            // Clear highlight
            if (drop) {
                highlightDropTarget(null, drop.itemId);
            }
            currentDropRef.current = null;
            dragRef.current = null;

            if (!drag.active || !drop) return;

            // --- Resolve Drop ---
            const { id: draggedId, type: draggedType } = drag;
            const { itemId: targetId, itemType: targetType } = drop;

            // Don't drop on self
            if (targetId === draggedId) return;

            if (draggedType === 'journalEntry') {
                // Entry can be dropped onto a notebook or root (via 'root' type)
                if (targetType === 'notebook') {
                    onMoveEntry(draggedId, targetId);
                }
                // Drop entry onto entry → move to that entry's notebook
                // (targetId is actually the notebook id tagged on the entry row — see data-item-id on entry rows)
                if (targetType === 'entry-notebook') {
                    onMoveEntry(draggedId, targetId);
                }
            } else {
                // Folder or notebook dropped onto a folder → move into folder
                if (targetType === 'folder') {
                    onMoveItem(draggedId, draggedType, targetId);
                }
                // Dropped onto root zone → move to root
                if (targetType === 'root') {
                    onMoveItem(draggedId, draggedType, undefined);
                }
            }
        };

        const abortDrag = () => {
            const drag = dragRef.current;
            if (!drag) return;
            try { drag.sourceEl.releasePointerCapture(drag.pointerId); } catch (_) { /* already released */ }
            drag.sourceEl.style.opacity = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            removeGhost();
            ghostRef.current = null;
            useUIStore.getState().setDraggedEntity(null);
            if (currentDropRef.current) {
                highlightDropTarget(null, currentDropRef.current.itemId);
                currentDropRef.current = null;
            }
            dragRef.current = null;
        };

        const onPointerCancel = () => abortDrag();

        // lostpointercapture fires when capture is released (focus loss, touch cancel, etc.)
        const onLostCapture = () => { if (dragRef.current?.active) abortDrag(); else dragRef.current = null; };

        // Use window so events from pointer-captured elements reach us correctly.
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        window.addEventListener('lostpointercapture', onLostCapture, true);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            window.removeEventListener('lostpointercapture', onLostCapture, true);
        };
    }, [onMoveItem, onMoveEntry]);

    return handlePointerDown;
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

const InlineInput = ({ value, onCommit, onCancel }: { value: string, onCommit: (val: string) => void, onCancel: () => void }) => {
    const [tempValue, setTempValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    return (
        <NemotoInput
            ref={inputRef}
            type="text"
            controlSize="xs"
            aria-label="Rename journal item"
            className="flex-1 px-1 h-5 text-xs min-w-[50px]"
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

// ---------------------------------------------------------------------------
// JournalTreeItem
// ---------------------------------------------------------------------------

const JournalTreeItem = memo(({
    item,
    level,
    entries,
    selectedNotebookId,
    selectedEntryId,
    selectedItemIds,
    onSelectNotebook,
    onSelectEntry,
    onToggleSelection,
    onContextMenu,
    onPointerDown,
    editingItemId,
    setEditingItemId,
    onRename,
    creatingNewItem,
    setCreatingNewItem,
    onCreateNotebook,
    onCreateFolder,
    expansionToggle,
    searchActive,
}: any) => {
    const isFolder = item.type === 'folder';
    const isNotebook = item.type === 'notebook';

    // Instead of local state, use global persisted state
    const { expandedItems, toggleExpanded } = useJournalStore();
    const expanded = searchActive || expandedItems[item.id] !== false; // Search results stay visible.

    useEffect(() => {
        if (expansionToggle?.count > 0) {
            toggleExpanded(item.id, expansionToggle.action === 'expand');
        }
    }, [expansionToggle, item.id, toggleExpanded]);
    const notebookEntries = isNotebook ? entries.filter((e: any) => e.notebookId === item.id) : [];

    const isMultiSelected = selectedItemIds?.has(item.id);
    const isSelected = isNotebook && selectedNotebookId === item.id;
    const isHighlighted = isMultiSelected || isSelected;
    const hasChildren = item.children && item.children.length > 0;

    const isDraggable = !(item.id === 'quick-notes' || (isNotebook && item.title === 'Quick Notes'));

    return (
        <div className="select-none nemoto-journal-tree-item">
            {/* Item Row — drag source + drop target */}
            <div
                className={`nemoto-journal-tree-row nemoto-journal-tree-row-${item.type} flex min-w-0 items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer nemoto-transition-interactive border border-transparent group relative ${isHighlighted
                    ? 'is-selected bg-accent-primary/20 text-accent-primary border-accent-primary/20'
                    : 'hover:bg-app-hover text-text-muted hover:text-text-main'
                    }`}
                style={{ paddingLeft: `${(level * 12) + 8}px` }}
                // Drop target attributes — folders and notebooks accept drops
                data-drop-target={isFolder || isNotebook ? 'true' : undefined}
                data-item-id={isFolder || isNotebook ? item.id : undefined}
                data-item-type={isFolder ? 'folder' : isNotebook ? 'notebook' : undefined}
                // Drag source attributes
                data-drag-id={isDraggable ? item.id : undefined}
                data-drag-type={isDraggable ? item.type : undefined}
                data-drag-label={isDraggable ? item.title : undefined}
                onPointerDown={isDraggable ? onPointerDown : undefined}
                onClick={(e) => {
                    e.stopPropagation();
                    if (e.ctrlKey || e.metaKey) {
                        onToggleSelection(item.id);
                    } else {
                        if (isNotebook) onSelectNotebook(item.id);
                        toggleExpanded(item.id);
                    }
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, item.type, item.id);
                }}
            >
                {/* Expand Toggle Arrow */}
                <div
                    className={`transition-transform nemoto-transition-fast ${expanded ? 'rotate-90' : ''} ${(!isFolder && notebookEntries.length === 0) ? 'opacity-0 pointer-events-none' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
                >
                    <ChevronRight size={10} className="text-text-faint hover:text-text-main" />
                </div>

                {isFolder
                    ? <FolderInput size={12} className="nemoto-journal-tree-icon text-accent-warning pointer-events-none shrink-0" />
                    : <Book size={12} className={`nemoto-journal-tree-icon pointer-events-none shrink-0 ${isHighlighted ? 'text-accent-primary' : 'text-text-faint'}`} />
                }

                {editingItemId === item.id ? (
                    <InlineInput
                        value={item.title}
                        onCommit={(val) => {
                            if (val && val !== item.title) onRename(item.id, item.type, val);
                            setEditingItemId(null);
                        }}
                        onCancel={() => setEditingItemId(null)}
                    />
                ) : (
                    <span className="nemoto-journal-tree-label min-w-0 flex-1 truncate font-medium" title={item.title}>{item.title}</span>
                )}

                {isNotebook && (
                    <span className="nemoto-journal-count text-text-faint font-mono bg-app-active/50 px-1 rounded-sm shrink-0">
                        {notebookEntries.length}
                    </span>
                )}
            </div>

            {/* Children */}
            {expanded && (
                <div>
                    {/* Inline Creation Row */}
                    {creatingNewItem && creatingNewItem.parentId === item.id && (
                        <div
                            style={{ paddingLeft: `${((level + 1) * 12) + 8}px` }}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-accent-primary/5 text-accent-primary"
                        >
                            <div className="w-[10px]" /> {/* Spacer for arrow */}
                            {creatingNewItem.type === 'folder' ? <FolderInput size={12} className="text-accent-warning" /> : <Book size={12} />}
                            <InlineInput
                                value=""
                                onCommit={(val) => {
                                    if (val) {
                                        if (creatingNewItem.type === 'folder') onCreateFolder(val, item.id);
                                        else onCreateNotebook(val, item.id);
                                    }
                                    setCreatingNewItem(null);
                                }}
                                onCancel={() => setCreatingNewItem(null)}
                            />
                        </div>
                    )}

                    {hasChildren && item.children.map((child: any) => (
                        <JournalTreeItem
                            key={child.id}
                            item={child}
                            level={level + 1}
                            entries={entries}
                            selectedNotebookId={selectedNotebookId}
                            selectedEntryId={selectedEntryId}
                            selectedItemIds={selectedItemIds}
                            onSelectNotebook={onSelectNotebook}
                            onSelectEntry={onSelectEntry}
                            onToggleSelection={onToggleSelection}
                            onContextMenu={onContextMenu}
                            onPointerDown={onPointerDown}
                            editingItemId={editingItemId}
                            setEditingItemId={setEditingItemId}
                            onRename={onRename}
                            creatingNewItem={creatingNewItem}
                            setCreatingNewItem={setCreatingNewItem}
                            onCreateNotebook={onCreateNotebook}
                            onCreateFolder={onCreateFolder}
                            expansionToggle={expansionToggle}
                            searchActive={searchActive}
                        />
                    ))}

                    {/* Entry leaf nodes */}
                    {isNotebook && notebookEntries.length > 0 && (
                        <div>
                            {notebookEntries.map((entry: any) => (
                                <div
                                    key={entry.id}
                                    style={{ paddingLeft: `${((level + 1) * 12) + 8 + 18}px` }}
                                    className={`nemoto-journal-entry-row group flex min-w-0 items-center gap-2 px-2 py-1 rounded-sm cursor-pointer transition-colors relative ${selectedEntryId === entry.id
                                        ? 'is-selected bg-accent-primary text-white font-medium'
                                        : 'hover:bg-app-hover text-text-muted hover:text-text-main'
                                        }`}
                                    // Drop target: use the parent notebook id so entries can be reordered
                                    // by dropping onto siblings (moves to same notebook).
                                    // Use type 'entry-notebook' so the hook knows to call onMoveEntry.
                                    data-drop-target="true"
                                    data-item-id={item.id}
                                    data-item-type="entry-notebook"
                                    // Drag source
                                    data-drag-id={entry.id}
                                    data-drag-type="journalEntry"
                                    data-drag-label={entry.title || 'Untitled'}
                                    onPointerDown={onPointerDown}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelectEntry(entry.id);
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        onContextMenu(e, 'entry', entry.id);
                                    }}
                                >
                                    <FileText size={11} className="nemoto-journal-entry-icon opacity-70 shrink-0" />
                                    {editingItemId === entry.id ? (
                                        <InlineInput
                                            value={entry.title || 'Untitled'}
                                            onCommit={(val) => {
                                                if (val && val !== (entry.title || 'Untitled')) onRename(entry.id, 'entry', val);
                                                setEditingItemId(null);
                                            }}
                                            onCancel={() => setEditingItemId(null)}
                                        />
                                    ) : (
                                        <span className="min-w-0 truncate flex-1" title={entry.title || 'Untitled'}>{entry.title || 'Untitled'}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

// ---------------------------------------------------------------------------
// NotebookExplorer
// ---------------------------------------------------------------------------

const NotebookExplorer = memo(({
    notebooks,
    folders,
    entries,
    selectedNotebookId,
    selectedEntryId,
    onSelectNotebook,
    onSelectEntry,
    onContextMenu,
    onMoveItem,
    onMoveEntry,
    editingItemId,
    setEditingItemId,
    onRename,
    creatingNewItem,
    setCreatingNewItem,
    onCreateNotebook,
    onCreateFolder,
    expansionToggle,
    searchQuery,
}: any) => {

    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const searchActive = searchQuery.trim().length > 0;

    const handleToggleSelection = (id: string) => {
        setSelectedItemIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleSelectNotebookWrapper = (id: string) => {
        setSelectedItemIds(new Set());
        onSelectNotebook(id);
    };

    // Build tree data
    const treeData = useMemo(() => {
        const quickNotes = notebooks.find((n: any) => n.title === 'Quick Notes');
        const otherNotebooks = notebooks.filter((n: any) => n.title !== 'Quick Notes');
        const folderIds = new Set((folders || []).map((f: any) => f.id));

        const notebookHasVisibleEntries = (notebookId: string) => !searchActive
            || entries.some((entry: any) => entry.notebookId === notebookId);

        const renderedFolderIds = new Set<string>();
        const buildFolder = (folder: any): any | null => {
            // Corrupt imported hierarchies must stay finite and recoverable.
            if (renderedFolderIds.has(folder.id)) return null;
            renderedFolderIds.add(folder.id);

            const childFolders = (folders || [])
                .filter((candidate: any) => candidate.parentId === folder.id)
                .map(buildFolder)
                .filter(Boolean)
                .filter((child: any) => !searchActive || child.children.length > 0);
            const childNotebooks = otherNotebooks
                .filter((notebook: any) => notebook.folderId === folder.id && notebookHasVisibleEntries(notebook.id))
                .map((notebook: any) => ({ ...notebook, type: 'notebook' }));

            return { ...folder, type: 'folder', children: [...childFolders, ...childNotebooks] };
        };

        const rootFolders = (folders || []).filter((folder: any) => !folder.parentId || !folderIds.has(folder.parentId));
        const rootItems = rootFolders
            .map(buildFolder)
            .filter(Boolean)
            .filter((folder: any) => !searchActive || folder.children.length > 0);

        // A closed cycle has no natural root. Surface its first unrendered folder
        // at root instead of making the whole branch disappear.
        (folders || []).forEach((folder: any) => {
            if (renderedFolderIds.has(folder.id)) return;
            const recovered = buildFolder(folder);
            if (recovered && (!searchActive || recovered.children.length > 0)) rootItems.push(recovered);
        });

        rootItems.push(...otherNotebooks
            .filter((notebook: any) => (!notebook.folderId || !folderIds.has(notebook.folderId)) && notebookHasVisibleEntries(notebook.id))
            .map((notebook: any) => ({ ...notebook, type: 'notebook' })));
        if (quickNotes && notebookHasVisibleEntries(quickNotes.id)) {
            rootItems.unshift({ ...quickNotes, type: 'notebook' });
        }
        return rootItems;
    }, [notebooks, folders, entries, searchActive]);

    // Single pointer-drag hook instance for the whole tree
    const handlePointerDown = useJournalDrag(onMoveItem, onMoveEntry);

    if (searchActive && entries.length === 0) {
        return (
            <div className="nemoto-journal-search-empty px-5 py-10 text-center">
                <Search size={18} className="mx-auto mb-3 text-text-faint" />
                <p className="text-xs font-medium text-text-muted">No matching notes</p>
                <p className="mt-1 text-[10px] text-text-faint">Try another title or phrase.</p>
            </div>
        );
    }

    if (notebooks.length === 0 && (folders || []).length === 0 && !creatingNewItem) {
        return (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-10 h-10 rounded-full bg-app-bg border border-app-border flex items-center justify-center mb-3 text-text-muted">
                    <Book size={16} />
                </div>
                <p className="text-xs font-medium text-text-muted mb-1">No notebooks yet</p>
                <p className="text-[10px] text-text-muted">Create a notebook to start journaling.</p>
            </div>
        );
    }

    return (
        // Root drop zone — items dropped here move to root (no folder)
        <div
            className="min-h-[50px] space-y-[2px] overflow-x-hidden p-1.5"
            data-drop-target="true"
            data-item-id="__root__"
            data-item-type="root"
            onClick={() => { setSelectedItemIds(new Set()); setCreatingNewItem(null); }}
        >
            {/* Root Creation Row */}
            {creatingNewItem && creatingNewItem.parentId === undefined && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-accent-primary/5 text-accent-primary">
                    <div className="w-[10px]" /> {/* Spacer */}
                    {creatingNewItem.type === 'folder' ? <FolderInput size={12} className="text-accent-warning" /> : <Book size={12} />}
                    <InlineInput
                        value=""
                        onCommit={(val) => {
                            if (val) {
                                if (creatingNewItem.type === 'folder') onCreateFolder(val);
                                else onCreateNotebook(val);
                            }
                            setCreatingNewItem(null);
                        }}
                        onCancel={() => setCreatingNewItem(null)}
                    />
                </div>
            )}

            {treeData.map((item: any) => (
                <JournalTreeItem
                    key={item.id}
                    item={item}
                    level={0}
                    entries={entries}
                    selectedNotebookId={selectedNotebookId}
                    selectedEntryId={selectedEntryId}
                    selectedItemIds={selectedItemIds}
                    onSelectNotebook={handleSelectNotebookWrapper}
                    onSelectEntry={onSelectEntry}
                    onToggleSelection={handleToggleSelection}
                    onContextMenu={onContextMenu}
                    onPointerDown={handlePointerDown}
                    editingItemId={editingItemId}
                    setEditingItemId={setEditingItemId}
                    onRename={onRename}
                    creatingNewItem={creatingNewItem}
                    setCreatingNewItem={setCreatingNewItem}
                    onCreateNotebook={onCreateNotebook}
                    onCreateFolder={onCreateFolder}
                    expansionToggle={expansionToggle}
                    searchActive={searchActive}
                />
            ))}
        </div>
    );
});

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------

const ContextMenu = ({ x, y, type, onRename, onDelete, onExpandAll, onCollapseAll, onClose }: any) => {
    useEffect(() => {
        const handleClickOutside = () => onClose();
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, [onClose]);

    return createPortal(
        <NemotoMenu
            aria-label="Journal item actions"
            className="fixed z-[9999] min-w-[160px] nemoto-motion-popover"
            onClose={onClose}
            style={{ left: x, top: y }}
            onClick={e => e.stopPropagation()}
        >
            <NemotoMenuItem
                compact
                onClick={onRename}
            >
                <Edit2 size={12} /> Rename
            </NemotoMenuItem>

            {(type === 'folder' || type === 'notebook') && (
                <>
                    <NemotoMenuItem
                        compact
                        onClick={onExpandAll}
                    >
                        <Maximize2 size={12} /> Expand All
                    </NemotoMenuItem>
                    <NemotoMenuItem
                        compact
                        onClick={onCollapseAll}
                    >
                        <Minimize2 size={12} /> Collapse All
                    </NemotoMenuItem>
                </>
            )}

            <NemotoMenuDivider />
            <NemotoMenuItem
                compact
                danger
                onClick={() => { onDelete(); onClose(); }}
            >
                <Trash2 size={12} />
                Delete
            </NemotoMenuItem>
        </NemotoMenu>,
        document.body
    );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function JournalPanelNew({
    dock = 'bottom',
    sideDockAvailable = false,
}: JournalPanelProps) {
    const {
        journalPanelExpanded,
        journalPanelMaximized,
        journalPanelHeight,
        toggleJournalPanel,
        toggleJournalPanelMaximized,
        setJournalPanelHeight,
        activeView,
    } = useUIStore();
    const journalDockPreference = useSettingsStore(state => state.journalDock);
    const journalPanelWidth = useSettingsStore(state => state.journalPanelWidth);
    const setJournalDock = useSettingsStore(state => state.setJournalDock);
    const setJournalPanelWidth = useSettingsStore(state => state.setJournalPanelWidth);
    const { portfolio, isDirty, isSaving, lastSavedAt, saveError } = usePortfolioStore();
    const {
        selectedNotebookId,
        selectedEntryId,
        selectNotebook,
        selectEntry,
        createNotebook,
        deleteNotebook,
        createEntry,
        updateEntry,
        deleteEntry,
        linkContext,
        moveEntry,
        createFolder,
        deleteFolder,
        moveItem,
        renameItem,
        renameEntry
    } = useJournalStore();

    const [isResizing, setIsResizing] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const [entityPickerOpen, setEntityPickerOpen] = useState(false);
    const [localHeight, setLocalHeight] = useState(journalPanelHeight);
    const [localWidth, setLocalWidth] = useState(journalPanelWidth);
    const [searchQuery, setSearchQuery] = useState('');
    const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);

    const [sidebarWidth, setSidebarWidth] = useState(344);
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'notebook' | 'entry' | 'folder', id: string } | null>(null);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [creatingNewItem, setCreatingNewItem] = useState<{ type: 'notebook' | 'folder', parentId: string | undefined } | null>(null);
    const [expansionToggle, setExpansionToggle] = useState({ count: 0, action: 'expand' as 'expand' | 'collapse' });
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        variant?: 'danger' | 'warning' | 'primary';
    } | null>(null);

    const notebooks = portfolio.journal?.notebooks || [];
    const folders = portfolio.journal?.folders || [];
    const entries = portfolio.journal?.entries || [];
    const visibleEntries = useMemo(
        () => filterJournalEntries(entries, searchQuery),
        [entries, searchQuery],
    );
    const selectedEntry = entries.find(e => e.id === selectedEntryId);
    const selectedNotebook = notebooks.find(n => n.id === (selectedEntry?.notebookId || selectedNotebookId));
    const saveStateLabel = saveError
        ? 'Save failed'
        : isSaving
            ? 'Saving\u2026'
            : isDirty
                ? 'Unsaved changes'
                : lastSavedAt
                    ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
                    : 'Saved';
    const saveStateClass = saveError
        ? 'text-accent-danger'
        : isSaving || isDirty
            ? 'text-accent-warning'
            : 'text-text-faint';

    useEffect(() => {
        if (!isResizing) setLocalHeight(journalPanelHeight);
    }, [journalPanelHeight, isResizing]);

    useEffect(() => {
        if (!isResizing) setLocalWidth(journalPanelWidth);
    }, [isResizing, journalPanelWidth]);

    useEffect(() => {
        setContextPanelCollapsed(dock === 'left');
        setIsResizing(false);
    }, [dock]);

    useEffect(() => {
        if (!journalPanelMaximized) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') toggleJournalPanelMaximized();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [journalPanelMaximized, toggleJournalPanelMaximized]);

    // Resize the panel along the edge that faces the canvas.
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            if (dock === 'left') {
                const panelLeft = panelRef.current?.getBoundingClientRect().left ?? 0;
                const maxWidth = Math.min(1200, window.innerWidth * 0.6);
                setLocalWidth(Math.max(560, Math.min(maxWidth, e.clientX - panelLeft)));
                document.body.style.cursor = 'ew-resize';
            } else {
                const newHeight = window.innerHeight - e.clientY;
                setLocalHeight(Math.max(200, Math.min(window.innerHeight - 100, newHeight)));
                document.body.style.cursor = 'ns-resize';
            }
            document.body.style.userSelect = 'none';
        };
        const handleMouseUp = () => {
            if (!isResizing) return;
            setIsResizing(false);
            if (dock === 'left') setJournalPanelWidth(localWidth);
            else setJournalPanelHeight(localHeight);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dock, isResizing, localHeight, localWidth, setJournalPanelHeight, setJournalPanelWidth]);

    // Sidebar horizontal resize
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingSidebar || !sidebarRef.current) return;
            const sidebarLeft = sidebarRef.current.getBoundingClientRect().left;
            const newWidth = Math.max(220, Math.min(720, e.clientX - sidebarLeft));
            sidebarRef.current.style.width = `${newWidth}px`;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        };
        const handleMouseUp = () => {
            if (!isResizingSidebar) return;
            setIsResizingSidebar(false);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            if (sidebarRef.current) {
                const w = parseInt(sidebarRef.current.style.width, 10);
                if (!isNaN(w)) setSidebarWidth(w);
            }
        };
        if (isResizingSidebar) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizingSidebar]);

    const handleCreateNotebook = () => {
        setSearchQuery('');
        setCreatingNewItem({ type: 'notebook', parentId: undefined });
    };

    const handleCreateFolder = () => {
        setSearchQuery('');
        setCreatingNewItem({ type: 'folder', parentId: undefined });
    };

    const handleCreateEntry = () => {
        const targetNotebookId = selectedNotebookId
            || notebooks.find(notebook => notebook.title === 'Quick Notes')?.id
            || notebooks[0]?.id;

        if (!targetNotebookId) {
            setConfirmDialog({
                isOpen: true,
                title: 'No Notebook Selected',
                message: 'Create a notebook before creating your first note.',
                onConfirm: () => { },
                variant: 'primary'
            });
            return;
        }
        setSearchQuery('');
        const newId = createEntry(targetNotebookId, 'Untitled Note');
        selectEntry(newId);
    };

    const handleMoveEntry = useCallback((entryId: string, targetNotebookId: string) => {
        const entry = entries.find(candidate => candidate.id === entryId);
        if (!entry || entry.notebookId === targetNotebookId) return;

        const sourceNotebookId = entry.notebookId;
        const targetNotebook = notebooks.find(notebook => notebook.id === targetNotebookId);

        moveEntry(entryId, targetNotebookId);
        selectEntry(entryId);

        toast.success(`Moved “${entry.title || 'Untitled Note'}”${targetNotebook ? ` to ${targetNotebook.title}` : ''}`, {
            duration: 6000,
            action: {
                label: 'Undo',
                onClick: () => {
                    moveEntry(entryId, sourceNotebookId);
                    selectEntry(entryId);
                    toast.success('Move undone');
                },
            },
        });
    }, [entries, moveEntry, notebooks, selectEntry]);

    const handleContextMenu = (e: React.MouseEvent, type: 'notebook' | 'entry' | 'folder', id: string) => {
        setContextMenu({ x: e.clientX, y: e.clientY, type, id });
    };

    const handleRename = () => {
        if (!contextMenu) return;
        setEditingItemId(contextMenu.id);
        setContextMenu(null);
    };

    const handleDeleteFromMenu = () => {
        if (!contextMenu) return;

        if (contextMenu.type === 'notebook') {
            setConfirmDialog({
                isOpen: true,
                title: 'Delete Notebook',
                message: 'Are you sure you want to delete this notebook and all its entries?',
                variant: 'danger',
                onConfirm: () => deleteNotebook(contextMenu.id)
            });
        } else if (contextMenu.type === 'folder') {
            setConfirmDialog({
                isOpen: true,
                title: 'Delete Folder',
                message: 'Delete this folder? (Notebooks will move to root)',
                variant: 'danger',
                onConfirm: () => deleteFolder(contextMenu.id)
            });
        } else if (contextMenu.type === 'entry') {
            setConfirmDialog({
                isOpen: true,
                title: 'Delete Entry',
                message: 'Delete this entry?',
                variant: 'danger',
                onConfirm: () => deleteEntry(contextMenu.id)
            });
        }
        setContextMenu(null);
    };

    const handleExpandAll = () => {
        setExpansionToggle(prev => ({ count: prev.count + 1, action: 'expand' }));
        setContextMenu(null);
    };

    const handleCollapseAll = () => {
        setExpansionToggle(prev => ({ count: prev.count + 1, action: 'collapse' }));
        setContextMenu(null);
    };

    const targetDock = journalDockPreference === 'left' ? 'bottom' : 'left';
    const sideDockSwitchDisabled = targetDock === 'left' && !sideDockAvailable;

    return (
        <div
            ref={panelRef}
            className={`relative flex shrink-0 flex-col overflow-hidden border-app-border bg-app-surface journal-panel-wrapper is-${dock}-docked ${dock === 'left' ? 'order-1 border-r' : 'order-2 border-t'} ${journalPanelExpanded ? 'is-expanded' : ''} ${journalPanelMaximized ? 'is-maximized' : ''} ${isResizing ? 'is-resizing' : ''}`}
            role="region"
            aria-label="Journal"
            tabIndex={-1}
            onPointerDownCapture={(event) => event.currentTarget.focus({ preventScroll: true })}
            style={journalPanelMaximized ? {
                position: 'absolute',
                inset: 0,
                height: '100%',
                width: '100%',
                zIndex: 50,
            } : dock === 'left'
                ? {
                    height: '100%',
                    width: journalPanelExpanded ? `${localWidth}px` : '48px',
                }
                : {
                    width: '100%',
                    height: journalPanelExpanded ? `${localHeight}px` : '48px',
                    ...(activeView === 'dependency' ? {
                        position: 'absolute' as const,
                        left: '320px',
                        right: '0',
                        bottom: '0',
                        zIndex: 20
                    } : {})
                }}
        >
            {dock === 'left' && !journalPanelExpanded && !journalPanelMaximized ? (
                <NemotoButton
                    size="sm"
                    variant="ghost"
                    onClick={toggleJournalPanel}
                    aria-expanded="false"
                    className="nemoto-journal-side-rail flex h-full w-full flex-col items-center justify-start gap-3 rounded-none px-0 py-4 text-[10px] font-bold uppercase tracking-[0.16em] text-text-main"
                    title="Open Journal"
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-primary" />
                    <Book size={15} className="text-accent-primary" />
                    <span className="nemoto-journal-side-rail-label">Journal</span>
                </NemotoButton>
            ) : (
                <>
            {/* Panel Resize Handle */}
            {journalPanelExpanded && !journalPanelMaximized && (
                <div
                    role="separator"
                    aria-orientation={dock === 'left' ? 'vertical' : 'horizontal'}
                    aria-label="Resize journal panel"
                    className={`absolute z-50 group transition-colors hover:bg-accent-primary/30 ${dock === 'left'
                        ? 'right-0 top-0 bottom-0 w-1 cursor-ew-resize'
                        : 'top-0 left-0 right-0 h-1 cursor-ns-resize'} ${isResizing ? 'bg-accent-primary/50' : ''}`}
                    onMouseDown={() => setIsResizing(true)}
                >
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                        {dock === 'left'
                            ? <GripVertical size={16} className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                            : <GripHorizontal size={16} className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="nemoto-journal-topbar h-12 shrink-0 flex items-center justify-between gap-3 px-5 border-b border-app-border bg-app-surface">
                <div className="flex min-w-0 items-center gap-4">
                    <NemotoButton
                        size="sm"
                        variant="ghost"
                        onClick={toggleJournalPanel}
                        aria-expanded={journalPanelExpanded}
                        className="nemoto-journal-title-button flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-text-main hover:text-accent-primary nemoto-transition-interactive group"
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-primary"></span>
                        Journal
                        {journalPanelExpanded
                            ? dock === 'left'
                                ? <ChevronLeft size={14} className="ml-1 text-text-faint group-hover:text-accent-primary" />
                                : <ChevronDown size={14} className="ml-1 text-text-faint group-hover:text-accent-primary" />
                            : <ChevronUp size={14} className="text-text-faint group-hover:text-accent-primary ml-1" />
                        }
                    </NemotoButton>
                    {!journalPanelExpanded && selectedEntry && <div className="h-4 w-px bg-app-border mx-2" />}
                    {!journalPanelExpanded && selectedEntry && (
                        <span className="text-[11px] text-text-muted font-medium truncate max-w-[200px]">
                            {selectedEntry.title || 'Untitled Note'}
                        </span>
                    )}
                    {journalPanelExpanded && selectedNotebook && (
                        <span className="nemoto-journal-location text-[11px] text-text-faint truncate max-w-[280px]">
                            {selectedNotebook.title}
                            {selectedEntry && <span className="text-text-muted"> / {selectedEntry.title || 'Untitled Note'}</span>}
                        </span>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <NemotoPanelIconButton
                        aria-label={targetDock === 'left' ? 'Dock journal on left' : 'Dock journal at bottom'}
                        size="sm"
                        disabled={sideDockSwitchDisabled}
                        onClick={() => setJournalDock(targetDock)}
                        title={sideDockSwitchDisabled
                            ? 'Widen the window to dock Journal on the left'
                            : targetDock === 'left'
                                ? 'Dock Journal on Left'
                                : 'Dock Journal at Bottom'}
                        className="nemoto-journal-dock-button"
                    >
                        {targetDock === 'left' ? <PanelLeft size={15} /> : <PanelBottom size={15} />}
                    </NemotoPanelIconButton>
                    <NemotoPanelIconButton
                        aria-label={journalPanelMaximized ? 'Restore journal size' : 'Maximize journal'}
                        aria-pressed={journalPanelMaximized}
                        size="sm"
                        onClick={toggleJournalPanelMaximized}
                        title={journalPanelMaximized ? 'Restore journal size (Esc)' : 'Maximize journal'}
                        className="nemoto-journal-maximize-button"
                    >
                        {journalPanelMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </NemotoPanelIconButton>
                </div>
            </div>

            {/* Main Content — only when expanded */}
            {journalPanelExpanded && (
                <div className="flex-1 flex overflow-hidden">
                    {/* Left Panel — Sidebar */}
                    <div
                        ref={sidebarRef}
                        className="nemoto-journal-sidebar shrink-0 border-r border-app-border bg-app-bg/30 overflow-y-auto overflow-x-hidden custom-scrollbar relative group/sidebar"
                        style={{
                            width: `${sidebarWidth}px`,
                            minWidth: dock === 'left' ? '240px' : '280px',
                            maxWidth: dock === 'left' ? '360px' : '720px',
                            transition: isResizingSidebar ? 'none' : undefined,
                        }}
                    >
                        <div className="nemoto-journal-sidebar-actions border-b border-app-border/40">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="nemoto-journal-library-heading font-bold uppercase text-text-muted">Library</span>
                                    <span className="nemoto-journal-library-total text-text-faint" aria-live="polite">
                                        {searchQuery.trim()
                                            ? `${visibleEntries.length} ${visibleEntries.length === 1 ? 'result' : 'results'}`
                                            : `${entries.length} ${entries.length === 1 ? 'note' : 'notes'}`}
                                    </span>
                                </div>
                                <NemotoPanelIconButton
                                    aria-label="Collapse all library sections"
                                    size="sm"
                                    onClick={handleCollapseAll}
                                    title="Collapse All"
                                >
                                    <ChevronsUp size={13} />
                                </NemotoPanelIconButton>
                            </div>
                            <div className="nemoto-journal-sidebar-primary-actions flex items-center gap-1.5">
                                <NemotoButton
                                    size="sm"
                                    onClick={handleCreateEntry}
                                    className="nemoto-journal-new-note flex shrink-0 items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                                >
                                    <Plus size={13} /> New Note
                                </NemotoButton>
                                <NemotoPanelIconButton
                                    aria-label="New notebook"
                                    size="sm"
                                    onClick={handleCreateNotebook}
                                    title="New Notebook"
                                    className="nemoto-journal-create-icon"
                                >
                                    <BookPlus size={16} />
                                </NemotoPanelIconButton>
                                <NemotoPanelIconButton
                                    aria-label="New folder"
                                    size="sm"
                                    onClick={handleCreateFolder}
                                    title="New Folder"
                                    className="nemoto-journal-create-icon"
                                >
                                    <FolderPlus size={16} />
                                </NemotoPanelIconButton>
                            </div>
                            <div className="nemoto-journal-search relative">
                                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-text-faint" />
                                <NemotoInput
                                    type="search"
                                    controlSize="sm"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="Search notes..."
                                    aria-label="Search journal notes"
                                    className="w-full text-xs"
                                />
                                {searchQuery && (
                                    <NemotoPanelIconButton
                                        aria-label="Clear journal search"
                                        size="sm"
                                        onClick={() => setSearchQuery('')}
                                        title="Clear Search"
                                        className="absolute right-1 top-1/2 -translate-y-1/2"
                                    >
                                        <X size={12} />
                                    </NemotoPanelIconButton>
                                )}
                            </div>
                        </div>
                        <NotebookExplorer
                            notebooks={notebooks}
                            folders={folders}
                            entries={visibleEntries}
                            selectedNotebookId={selectedNotebookId}
                            selectedEntryId={selectedEntryId}
                            onSelectNotebook={selectNotebook}
                            onSelectEntry={selectEntry}
                            onContextMenu={handleContextMenu}
                            onMoveItem={moveItem}
                            onMoveEntry={handleMoveEntry}
                            editingItemId={editingItemId}
                            setEditingItemId={setEditingItemId}
                            onRename={(id: string, type: 'notebook' | 'folder' | 'entry', title: string) => {
                                if (type === 'entry') renameEntry(id, title);
                                else renameItem(id, type as any, title);
                            }}
                            creatingNewItem={creatingNewItem}
                            setCreatingNewItem={setCreatingNewItem}
                            onCreateNotebook={createNotebook}
                            onCreateFolder={createFolder}
                            expansionToggle={expansionToggle}
                            searchQuery={searchQuery}
                        />

                        {/* Sidebar Resize Handle */}
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize journal library"
                            className={`nemoto-journal-sidebar-resizer absolute top-0 right-0 bottom-0 w-2 cursor-col-resize transition-colors z-10 ${isResizingSidebar ? 'is-resizing bg-accent-primary/50' : ''}`}
                            onMouseDown={(e) => { e.preventDefault(); setIsResizingSidebar(true); }}
                        />
                    </div>

                    {/* Center Panel — Editor */}
                    <div className="nemoto-journal-editor-shell flex-1 flex flex-col bg-app-surface overflow-hidden">
                        {!selectedEntry ? (
                            <div className="flex-1 flex items-center justify-center text-text-faint select-none">
                                <div className="text-center">
                                    <p className="mb-2 text-4xl opacity-20">✍️</p>
                                    <p>Select or create a note.</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="nemoto-journal-document-meta px-6 py-5 border-b border-app-border/30 shrink-0 bg-app-bg/10">
                                    <div className="nemoto-journal-document-meta-inner space-y-3">
                                        <input
                                            type="text"
                                            value={selectedEntry.title}
                                            onChange={(e) => updateEntry(selectedEntry.id, { title: e.target.value })}
                                            placeholder="Entry Title..."
                                            aria-label="Journal entry title"
                                            className="nemoto-journal-entry-title w-full text-2xl font-bold tracking-tight bg-transparent border-none outline-none text-text-main placeholder-text-faint/50 focus:placeholder-text-main/10 transition-colors nemoto-transition-fast"
                                        />
                                         <div className="nemoto-journal-meta-row flex items-center gap-3 relative">
                                             <TagSelector selectedTagIds={selectedEntry.tags || []} onChange={(tags) => updateEntry(selectedEntry.id, { tags })} />
                                             <div className="h-4 w-px bg-app-border/70" />
                                             <JournalSharingControl
                                                 internal={selectedEntry.sharePolicy === 'internal'}
                                                 onChange={(internal) => updateEntry(selectedEntry.id, {
                                                     sharePolicy: internal ? 'internal' : 'shareable',
                                                 })}
                                             />
                                             <div className="h-4 w-px bg-app-border/70" />
                                             <span
                                                className={`nemoto-journal-save-state text-[10px] ${saveStateClass} font-mono uppercase tracking-widest`}
                                                title={saveError || undefined}
                                                aria-live="polite"
                                            >
                                                {saveStateLabel}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <Suspense fallback={<div className="flex-1 p-6 text-sm text-text-muted">Loading editor...</div>}>
                                    <TipTapEditor
                                        content={selectedEntry.content || ''}
                                        entryId={selectedEntry.id}
                                        onUpdate={(html: string) => updateEntry(selectedEntry.id, { content: html })}
                                    />
                                </Suspense>
                            </>
                        )}
                    </div>

                    {/* Right Panel — Context */}
                    <aside
                        aria-label="Linked context"
                        className={`nemoto-journal-context-panel shrink-0 border-l border-app-border bg-app-bg/30 ${contextPanelCollapsed
                            ? 'is-collapsed w-11 overflow-hidden'
                            : `${dock === 'left' ? 'w-[240px]' : 'w-[280px]'} overflow-y-auto custom-scrollbar`
                            }`}
                    >
                        {contextPanelCollapsed ? (
                            <div className="flex h-full flex-col items-center gap-3 py-3">
                                <NemotoPanelIconButton
                                    aria-label="Expand linked context"
                                    aria-expanded="false"
                                    size="sm"
                                    onClick={() => setContextPanelCollapsed(false)}
                                    title="Expand Linked Context"
                                    className="nemoto-journal-context-toggle"
                                >
                                    <ChevronLeft size={15} />
                                </NemotoPanelIconButton>
                                <span className="nemoto-journal-context-collapsed-label text-[9px] font-bold uppercase tracking-wider text-text-faint">
                                    Context
                                </span>
                                {!!selectedEntry?.linkedContext?.length && (
                                    <span className="nemoto-journal-context-count text-[9px] text-text-faint">
                                        {selectedEntry.linkedContext.length}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <div className="flex min-h-full flex-col">
                                <div className="nemoto-journal-context-header flex items-center justify-between gap-2 p-4 pb-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="truncate text-[10px] font-bold uppercase text-text-faint tracking-wider">Linked Context</span>
                                        <span className="text-[10px] text-text-faint">({(selectedEntry?.linkedContext || []).length})</span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {selectedEntry && (
                                            <NemotoButton size="sm" variant="ghost" onClick={() => setEntityPickerOpen(true)} className="px-2 py-1 text-accent-primary text-[10px] flex items-center gap-1">
                                                <Plus size={10} /> Add
                                            </NemotoButton>
                                        )}
                                        <NemotoPanelIconButton
                                            aria-label="Collapse linked context"
                                            aria-expanded="true"
                                            size="sm"
                                            onClick={() => setContextPanelCollapsed(true)}
                                            title="Collapse Linked Context"
                                            className="nemoto-journal-context-toggle"
                                        >
                                            <ChevronRight size={15} />
                                        </NemotoPanelIconButton>
                                    </div>
                                </div>
                                {selectedEntry ? (
                                    <div className="px-4 pb-4 pt-1">
                                        <LinkedEntitiesSection linkedContext={selectedEntry.linkedContext || []} onUnlink={(entityId) => {
                                            const { unlinkContext } = useJournalStore.getState();
                                            unlinkContext(selectedEntry.id, entityId);
                                        }} />
                                    </div>
                                ) : (
                                    <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-text-faint">
                                        Select a note to view context
                                    </div>
                                )}
                            </div>
                        )}
                    </aside>
                </div>
            )}
                </>
            )}

            {entityPickerOpen && selectedEntry && (
                <EntityPickerModal
                    onClose={() => setEntityPickerOpen(false)}
                    onSelect={(entityRef) => {
                        linkContext(selectedEntry.id, entityRef);
                        setEntityPickerOpen(false);
                    }}
                />
            )}

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    type={contextMenu.type}
                    onDelete={handleDeleteFromMenu}
                    onRename={handleRename}
                    onExpandAll={handleExpandAll}
                    onCollapseAll={handleCollapseAll}
                    onClose={() => setContextMenu(null)}
                />
            )}
            {confirmDialog && (
                <ConfirmationModal
                    isOpen={confirmDialog.isOpen}
                    onClose={() => setConfirmDialog(null)}
                    onConfirm={confirmDialog.onConfirm}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    variant={confirmDialog.variant}
                />
            )}
        </div>
    );
}
