import { canvasPanOrigin, constrainCanvasPan } from '../../lib/canvasPanBounds';
import { useElasticCanvasPan } from './useElasticCanvasPan';
import { membershipAt } from '../../lib/canvasDivision';
import { GRAPH_NAVIGATION } from '../../lib/graphNavigation';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { generateId } from '../../lib/id';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useTheme } from '../../context/ThemeContext';
import ReactFlow, {
    Connection,
    Background,
    BackgroundVariant,
    useReactFlow,
    Node as FlowNode,
    Edge as FlowEdge,
    SelectionMode,
    type DefaultEdgeOptions,
    type SnapGrid,
    type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { CanvasNode } from '../../types';
import { openOrCreateNodeDrilldown } from '../../lib/drilldown';
import { getSmartHandles } from '../../lib/smartHandles';

import { CANVAS_EDGE_TYPES, toFlowEdge, toFlowNode } from './flowConfiguration';

import CanvasContextMenu from './CanvasContextMenu';
import { useCanvasRecordIndicators } from './contextualRecordState';
import { coreEntityReference } from '../../plugins/universalReference';
import { LINKED_CONTENT_NODE_TYPES, buildNodeLinkedContent } from './NodeLinkedContent';
import { duplicateCanvasSelection, copyCanvasSelection, pasteCanvasSelection } from './duplicateCanvasSelection';
import { NemotoButton } from '../ui';

const DEFAULT_CANVAS_VIEWPORT: Viewport = { x: 0, y: 16, zoom: 1 };
const STANDARD_SNAP_GRID: SnapGrid = [16, 16];
const HARD_THEME_SNAP_GRID: SnapGrid = [32, 32];
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true } as const;
const DEFAULT_CANVAS_EDGE_OPTIONS: DefaultEdgeOptions = {
    type: 'custom',
    animated: false,
    style: { stroke: 'var(--color-text-faint)', strokeWidth: 1.5 },
};

function CanvasContent() {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();
    const { theme } = useTheme();
    const gridVisible = useSettingsStore(state => state.canvasGridVisible);
    const linksVisible = useSettingsStore(state => state.canvasLinksVisible);
    const assets = usePortfolioStore(state => state.portfolio.assets);
    const journalEntries = usePortfolioStore(state => state.portfolio.journal.entries);

    // Global UI State. Keep this selector narrow: unrelated panel state should not
    // force the entire controlled canvas to render again.
    const { setDraggedAsset, inspectCanvasSelection, clearCanvasInspection, editingNodeId } = useUIStore(
        useShallow(state => ({
            setDraggedAsset: state.setDraggedAsset,
            inspectCanvasSelection: state.inspectCanvasSelection,
            clearCanvasInspection: state.clearCanvasInspection,
            editingNodeId: state.editingNodeId,
        })),
    );

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

    // Use shallow comparison to prevent unnecessary re-renders
    const { graph: activeGraph, previewGraph, selectedNodeIds, selectedEdgeIds, selectElements, addEdge: addCanvasEdge, addNode, onNodesChange: onNodesChangeHandler, onEdgesChange: onEdgesChangeHandler, updateNodes, removeElements, updateEdge, setPreviewGraph, lastEdgeType, setViewport } = useCanvasStore(
        useShallow((state) => ({
            graph: state.graph,
            previewGraph: state.previewGraph,
            selectedNodeIds: state.selectedNodeIds,
            selectedEdgeIds: state.selectedEdgeIds,
            selectElements: state.selectElements,
            addEdge: state.addEdge,
            addNode: state.addNode,
            onNodesChange: state.onNodesChange,
            onEdgesChange: state.onEdgesChange,
            updateNodes: state.updateNodes,
            removeElements: state.removeElements,
            updateEdge: state.updateEdge,
            setPreviewGraph: state.setPreviewGraph,
            lastEdgeType: state.lastEdgeType,
            setViewport: state.setViewport
        }))
    );

    // Determine which graph to display
    const graph = previewGraph || activeGraph;
    const isPreview = !!previewGraph;
    const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
    const selectedEdgeIdSet = useMemo(() => new Set(selectedEdgeIds), [selectedEdgeIds]);

    // Stable node/edge cache to prevent ReactFlow from detecting changes when only references change
    const nodeCache = useRef<Map<string, FlowNode>>(new Map());
    const edgeCache = useRef<Map<string, FlowEdge>>(new Map());
    const previousNodesArray = useRef<FlowNode[]>([]);
    const previousEdgesArray = useRef<FlowEdge[]>([]);
    // Stable refs for injected synthetic nodes (prevents infinite re-renders)
    const stackNodeRef = useRef<FlowNode | null>(null);

    // Get active process mode
    const activeProcessId = useProcessSessionStore(s => s.activeProcessId);
    const process = usePortfolioStore(s => s.portfolio.processes.find(p => p.id === activeProcessId));
    // Prefer the local graph's mode (for subprocesses), fallback to process mode, then default.
    const mode = graph.mode || process?.mode || 'swimlane';

    // Reset all caches when the active process changes so the new graph
    // is never returned as a stale cached result.
    useEffect(() => {
        nodeCache.current = new Map();
        edgeCache.current = new Map();
        previousNodesArray.current = [];
        previousEdgesArray.current = [];
        stackNodeRef.current = null;
    }, [activeProcessId]);

    const visibleNodeReferences = useMemo(() => activeProcessId
        ? graph.nodes.map(node => coreEntityReference('core.node', node.id, { processId: activeProcessId }))
        : [], [activeProcessId, graph.nodes]);
    const recordIndicators = useCanvasRecordIndicators(visibleNodeReferences, linksVisible && !isPreview);
    const linkedContent = useMemo(() => buildNodeLinkedContent(
        graph.nodes, assets, journalEntries, activeProcessId, linksVisible && !isPreview, recordIndicators,
    ), [graph.nodes, assets, journalEntries, activeProcessId, linksVisible, isPreview, recordIndicators]);

    const nodes = useMemo(() => {
        const newCache = new Map<string, FlowNode>();

        // 1. Process User Nodes (with caching)
        const userNodes = graph.nodes.map(node => {
            const cached = nodeCache.current.get(node.id);
            const newNode = toFlowNode(node, !isPreview && selectedNodeIdSet.has(node.id));
            // View-only projection: never trust a payload-provided indicator or persist it.
            newNode.data.linkedContent = linkedContent.get(node.id) ?? null;

            if (cached &&
                cached.position.x === newNode.position.x &&
                cached.position.y === newNode.position.y &&
                cached.width === newNode.width &&
                cached.height === newNode.height &&
                cached.selected === newNode.selected &&
                JSON.stringify(cached.data) === JSON.stringify(newNode.data)) {
                newCache.set(node.id, cached);
                return cached;
            }

            newCache.set(node.id, newNode);
            return newNode;
        });

        // 2. Create/reuse the Swimlane Stack node (stable ref, update data when swimlanes change)
        let stackNode: FlowNode | null = null;
        const prev = stackNodeRef.current;
        if (!prev || prev.data.source !== graph || prev.data.readOnly !== isPreview) {
            stackNodeRef.current = {
                id: 'swimlane-stack', type: 'swimlane-stack', position: { x: 0, y: 0 },
                data: { graph: { ...graph, mode }, readOnly: isPreview, source: graph },
                selectable: false, focusable: false, draggable: false, zIndex: -1,
            };
        }
        stackNode = stackNodeRef.current;

        // 3. Build final array and cache
        nodeCache.current = newCache;
        const finalNodes: FlowNode[] = [];
        if (stackNode) finalNodes.push(stackNode);
        finalNodes.push(...userNodes);

        // Array reference caching â€” stable references mean this check now works correctly
        if (previousNodesArray.current.length === finalNodes.length &&
            previousNodesArray.current.every((node, i) => node === finalNodes[i])) {
            return previousNodesArray.current;
        }

        previousNodesArray.current = finalNodes;
        return finalNodes;
    }, [graph, mode, activeProcessId, isPreview, selectedNodeIdSet, linkedContent]);

    const edges = useMemo(() => {
        const newCache = new Map<string, FlowEdge>();

        const result = graph.edges.map(edge => {
            const cached = edgeCache.current.get(edge.id);
            const newEdge = toFlowEdge(edge, !isPreview && selectedEdgeIdSet.has(edge.id), graph.nodes);

            // Reuse if identical
            if (cached && JSON.stringify(cached) === JSON.stringify(newEdge)) {
                newCache.set(edge.id, cached);
                return cached;
            }

            newCache.set(edge.id, newEdge);
            return newEdge;
        });

        edgeCache.current = newCache;

        // Same array caching for edges
        if (previousEdgesArray.current.length === result.length &&
            previousEdgesArray.current.every((edge, i) => edge === result[i])) {
            return previousEdgesArray.current;
        }

        previousEdgesArray.current = result;
        return result;
    }, [graph.edges, graph.nodes, isPreview, selectedEdgeIdSet]);

    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

    // Space key state for panning override
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const dragStartNodesRef = useRef<Map<string, { position: CanvasNode['position']; swimlaneId?: string | null }>>(new Map());

    // Keyboard shortcuts (Delete, Undo, Redo, Space Pan)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isInput = event.target instanceof Element && !!event.target.closest(
                'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
            );
            const canvasOwnsKeyboard = !!reactFlowWrapper.current?.contains(document.activeElement);

            // 1. Space Panning Override
            if (event.code === 'Space' && !isInput && canvasOwnsKeyboard) {
                // Prevent scrolling page or triggering buttons
                if (!isSpacePressed) setIsSpacePressed(true);
            }

            // Preview displays a different graph, while the editable graph and its
            // history remain in the store. Never dispatch its editing or clipboard
            // commands from preview; Space-pan above remains available.
            if (useCanvasStore.getState().previewGraph) return;

            if (event.key.toLowerCase() === 'd' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
                if (isInput || !canvasOwnsKeyboard || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
                event.preventDefault();
                if (!event.repeat) duplicateCanvasSelection();
                return;
            }

            // 2. Delete / Backspace
            if (event.key === 'Delete' || event.key === 'Backspace') {
                if (isInput || !canvasOwnsKeyboard) return;
                event.preventDefault();

                // Read fresh state from store to avoid stale closures in useEffect
                const { selectedNodeIds, selectedEdgeIds } = useCanvasStore.getState();
                if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;

                removeElements(selectedNodeIds, selectedEdgeIds);
                useUIStore.getState().clearCanvasInspection();
            }

            // Select all nodes when the canvas owns keyboard focus.
            if (event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
                if (isInput || isPreview || !canvasOwnsKeyboard) return;
                event.preventDefault();

                const { graph, selectElements } = useCanvasStore.getState();
                selectElements(graph.nodes.map(node => node.id), []);
                useUIStore.getState().inspectCanvasSelection();
            }

            // 3. Undo (Ctrl + Z)
            if (event.key === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
                if (isInput || !canvasOwnsKeyboard) return;
                event.preventDefault();
                const history = useCanvasStore.temporal.getState();
                if (history.pastStates.length > 0) history.undo();
            }

            // 4. Redo (Ctrl + Y or Ctrl + Shift + Z)
            if (
                ((event.key === 'y' && (event.ctrlKey || event.metaKey)) ||
                    (event.key === 'z' && (event.ctrlKey || event.metaKey) && event.shiftKey))
            ) {
                if (isInput || !canvasOwnsKeyboard) return;
                event.preventDefault();
                const history = useCanvasStore.temporal.getState();
                if (history.futureStates.length > 0) history.redo();
            }

            // 5. Copy (Ctrl + C)
            if (event.key === 'c' && (event.ctrlKey || event.metaKey)) {
                if (isInput || !canvasOwnsKeyboard) return;
                event.preventDefault(); // Prevent browser copy
                copyCanvasSelection();
            }

            // 6. Paste (Ctrl + V)
            if (event.key === 'v' && (event.ctrlKey || event.metaKey)) {
                if (isInput || !canvasOwnsKeyboard) return;
                event.preventDefault(); // Prevent browser paste
                pasteCanvasSelection();
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === 'Space') {
                setIsSpacePressed(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isSpacePressed, isPreview, removeElements]);

    const applySelectionChanges = useCallback((nodeChanges: any[] = [], edgeChanges: any[] = []) => {
        if (nodeChanges.length === 0 && edgeChanges.length === 0) return;

        const canvas = useCanvasStore.getState();
        const nextNodeIds = new Set(canvas.selectedNodeIds);
        const nextEdgeIds = new Set(canvas.selectedEdgeIds);

        nodeChanges.forEach(change => {
            if (change.selected) nextNodeIds.add(change.id);
            else nextNodeIds.delete(change.id);
        });
        edgeChanges.forEach(change => {
            if (change.selected) nextEdgeIds.add(change.id);
            else nextEdgeIds.delete(change.id);
        });

        canvas.selectElements(Array.from(nextNodeIds), Array.from(nextEdgeIds));
        if (nextNodeIds.size > 0 || nextEdgeIds.size > 0) {
            inspectCanvasSelection();
            return;
        }

        // Selecting a connection can deselect a node immediately before the edge
        // selection arrives. Wait until that same click has finished before closing.
        queueMicrotask(() => {
            const latest = useCanvasStore.getState();
            if (latest.selectedNodeIds.length === 0 && latest.selectedEdgeIds.length === 0) {
                useUIStore.getState().clearCanvasInspection();
            }
        });
    }, [inspectCanvasSelection]);

    const handleNodesChange = useCallback((changes: any[]) => {
        const selectionChanges = changes.filter(change => change.id !== 'swimlane-stack' && change.type === 'select');
        applySelectionChanges(selectionChanges, []);

        const filtered = changes.filter(change =>
            change.id !== 'swimlane-stack' && (change.type === 'position' ||
            change.type === 'remove')
        );
        if (filtered.length > 0) {
            onNodesChangeHandler(filtered);
        }
    }, [applySelectionChanges, onNodesChangeHandler]);

    const handleEdgesChange = useCallback((changes: any[]) => {
        const selectionChanges = changes.filter(change => change.type === 'select');
        applySelectionChanges([], selectionChanges);

        // Keep destructive changes durable without writing transient selection into the graph.
        const filtered = changes.filter(change => change.type === 'remove');
        if (filtered.length > 0) {
            onEdgesChangeHandler(filtered);
        }
    }, [applySelectionChanges, onEdgesChangeHandler]);

    const onConnect = useCallback(
        (connection: Connection) => {
            if (connection.source && connection.target) {
                let sourceHandleId = connection.sourceHandle || undefined;
                let targetHandleId = connection.targetHandle || undefined;

                if (!sourceHandleId || !targetHandleId) {
                    const canvasNodes = useCanvasStore.getState().graph.nodes;
                    const src = canvasNodes.find(n => n.id === connection.source);
                    const tgt = canvasNodes.find(n => n.id === connection.target);
                    if (src && tgt) {
                        const smart = getSmartHandles(src, tgt);
                        if (!sourceHandleId) sourceHandleId = smart.sourceHandleId;
                        if (!targetHandleId) targetHandleId = smart.targetHandleId;
                    }
                }

                addCanvasEdge({
                    id: generateId('edge'),
                    sourceId: connection.source,
                    targetId: connection.target,
                    sourceHandleId,
                    targetHandleId,
                    style: 'solid',
                    type: lastEdgeType // Use persistent choice
                });
            }
        },
        [addCanvasEdge, lastEdgeType]
    );

    // --- EDGE RECONNECT (drag endpoint to new handle) ---
    const edgeReconnectSuccessful = useRef(true);

    const onEdgeUpdateStart = useCallback(() => {
        edgeReconnectSuccessful.current = false;
    }, []);

    const onEdgeUpdate = useCallback(
        (oldEdge: FlowEdge, newConnection: Connection) => {
            edgeReconnectSuccessful.current = true;
            let sourceHandleId = newConnection.sourceHandle || undefined;
            let targetHandleId = newConnection.targetHandle || undefined;

            if (!sourceHandleId || !targetHandleId) {
                const canvasNodes = useCanvasStore.getState().graph.nodes;
                const src = canvasNodes.find(n => n.id === newConnection.source);
                const tgt = canvasNodes.find(n => n.id === newConnection.target);
                if (src && tgt) {
                    const smart = getSmartHandles(src, tgt);
                    if (!sourceHandleId) sourceHandleId = smart.sourceHandleId;
                    if (!targetHandleId) targetHandleId = smart.targetHandleId;
                }
            }

            // Update existing edge with new source/target
            updateEdge(oldEdge.id, {
                sourceId: newConnection.source!,
                targetId: newConnection.target!,
                sourceHandleId,
                targetHandleId,
            });
        },
        [updateEdge]
    );

    const onEdgeUpdateEnd = useCallback(
        (_event: MouseEvent | TouchEvent, _edge: FlowEdge) => {
            // Keep edge intact if dropped in open canvas without valid handle
            edgeReconnectSuccessful.current = true;
        },
        []
    );

    const onNodeContextMenu = useCallback(
        (event: React.MouseEvent, node: FlowNode) => {
            event.preventDefault();
            setContextMenu({
                x: event.clientX,
                y: event.clientY,
                nodeId: node.id,
            });
        },
        []
    );

    const onPaneClick = useCallback(() => {
        // Clear selection and close inspector when clicking background
        selectElements([], []);
        clearCanvasInspection();
        setContextMenu(null);
    }, [clearCanvasInspection, selectElements]);

    // Track node hover for linking (exclude swimlane-stack)
    const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: FlowNode) => {
        if (node.id === 'swimlane-stack') return; // Ignore swimlane background
        setHoveredNodeId(node.id);
    }, []);

    const onNodeMouseLeave = useCallback(() => {
        setHoveredNodeId(null);
    }, []);

    // --- TEMPORAL OPTIMIZATION: Pause history during dragging ---
    const onNodeDragStart = useCallback((_event: React.MouseEvent, node: FlowNode, draggedNodes: FlowNode[]) => {
        const currentGraph = useCanvasStore.getState().graph;
        const draggedIds = new Set(
            (draggedNodes.length > 0 ? draggedNodes : [node]).map(draggedNode => draggedNode.id),
        );

        dragStartNodesRef.current = new Map(
            currentGraph.nodes
                .filter(canvasNode => draggedIds.has(canvasNode.id))
                .map(canvasNode => [
                    canvasNode.id,
                    {
                        position: { ...canvasNode.position },
                        swimlaneId: canvasNode.swimlaneId,
                    },
                ]),
        );
        useCanvasStore.temporal.getState().pause();
    }, []);

    const onNodeDragStop = useCallback((_event: React.MouseEvent, node: FlowNode, draggedNodes: FlowNode[]) => {
        const temporalStore = useCanvasStore.temporal.getState();
        const startNodes = dragStartNodesRef.current;

        try {
            if (!node?.id) return;

            const currentGraph = useCanvasStore.getState().graph;
            const finalFlowNodes = draggedNodes.length > 0 ? draggedNodes : [node];
            const finalPositions = new Map(
                finalFlowNodes.map(draggedNode => [
                    draggedNode.id,
                    { x: draggedNode.position.x, y: draggedNode.position.y },
                ]),
            );

            // React Flow emits live position updates while history is paused. Restore the
            // drag-start positions before resuming, then commit every final position in one set.
            // This makes the whole group movement one undoable operation.
            updateNodes(Array.from(startNodes, ([id, startNode]) => ({
                id,
                updates: {
                    position: startNode.position,
                    swimlaneId: startNode.swimlaneId,
                },
            })));

            temporalStore.resume();

            updateNodes(Array.from(startNodes.keys(), id => {
                const currentNode = currentGraph.nodes.find(canvasNode => canvasNode.id === id);
                const position = finalPositions.get(id) ?? currentNode?.position ?? startNodes.get(id)!.position;
                return {
                    id,
                    updates: {
                        position,
                        ...membershipAt({ ...currentGraph, mode }, position),
                    },
                };
            }));
        } finally {
            temporalStore.resume();
            dragStartNodesRef.current = new Map();
        }
    }, [graph.swimlanes, mode, updateNodes]);

    // --- STATE-BASED DROP HANDLER (Global listener to catch drops inside ReactFlow) ---
    useEffect(() => {
        const handleMouseUp = (event: MouseEvent) => {
            const asset = useUIStore.getState().draggedAsset;

            if (!asset || !reactFlowWrapper.current) return;

            // Check if drop is inside canvas area
            const rect = reactFlowWrapper.current.getBoundingClientRect();
            if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
            ) {
                return; // Drop outside canvas, let DragOverlay handle cleanup
            }

            // Determine drop position in flow coordinates
            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            // If dropping ON a node -> LINK (but not on swimlane-stack)
            if (hoveredNodeId && hoveredNodeId !== 'swimlane-stack') {
                useCanvasStore.setState(state => ({
                    graph: {
                        ...state.graph,
                        nodes: state.graph.nodes.map(n => {
                            if (n.id === hoveredNodeId) {
                                const currentAssets = n.assetIds || [];
                                if (currentAssets.includes(asset.id)) return n;
                                return { ...n, assetIds: [...currentAssets, asset.id] };
                            }
                            return n;
                        })
                    }
                }));
            }
            // If dropping on Canvas -> CREATE RESOURCE REFERENCE NODE
            else {
                const newNode: CanvasNode = {
                    id: generateId('node'),
                    type: 'resource',
                    position,
                    label: null,
                    assetIds: [asset.id]
                };

                addNode(newNode);
            }

            setDraggedAsset(null);
            document.body.style.cursor = 'default';
            setHoveredNodeId(null);
        };

        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [screenToFlowPosition, addNode, setDraggedAsset, hoveredNodeId]);

    // --- DRILLDOWN: Alt+DoubleClick to navigate into node drilldown ---
    const onNodeDoubleClick = useCallback(
        (event: React.MouseEvent, node: FlowNode) => {
            if (!event.altKey) return;

            openOrCreateNodeDrilldown(node.id, graph);
        },
        [graph]
    );

    // --- SELECTION HANDLER: Treat special synthetic nodes correctly ---
    const onNodeClick = useCallback(
        (_event: React.MouseEvent, node: FlowNode) => {
            if (node.id === 'swimlane-stack') {
                // Clicking the swimlane background = deselect everything
                onPaneClick();
                return;
            }

            const selection = useCanvasStore.getState();
            if (selection.selectedNodeIds.includes(node.id)) {
                inspectCanvasSelection();
            } else {
                clearCanvasInspection();
            }
        },
        [clearCanvasInspection, inspectCanvasSelection, onPaneClick]
    );

    const onEdgeClick = useCallback((_event: React.MouseEvent, edge: FlowEdge) => {
        // Selecting an SVG edge must hand keyboard ownership back to canvas,
        // even when the preceding interaction was in the inspector.
        reactFlowWrapper.current?.focus({ preventScroll: true });
        const selection = useCanvasStore.getState();
        if (selection.selectedEdgeIds.includes(edge.id)) {
            inspectCanvasSelection();
        } else {
            clearCanvasInspection();
        }
    }, [clearCanvasInspection, inspectCanvasSelection]);

    const onCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target;
        // Portal events still travel through the React tree. A context menu is
        // outside the canvas DOM: focusing canvas here dismisses it before click.
        if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
        const preservesOwnFocus = target instanceof Element && target.closest(
            'input, textarea, [contenteditable]:not([contenteditable="false"]), .nodrag',
        );
        if (preservesOwnFocus) return;

        event.currentTarget.focus({ preventScroll: true });
    }, []);

    const panOrigin = canvasPanOrigin(graph);
    const persistViewport = useCallback((viewport: Viewport) => {
        if (!isPreview) setViewport(viewport);
    }, [setViewport, isPreview]);
    const panScope = useProcessSessionStore(s => `${s.portfolioGeneration}:${s.activeProcessId}:${s.breadcrumbStack.join('/')}`);
    const elasticPan = useElasticCanvasPan(panOrigin, persistViewport, `${panScope}:${isPreview}`);

    return (
        <div
            ref={reactFlowWrapper}
            className="nemoto-process-canvas absolute inset-0 bg-app-bg"
            aria-label="Process canvas"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
                if (useCanvasStore.getState().previewGraph) return;
                const target = event.target;
                if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
                const focusedNode = target.closest<HTMLElement>('.react-flow__node');
                const selection = useCanvasStore.getState().selectedNodeIds;
                const nodeId = focusedNode?.dataset.id ?? (selection.length === 1 ? selection[0] : undefined);
                if (!nodeId || !useCanvasStore.getState().graph.nodes.some(node => node.id === nodeId)) return;
                event.preventDefault();
                event.stopPropagation();
                const anchor = focusedNode ?? Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.react-flow__node'))
                    .find(node => node.dataset.id === nodeId) ?? event.currentTarget;
                const bounds = anchor.getBoundingClientRect();
                setContextMenu({ nodeId, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
            }}
            onPointerDownCapture={onCanvasPointerDown}
            onContextMenu={() => {
                // Prevent default header context menu if clicking on empty canvas (optional, but good for consistency)
                // e.preventDefault(); 
                // Currently we only handle node context menu.
            }}
        >
            {isPreview && (
                <div className="absolute top-4 left-1/2 z-50 bg-accent-primary text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 nemoto-motion-feedback-top-centered pointer-events-auto">
                    <div className="flex flex-col">
                        <span className="font-bold text-sm tracking-wide">PREVIEW MODE</span>
                        <span className="text-[10px] opacity-80">Read-only view of imported process</span>
                    </div>
                    <div className="h-6 w-[1px] bg-app-active"></div>
                    <div className="flex gap-2">
                        <NemotoButton
                            size="sm"
                            onClick={() => {
                                setPreviewGraph(null);
                            }}
                            className="px-3 py-1.5 bg-app-hover hover:bg-app-active rounded text-xs font-medium transition-colors"
                        >
                            Exit Preview
                        </NemotoButton>
                    </div>
                </div>
            )}

            <ReactFlow
                className="nemoto-division-canvas"
                {...GRAPH_NAVIGATION}
                nodes={nodes}
                edges={edges}
                nodeTypes={LINKED_CONTENT_NODE_TYPES}
                edgeTypes={CANVAS_EDGE_TYPES}
                onNodesChange={isPreview ? undefined : handleNodesChange}
                onEdgesChange={isPreview ? undefined : handleEdgesChange}
                onConnect={isPreview ? undefined : onConnect}
                onEdgeUpdate={isPreview ? undefined : onEdgeUpdate}
                onEdgeUpdateStart={isPreview ? undefined : onEdgeUpdateStart}
                onEdgeUpdateEnd={isPreview ? undefined : onEdgeUpdateEnd}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseLeave={onNodeMouseLeave}
                onNodeDoubleClick={isPreview ? undefined : onNodeDoubleClick}
                onNodeContextMenu={isPreview ? undefined : onNodeContextMenu}
                onNodeDragStart={isPreview ? undefined : onNodeDragStart}
                onNodeDragStop={isPreview ? undefined : onNodeDragStop}
                onPaneClick={onPaneClick}
                onNodeClick={onNodeClick}
                onEdgeClick={isPreview ? undefined : onEdgeClick}
                {...elasticPan}
                edgesUpdatable={!isPreview}
                edgesFocusable={!isPreview}
                deleteKeyCode={null}
                nodesConnectable={!isPreview}
                elementsSelectable={!isPreview}
                onlyRenderVisibleElements
                proOptions={REACT_FLOW_PRO_OPTIONS}
                defaultViewport={constrainCanvasPan(graph.viewport ?? { ...DEFAULT_CANVAS_VIEWPORT, y: 16 - panOrigin.y }, panOrigin)}
                minZoom={0.2}
                maxZoom={2}
                nodesDraggable={!isPreview && !isSpacePressed && editingNodeId === null}
                translateExtent={undefined}
                nodeExtent={undefined}
                snapToGrid={true}
                snapGrid={theme === 'hard' ? HARD_THEME_SNAP_GRID : STANDARD_SNAP_GRID}
                selectionOnDrag={!isPreview}
                selectionKeyCode={null}
                selectionMode={SelectionMode.Partial}
                multiSelectionKeyCode={['Control', 'Meta']}
                panOnDrag={[1]}
                panActivationKeyCode="Space"
                connectionRadius={40}
                edgeUpdaterRadius={20}
                defaultEdgeOptions={DEFAULT_CANVAS_EDGE_OPTIONS}
            >
                {/* Single Background Strategy: Controlled by React logic to prevent CSS override issues */}
                {gridVisible && <Background
                    id="canvas-bg"
                    color="var(--color-app-grid)"
                    gap={theme === 'hard' ? 32 : 24}
                    size={theme === 'hard' ? 1 : 2}
                    variant={theme === 'hard' ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                />}
            </ReactFlow>

            {contextMenu && (
                <CanvasContextMenu
                    nodeId={contextMenu.nodeId}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}

export default function Canvas() {
    return (
        <CanvasContent />
    );
}
