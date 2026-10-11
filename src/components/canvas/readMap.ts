import type { Asset, CanvasGraph, Process } from '../../types';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import { EVENT_BEHAVIOR_LABELS, EVENT_KIND_LABELS, resolveEventBehavior, resolveEventKind } from '../../lib/events';

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;

export function readMapPath(process: Process | undefined, path: string[], preview: boolean): string {
    if (preview) return 'Imported process — read-only';
    if (!process) return 'Process map';
    const names = [text(process.title, 'Untitled process')];
    let graph = process.graph;
    const visited = new Set<string>();
    for (const id of path) {
        const node = graph.nodes.find(candidate => candidate.id === id);
        if (!node?.subGraphId || visited.has(node.subGraphId)) break;
        const child = process.subGraphs?.[node.subGraphId];
        if (!child) break;
        names.push(text(node.label, 'Untitled subprocess'));
        visited.add(node.subGraphId);
        graph = child;
    }
    return names.join(' / ');
}

/** Read-only projection. Numbers are local to this displayed graph, never IDs. */
export function buildReadMap(graph: CanvasGraph, assets: Asset[], selectedNodes: string[], selectedEdges: string[], preview: boolean) {
    // Imported references must never resolve coincident IDs against the open Portfolio.
    const assetNames = new Map((preview ? [] : assets).map(asset => [asset.id, asset.name]));
    const lanes = new Map(graph.swimlanes.map(lane => [lane.id, lane.label]));
    const nodeSelection = new Set(preview ? [] : selectedNodes);
    const edgeSelection = new Set(preview ? [] : selectedEdges);
    const nodes = graph.nodes.map((node, index) => {
        const type = node.type === 'post-it' ? 'Note' : node.type.replace(/-/g, ' ');
        const assetName = node.type === 'resource' ? assetNames.get(getResourceReferenceAssetId(node) ?? '') : undefined;
        const label = text(assetName, text(node.data?.label, text(node.label, `Untitled ${type}`)));
        return {
            id: node.id, number: index + 1, label,
            title: `Node ${index + 1} — ${type}: ${label.length > 100 ? `${label.slice(0, 100)}…` : label}`,
            lane: !graph.division && node.swimlaneId ? text(lanes.get(node.swimlaneId), 'Missing lane') : null,
            row: node.rowId ? text(lanes.get(node.rowId), 'Missing row') : null,
            column: node.columnId ? text(lanes.get(node.columnId), 'Missing column') : null,
            hasDrilldown: !!node.subGraphId,
            event: node.type === 'event' ? `${EVENT_KIND_LABELS[resolveEventKind(node.event)]}; ${EVENT_BEHAVIOR_LABELS[resolveEventBehavior(node.event)]}` : null,
            selected: nodeSelection.has(node.id),
            incoming: [] as number[], outgoing: [] as number[],
        };
    });
    const byId = new Map(nodes.map(node => [node.id, node]));
    const connections = graph.edges.map((edge, index) => {
        const source = byId.get(edge.sourceId);
        const target = byId.get(edge.targetId);
        source?.outgoing.push(index);
        target?.incoming.push(index);
        return { number: index + 1, source, target, label: text(edge.label, 'Unlabelled connection'), selected: edgeSelection.has(edge.id) };
    });
    const selectedNodeCount = nodes.filter(node => node.selected).length;
    const selectedEdgeCount = connections.filter(edge => edge.selected).length;
    return { nodes, connections, summary: `${count(nodes.length, 'node')}. ${count(connections.length, 'connection')}. ${preview ? 'Read-only preview; no selection.' : `${count(selectedNodeCount, 'node')} and ${count(selectedEdgeCount, 'connection')} selected.`}` };
}
