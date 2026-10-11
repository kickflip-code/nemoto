import type { CanvasGraph, CanvasNode, CanvasEdge } from '../types';
import { generateId } from './id';

export interface CanvasClipboard {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    subGraphs?: Record<string, CanvasGraph>;
}

/** Take a detached snapshot of the selection and every reachable drilldown. */
export function captureCanvasClipboard(graph: CanvasGraph, selected: string[], subGraphs: Record<string, CanvasGraph> = {}): CanvasClipboard {
    const ids = new Set(selected);
    // Groups carry their children, including nested groups.
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of graph.nodes) {
            if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
                ids.add(node.id);
                changed = true;
            }
        }
    }
    const nodes = graph.nodes.filter(node => ids.has(node.id)).map(node => {
        const copy = structuredClone(node);
        // A partial selection must not retain a parent from another canvas.
        if (copy.parentId && !ids.has(copy.parentId)) {
            const visited = new Set<string>([copy.id]);
            let parentId: string | null | undefined = copy.parentId;
            while (parentId && !visited.has(parentId)) {
                visited.add(parentId);
                const parent = graph.nodes.find(candidate => candidate.id === parentId);
                if (!parent) break;
                copy.position.x += parent.position.x;
                copy.position.y += parent.position.y;
                parentId = parent.parentId;
            }
            delete copy.parentId;
        }
        delete copy.swimlaneId;
        return copy;
    });
    const captured: Record<string, CanvasGraph> = {};
    const visiting = new Set<string>();
    const visit = (node: CanvasNode) => {
        if (!node.subGraphId) return;
        const id = node.subGraphId;
        if (visiting.has(id)) throw new Error('This selection contains a cyclic drilldown.');
        if (captured[id]) return;
        const child = subGraphs[id];
        if (!child) throw new Error('This selection contains a missing drilldown.');
        visiting.add(id);
        child.nodes.forEach(visit);
        visiting.delete(id);
        captured[id] = structuredClone(child);
    };
    nodes.forEach(visit);
    return {
        nodes,
        edges: structuredClone(graph.edges.filter(edge => ids.has(edge.sourceId) && ids.has(edge.targetId))),
        subGraphs: captured,
    };
}

/** Each paste owns new graph identities; resource references remain shared. */
export function cloneCanvasClipboard(clipboard: CanvasClipboard, destination?: CanvasGraph): Required<CanvasClipboard> {
    const graphs = clipboard.subGraphs || {};
    const graphIds = new Map(Object.keys(graphs).map(id => [id, generateId('sg')]));
    const cloneGraph = (source: CanvasGraph, offset: number): CanvasGraph => {
        const graph = structuredClone(source);
        const ids = new Map(graph.nodes.map(node => [node.id, generateId('node')]));
        const lanes = new Map(graph.swimlanes.map(lane => [lane.id, generateId('lane')]));
        graph.swimlanes = graph.swimlanes.map(lane => ({ ...lane, id: lanes.get(lane.id)! }));
        graph.nodes = graph.nodes.map(node => {
            const parentId = node.parentId ? ids.get(node.parentId) || lanes.get(node.parentId) : undefined;
            const subGraphId = node.subGraphId ? graphIds.get(node.subGraphId) : undefined;
            if (node.subGraphId && !subGraphId) throw new Error('The copied drilldown is missing. Copy the selection again.');
            delete node.selected;
            return {
                ...node, id: ids.get(node.id)!, parentId,
                swimlaneId: node.swimlaneId ? lanes.get(node.swimlaneId) : undefined,
                rowId: node.rowId ? lanes.get(node.rowId) ?? (offset && destination?.swimlanes.some(lane => lane.id === node.rowId && lane.axis === 'row') ? node.rowId : undefined) : undefined,
                columnId: node.columnId ? lanes.get(node.columnId) ?? (offset && destination?.swimlanes.some(lane => lane.id === node.columnId && lane.axis === 'column') ? node.columnId : undefined) : undefined,
                subGraphId,
                position: parentId ? node.position : { x: node.position.x + offset, y: node.position.y + offset },
            };
        });
        graph.edges = graph.edges.filter(edge => ids.has(edge.sourceId) && ids.has(edge.targetId)).map(edge => {
            delete edge.selected;
            return {
                ...edge, id: generateId('edge'), sourceId: ids.get(edge.sourceId)!, targetId: ids.get(edge.targetId)!,
                ...(edge.routingPoints ? { routingPoints: edge.routingPoints.map(point => ({ x: point.x + offset, y: point.y + offset })) } : {}),
            };
        });
        return graph;
    };
    const root = cloneGraph({ nodes: clipboard.nodes, edges: clipboard.edges, swimlanes: [] }, 32);
    return {
        nodes: root.nodes, edges: root.edges,
        subGraphs: Object.fromEntries(Object.entries(graphs).map(([id, graph]) => [graphIds.get(id)!, cloneGraph(graph, 0)])),
    };
}
