import { migrateDivision, laneAxis, type DivisionAxis } from '../lib/canvasDivision';
import { create } from 'zustand';
import { useProcessSessionStore } from './useProcessSessionStore';
import { canvasLocationFromSession, type CanvasLocation } from './canvasLocation';
import { generateId } from '../lib/id';
import { temporal } from 'zundo';
import { applyNodeChanges, applyEdgeChanges } from 'reactflow';
import type { CanvasGraph, CanvasNode, CanvasEdge, Position, Swimlane } from '../types';

function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => valuesEqual(value, right[index]));
    }

    if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
        return false;
    }

    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every(key => (
        Object.prototype.hasOwnProperty.call(rightRecord, key)
        && valuesEqual(leftRecord[key], rightRecord[key])
    ));
}

function graphEntitiesEqual(
    left: Array<Record<string, unknown>>,
    right: Array<Record<string, unknown>>,
): boolean {
    if (left.length !== right.length) return false;

    return left.every((entity, index) => {
        const other = right[index];
        if (!other) return false;

        const leftKeys = Object.keys(entity).filter(key => key !== 'selected');
        const rightKeys = Object.keys(other).filter(key => key !== 'selected');
        if (leftKeys.length !== rightKeys.length) return false;

        return leftKeys.every(key => (
            Object.prototype.hasOwnProperty.call(other, key)
            && valuesEqual(entity[key], other[key])
        ));
    });
}

function durableGraphsEqual(left: CanvasGraph | undefined, right: CanvasGraph | undefined): boolean {
    if (Object.is(left, right)) return true;
    if (!left || !right) return false;

    const leftGraph = left as unknown as Record<string, unknown>;
    const rightGraph = right as unknown as Record<string, unknown>;
    const leftKeys = Object.keys(leftGraph);
    const rightKeys = Object.keys(rightGraph);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every(key => {
        if (!Object.prototype.hasOwnProperty.call(rightGraph, key)) return false;
        if (key === 'nodes' || key === 'edges') {
            return graphEntitiesEqual(
                leftGraph[key] as Array<Record<string, unknown>>,
                rightGraph[key] as Array<Record<string, unknown>>,
            );
        }
        return valuesEqual(leftGraph[key], rightGraph[key]);
    });
}

// Extend Viewport type locally if not in shared types yet
export interface ViewportState {
    x: number;
    y: number;
    zoom: number;
}

interface CanvasState {
    graph: CanvasGraph;
    loadedLocation: CanvasLocation | null;
    copiedSubGraphs: Record<string, CanvasGraph>;
    viewport: ViewportState;
    selectedNodeIds: string[];
    selectedEdgeIds: string[];
    graphLoadRevision: number;
    lastEdgeType: 'default' | 'straight' | 'step' | 'smoothstep';

    // Actions
    loadGraph: (graph: CanvasGraph, location?: CanvasLocation | null) => void;
    setViewport: (viewport: ViewportState) => void;
    selectNodes: (ids: string[]) => void;
    selectEdges: (ids: string[]) => void;
    selectElements: (nodeIds: string[], edgeIds: string[]) => void;
    moveNode: (id: string, position: Position) => void;
    addNode: (node: CanvasNode) => void;
    updateNode: (id: string, updates: Partial<CanvasNode>) => void;
    updateNodes: (updates: Array<{ id: string; updates: Partial<CanvasNode> }>) => void;
    removeElements: (nodeIds: string[], edgeIds: string[]) => void;
    addEdge: (edge: CanvasEdge) => void;
    updateEdge: (id: string, updates: Partial<CanvasEdge>) => void;
    removeEdge: (id: string) => void;
    setLastEdgeType: (type: 'default' | 'straight' | 'step' | 'smoothstep') => void;

    // Swimlane Actions
    addSwimlane: (label: string, color: string, axis?: DivisionAxis) => void;
    setDivisionVisible: (axis: DivisionAxis, visible: boolean) => void;
    updateSwimlane: (id: string, updates: Partial<Swimlane>) => void;
    reorderSwimlanes: (ids: string[]) => void;
    moveSwimlane: (id: string, direction: 'up' | 'down') => void;
    removeSwimlane: (id: string) => void;

    // ReactFlow specific handlers
    onNodesChange: (changes: any[]) => void;
    onEdgesChange: (changes: any[]) => void;

    // Preview Mode
    previewGraph: CanvasGraph | null;
    setPreviewGraph: (graph: CanvasGraph | null) => void;

    clearHistory?: () => void; // Added by zundo
}

export const useCanvasStore = create<CanvasState>()(
    temporal(
        (set) => ({
            graph: { nodes: [], edges: [], swimlanes: [] },
            loadedLocation: null,
            copiedSubGraphs: {},
            viewport: { x: 0, y: 0, zoom: 1 },
            selectedNodeIds: [],
            selectedEdgeIds: [],
            graphLoadRevision: 0,
            lastEdgeType: 'default',
            previewGraph: null,

            loadGraph: (graph, location = canvasLocationFromSession(useProcessSessionStore.getState())) => {
                const temporalStore = useCanvasStore.temporal.getState();
                const wasTracking = temporalStore.isTracking;
                temporalStore.pause();

                const detachedGraph = structuredClone(graph);
                set((state) => ({
                    graph: {
                        ...detachedGraph,
                        nodes: detachedGraph.nodes.map(({ selected: _selected, ...node }) => node as CanvasNode),
                        edges: detachedGraph.edges.map(({ selected: _selected, ...edge }) => edge as CanvasEdge),
                    },
                    previewGraph: null,
                    loadedLocation: location,
                    copiedSubGraphs: {},
                    viewport: detachedGraph.viewport || { x: 0, y: 16, zoom: 1 },
                    selectedNodeIds: [],
                    selectedEdgeIds: [],
                    graphLoadRevision: state.graphLoadRevision + 1,
                }));

                // A loaded graph starts a new editing session. Undo must never cross
                // a process or drilldown boundary.
                temporalStore.clear();
                if (wasTracking) temporalStore.resume();
            },
            setViewport: (viewport) => set((state) => (
                state.viewport.x === viewport.x
                && state.viewport.y === viewport.y
                && state.viewport.zoom === viewport.zoom
                    ? state
                    : { viewport }
            )),

            selectNodes: (ids) => set((state) => (
                state.selectedNodeIds.length === ids.length
                && state.selectedNodeIds.every((id, index) => id === ids[index])
                    ? state
                    : { selectedNodeIds: ids }
            )),

            selectEdges: (ids) => set((state) => (
                state.selectedEdgeIds.length === ids.length
                && state.selectedEdgeIds.every((id, index) => id === ids[index])
                    ? state
                    : { selectedEdgeIds: ids }
            )),

            selectElements: (nodeIds, edgeIds) => set((state) => {
                const nodesUnchanged = state.selectedNodeIds.length === nodeIds.length
                    && state.selectedNodeIds.every((id, index) => id === nodeIds[index]);
                const edgesUnchanged = state.selectedEdgeIds.length === edgeIds.length
                    && state.selectedEdgeIds.every((id, index) => id === edgeIds[index]);
                return nodesUnchanged && edgesUnchanged
                    ? state
                    : { selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds };
            }),

            moveNode: (id, position) => set((state) => ({
                graph: {
                    ...state.graph,
                    nodes: state.graph.nodes.map((n) =>
                        n.id === id ? { ...n, position } : n
                    ),
                },
            })),

            addNode: (node) => set((state) => {
                const { selected, ...persistedNode } = node;
                return {
                graph: { ...state.graph, nodes: [...state.graph.nodes, persistedNode as CanvasNode] },
                // Sync selectedNodeIds if node is added in selected state
                selectedNodeIds: selected ? [node.id] : state.selectedNodeIds
            }}),

            updateNode: (id, updates) => set((state) => ({
                graph: {
                    ...state.graph,
                    nodes: state.graph.nodes.map((n) =>
                        n.id === id ? { ...n, ...updates } : n
                    ),
                },
            })),

            updateNodes: (updates) => set((state) => {
                if (updates.length === 0) return state;

                const updatesById = new Map(updates.map(update => [update.id, update.updates]));
                return {
                    graph: {
                        ...state.graph,
                        nodes: state.graph.nodes.map(node => {
                            const nodeUpdates = updatesById.get(node.id);
                            return nodeUpdates ? { ...node, ...nodeUpdates } : node;
                        }),
                    },
                };
            }),

            removeElements: (nodeIds, edgeIds) => set((state) => {
                const nodeIdsToRemove = new Set(nodeIds);
                const edgeIdsToRemove = new Set(edgeIds);
                const nodes = state.graph.nodes.filter(node => !nodeIdsToRemove.has(node.id));
                const edges = state.graph.edges.filter(edge => (
                    !edgeIdsToRemove.has(edge.id)
                    && !nodeIdsToRemove.has(edge.sourceId)
                    && !nodeIdsToRemove.has(edge.targetId)
                ));

                if (nodes.length === state.graph.nodes.length && edges.length === state.graph.edges.length) {
                    return state;
                }

                return {
                    graph: { ...state.graph, nodes, edges },
                    selectedNodeIds: state.selectedNodeIds.filter(id => !nodeIdsToRemove.has(id)),
                    selectedEdgeIds: state.selectedEdgeIds.filter(id => (
                        !edgeIdsToRemove.has(id) && edges.some(edge => edge.id === id)
                    )),
                };
            }),

            addEdge: (edge) => set((state) => ({
                graph: { ...state.graph, edges: [...state.graph.edges, edge] },
            })),

            removeEdge: (id) => set((state) => ({
                graph: {
                    ...state.graph,
                    edges: state.graph.edges.filter((e) => e.id !== id),
                },
            })),

            setLastEdgeType: (type) => set({ lastEdgeType: type }),

            updateEdge: (id, updates) => set((state) => {
                const hasExplicitRoutingUpdate = Object.prototype.hasOwnProperty.call(updates, 'routingPoints');
                const changesRouteDefinition = [
                    'type',
                    'sourceId',
                    'targetId',
                    'sourceHandleId',
                    'targetHandleId',
                    'routingMode',
                    'routingMargin',
                ].some(key => Object.prototype.hasOwnProperty.call(updates, key));
                const durableUpdates = changesRouteDefinition && !hasExplicitRoutingUpdate
                    ? { ...updates, routingPoints: undefined, routingManual: undefined }
                    : updates;

                return {
                    graph: {
                        ...state.graph,
                        edges: state.graph.edges.map((edge) => (
                            edge.id === id ? { ...edge, ...durableUpdates } : edge
                        )),
                    },
                };
            }),

            onNodesChange: (changes) => set((state) => {
                const nodes = state.graph.nodes as any[];
                const durableChanges = changes.filter(change => change.type !== 'select');
                const updatedNodes = applyNodeChanges(durableChanges, nodes);

                return {
                    graph: {
                        ...state.graph,
                        nodes: updatedNodes as CanvasNode[],
                    }
                };
            }),

            onEdgesChange: (changes) => set((state) => {
                const edges = state.graph.edges as any[];
                const durableChanges = changes.filter(change => change.type !== 'select');
                const updatedEdges = applyEdgeChanges(durableChanges, edges);

                return {
                    graph: {
                        ...state.graph,
                        edges: updatedEdges as unknown as CanvasEdge[],
                    }
                };
            }),

            setDivisionVisible: (axis, visible) => set(state => {
                const graph = migrateDivision(state.graph);
                return { graph: { ...graph, division: { ...graph.division!, [axis === 'row' ? 'rowsVisible' : 'columnsVisible']: visible } } };
            }),
            addSwimlane: (label, color, axis) => set((state) => {
                const graph = migrateDivision(state.graph);
                const newLane: Swimlane = {
                    axis: axis ?? (graph.mode === 'swimlane-vertical' ? 'column' : 'row'),
                    id: generateId('lane'),
                    label,
                    color,
                    order: state.graph.swimlanes.length,
                    height: 300,
                    width: 300, // Default width for vertical mode
                };
                return {
                    graph: {
                        ...graph,
                        division: { ...graph.division!, [newLane.axis === 'row' ? 'rowsVisible' : 'columnsVisible']: true },
                        swimlanes: [...graph.swimlanes, newLane],
                    }
                };
            }),

            updateSwimlane: (id, updates) => set((state) => ({
                graph: {
                    ...state.graph,
                    swimlanes: state.graph.swimlanes.map(l => l.id === id ? { ...l, ...updates } : l),
                }
            })),

            reorderSwimlanes: (ids) => set((state) => {
                // A partial reorder must never discard the other axis or unknown IDs.
                const requested = [...new Set(ids)].filter(id => state.graph.swimlanes.some(lane => lane.id === id));
                return { graph: { ...state.graph, swimlanes: state.graph.swimlanes.map(lane => {
                    const index = requested.indexOf(lane.id);
                    return index < 0 ? lane : { ...lane, order: index };
                }) } };
            }),

            removeSwimlane: (id) => set((state) => ({
                graph: {
                    ...state.graph,
                    swimlanes: state.graph.swimlanes.filter(l => l.id !== id),
                    nodes: state.graph.nodes.map(node => ({ ...node,
                        ...(node.swimlaneId === id ? { swimlaneId: null } : {}),
                        ...(node.parentId === id ? { parentId: null } : {}),
                        ...(node.rowId === id ? { rowId: null } : {}),
                        ...(node.columnId === id ? { columnId: null } : {}),
                    })),
                }
            })),

            moveSwimlane: (id, direction) => set((state) => {
                const target = state.graph.swimlanes.find(lane => lane.id === id);
                if (!target) return state;
                const axis = laneAxis(state.graph, target);
                const lanes = state.graph.swimlanes.filter(lane => laneAxis(state.graph, lane) === axis).sort((a, b) => a.order - b.order);
                const index = lanes.findIndex(l => l.id === id);
                if (index === -1) return state;

                const newLanes = [...lanes];
                if (direction === 'up' && index > 0) {
                    [newLanes[index], newLanes[index - 1]] = [newLanes[index - 1], newLanes[index]];
                } else if (direction === 'down' && index < newLanes.length - 1) {
                    [newLanes[index], newLanes[index + 1]] = [newLanes[index + 1], newLanes[index]];
                } else {
                    return state;
                }

                return {
                    graph: {
                        ...state.graph,
                        swimlanes: [...state.graph.swimlanes.filter(lane => laneAxis(state.graph, lane) !== axis), ...newLanes.map((l, i) => ({ ...l, order: i }))],
                    }
                };
            }),

            setPreviewGraph: (graph) => set({ previewGraph: graph }),


        }),
        {
            limit: 50,
            partialize: (state) => ({
                graph: state.graph,
                copiedSubGraphs: state.copiedSubGraphs,
            }),
            // Compare every durable graph field so newly added schema fields cannot
            // silently become non-undoable. React Flow selection remains transient.
            equality: (a, b) => (
                a.copiedSubGraphs === b.copiedSubGraphs && durableGraphsEqual(a?.graph, b?.graph)
            ),
        }
    )
);

export const useCanvasHistory = () => useCanvasStore.temporal.getState();
