import type { CanvasGraph, Portfolio, Process } from '../types';

export interface LocatedPortfolioGraph {
    readonly process: Process;
    readonly graph: CanvasGraph;
    readonly graphId: 'root' | string;
    /** Breadcrumb node IDs. Null means an orphaned subgraph has no navigable path. */
    readonly graphPath: readonly string[] | null;
}

export const listProcessGraphLocations = (process: Process): LocatedPortfolioGraph[] => {
    const locations: LocatedPortfolioGraph[] = [];
    const visitedSubGraphs = new Set<string>();

    const visit = (
        graph: CanvasGraph,
        graphId: 'root' | string,
        graphPath: readonly string[],
    ): void => {
        locations.push({ process, graph, graphId, graphPath: [...graphPath] });
        graph.nodes.forEach(node => {
            const subGraphId = node.subGraphId;
            const child = subGraphId ? process.subGraphs?.[subGraphId] : undefined;
            if (!subGraphId || !child || visitedSubGraphs.has(subGraphId)) return;
            visitedSubGraphs.add(subGraphId);
            visit(child, subGraphId, [...graphPath, node.id]);
        });
    };

    visit(process.graph, 'root', []);
    Object.entries(process.subGraphs || {}).forEach(([graphId, graph]) => {
        if (visitedSubGraphs.has(graphId)) return;
        visitedSubGraphs.add(graphId);
        locations.push({ process, graph, graphId, graphPath: null });
    });
    return locations;
};

export const listPortfolioGraphLocations = (
    portfolio: Portfolio,
    preferredProcessId?: string,
): LocatedPortfolioGraph[] => {
    const processes = preferredProcessId
        ? [
            ...portfolio.processes.filter(process => process.id === preferredProcessId),
            ...portfolio.processes.filter(process => process.id !== preferredProcessId),
        ]
        : portfolio.processes;
    return processes.flatMap(listProcessGraphLocations);
};

export const findGraphEntityLocation = (
    portfolio: Portfolio,
    kind: 'core.node' | 'core.edge' | 'core.swimlane',
    id: string,
    preferredProcessId?: string,
): LocatedPortfolioGraph | null => {
    for (const located of listPortfolioGraphLocations(portfolio, preferredProcessId)) {
        if (kind === 'core.node' && located.graph.nodes.some(value => value.id === id)) return located;
        if (kind === 'core.edge' && located.graph.edges.some(value => value.id === id)) return located;
        if (kind === 'core.swimlane' && located.graph.swimlanes.some(value => value.id === id)) return located;
    }
    return null;
};

export const graphLocationHint = (located: LocatedPortfolioGraph) => ({
    processId: located.process.id,
    ...(located.graphPath && located.graphPath.length > 0
        ? { graphPath: [...located.graphPath] }
        : {}),
});
