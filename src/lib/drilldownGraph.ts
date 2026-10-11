import type { CanvasGraph, CanvasNode, Process } from '../types';

export interface DrilldownNodeLocation {
    graph: CanvasGraph;
    graphId: string | null;
    node: CanvasNode;
    ancestorSubGraphIds: string[];
}

export interface DrilldownTreeBranch {
    node: CanvasNode;
    graph: CanvasGraph;
    breadcrumbPath: string[];
    cyclic: boolean;
    children: DrilldownTreeBranch[];
}

export interface RemoveDrilldownNodeResult {
    process: Process;
    removed: boolean;
    removedSubGraphIds: string[];
}

export const createEmptyDrilldownGraph = (): CanvasGraph => ({
    nodes: [],
    edges: [],
    swimlanes: [],
    mode: 'swimlane',
});

export const isGraphStructurallyEmpty = (graph: CanvasGraph): boolean => (
    (graph.nodes?.length || 0) === 0
    && (graph.edges?.length || 0) === 0
    && (graph.swimlanes?.length || 0) === 0
);

/**
 * Resolves the node at the end of a breadcrumb path without searching unrelated
 * graphs. Cyclic or dangling intermediate links are rejected.
 */
export function resolveDrilldownNodeAtPath(
    process: Process,
    nodePath: string[],
): DrilldownNodeLocation | null {
    if (nodePath.length === 0) return null;

    let graph = process.graph;
    let graphId: string | null = null;
    const ancestorSubGraphIds: string[] = [];
    const visitedSubGraphs = new Set<string>();

    for (let index = 0; index < nodePath.length; index += 1) {
        const node = graph.nodes.find(candidate => candidate.id === nodePath[index]);
        if (!node) return null;

        if (index === nodePath.length - 1) {
            return { graph, graphId, node, ancestorSubGraphIds };
        }

        const childGraphId = node.subGraphId;
        const childGraph = childGraphId && process.subGraphs?.[childGraphId];
        if (!childGraphId || !childGraph || visitedSubGraphs.has(childGraphId)) return null;

        visitedSubGraphs.add(childGraphId);
        ancestorSubGraphIds.push(childGraphId);
        graph = childGraph;
        graphId = childGraphId;
    }

    return null;
}

/**
 * Builds the tree representation defensively. A cycle-closing node is kept as
 * a leaf so the user can still identify and delete it, but recursion stops.
 */
export function buildDrilldownTree(process: Process): DrilldownTreeBranch[] {
    const visit = (
        graph: CanvasGraph,
        breadcrumbPath: string[],
        activeSubGraphIds: ReadonlySet<string>,
    ): DrilldownTreeBranch[] => graph.nodes.flatMap(node => {
        const childGraphId = node.subGraphId;
        const childGraph = childGraphId && process.subGraphs?.[childGraphId];
        if (!childGraphId || !childGraph) return [];

        const nextPath = [...breadcrumbPath, node.id];
        const cyclic = activeSubGraphIds.has(childGraphId);
        const nextActiveIds = new Set(activeSubGraphIds);
        nextActiveIds.add(childGraphId);

        return [{
            node,
            graph: childGraph,
            breadcrumbPath: nextPath,
            cyclic,
            children: cyclic ? [] : visit(childGraph, nextPath, nextActiveIds),
        }];
    });

    return visit(process.graph, [], new Set());
}

function collectDescendantSubGraphs(
    process: Process,
    initialSubGraphId: string | null | undefined,
): Set<string> {
    const descendants = new Set<string>();

    const visit = (subGraphId: string | null | undefined) => {
        if (!subGraphId || descendants.has(subGraphId)) return;
        const graph = process.subGraphs?.[subGraphId];
        if (!graph) return;

        descendants.add(subGraphId);
        graph.nodes.forEach(node => visit(node.subGraphId));
    };

    visit(initialSubGraphId);
    return descendants;
}

function collectReachableSubGraphs(
    rootGraph: CanvasGraph,
    subGraphs: Record<string, CanvasGraph>,
): Set<string> {
    const reachable = new Set<string>();

    const visitGraph = (graph: CanvasGraph) => {
        graph.nodes.forEach(node => {
            const subGraphId = node.subGraphId;
            if (!subGraphId || reachable.has(subGraphId)) return;
            const childGraph = subGraphs[subGraphId];
            if (!childGraph) return;

            reachable.add(subGraphId);
            visitGraph(childGraph);
        });
    };

    visitGraph(rootGraph);
    return reachable;
}

/**
 * Removes a drilldown node from its exact containing graph. Child subgraphs are
 * pruned only when they belonged to that branch and are no longer reachable
 * from the root, preserving any deliberately shared legacy graph.
 */
export function removeDrilldownNodeAtPath(
    process: Process,
    nodePath: string[],
): RemoveDrilldownNodeResult {
    const location = resolveDrilldownNodeAtPath(process, nodePath);
    if (!location) return { process, removed: false, removedSubGraphIds: [] };

    const descendantCandidates = collectDescendantSubGraphs(process, location.node.subGraphId);
    const updatedContainingGraph: CanvasGraph = {
        ...location.graph,
        nodes: location.graph.nodes.filter(node => node.id !== location.node.id),
        edges: location.graph.edges.filter(edge => (
            edge.sourceId !== location.node.id && edge.targetId !== location.node.id
        )),
    };

    let graph = process.graph;
    const subGraphs: Record<string, CanvasGraph> = { ...(process.subGraphs || {}) };
    if (location.graphId === null) {
        graph = updatedContainingGraph;
    } else {
        subGraphs[location.graphId] = updatedContainingGraph;
    }

    const reachableSubGraphs = collectReachableSubGraphs(graph, subGraphs);
    const removedSubGraphIds: string[] = [];
    descendantCandidates.forEach(subGraphId => {
        if (!reachableSubGraphs.has(subGraphId) && subGraphs[subGraphId]) {
            delete subGraphs[subGraphId];
            removedSubGraphIds.push(subGraphId);
        }
    });

    return {
        removed: true,
        removedSubGraphIds,
        process: {
            ...process,
            graph,
            subGraphs,
            updatedAt: new Date().toISOString(),
        },
    };
}

export function renameDrilldownNodeAtPath(
    process: Process,
    nodePath: string[],
    label: string,
): Process | null {
    const location = resolveDrilldownNodeAtPath(process, nodePath);
    if (!location) return null;

    const updatedContainingGraph: CanvasGraph = {
        ...location.graph,
        nodes: location.graph.nodes.map(node => (
            node.id === location.node.id ? { ...node, label } : node
        )),
    };

    if (location.graphId === null) {
        return {
            ...process,
            graph: updatedContainingGraph,
            updatedAt: new Date().toISOString(),
        };
    }

    return {
        ...process,
        subGraphs: {
            ...(process.subGraphs || {}),
            [location.graphId]: updatedContainingGraph,
        },
        updatedAt: new Date().toISOString(),
    };
}
