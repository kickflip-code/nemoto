import type { CanvasGraph, CanvasMode, CanvasNode, Swimlane, Position } from '../types';

export type DivisionAxis = 'row' | 'column';
export function laneAxis(graph: CanvasGraph, lane: Swimlane): DivisionAxis {
    return lane.axis ?? (graph.mode === 'swimlane-vertical' ? 'column' : 'row');
}
export function divisionSettings(graph: CanvasGraph) {
    return graph.division ?? { version: 1 as const, rowsVisible: graph.mode !== 'blank' && graph.mode !== 'swimlane-vertical', columnsVisible: graph.mode === 'swimlane-vertical' };
}
export function divisionLanes(graph: CanvasGraph, axis: DivisionAxis) {
    return (graph.swimlanes || []).filter(lane => laneAxis(graph, lane) === axis).sort((a, b) => a.order - b.order);
}
/** Lossless and idempotent: old fields remain readable by import adapters. */
export function migrateDivision(graph: CanvasGraph, fallback?: CanvasMode): CanvasGraph {
    const source = { ...graph, mode: graph.mode ?? fallback };
    if (source.division) return source;
    return {
        ...source,
        division: divisionSettings(source),
        swimlanes: (source.swimlanes || []).map(lane => ({ ...lane, axis: laneAxis(source, lane) })),
        nodes: source.nodes.map(node => {
            const legacyId = node.swimlaneId ?? (source.swimlanes.some(lane => lane.id === node.parentId) ? node.parentId : undefined);
            return { ...node, ...(legacyId ? { [source.mode === 'swimlane-vertical' ? 'columnId' : 'rowId']: legacyId } : {}) };
        }),
    };
}
export function membershipAt(graph: CanvasGraph, position: Position): Partial<CanvasNode> {
    const settings = divisionSettings(graph);
    const updates: Partial<CanvasNode> = {};
    for (const axis of ['row', 'column'] as const) {
        if (!(axis === 'row' ? settings.rowsVisible : settings.columnsVisible)) continue;
        let offset = 0;
        const coordinate = axis === 'row' ? position.y : position.x;
        const lane = divisionLanes(graph, axis).find(item => {
            const size = axis === 'row' ? item.height : (item.width ?? 300);
            const inside = coordinate >= offset && coordinate < offset + size;
            offset += size;
            return inside;
        });
        updates[axis === 'row' ? 'rowId' : 'columnId'] = lane?.id ?? null;
        if (!graph.division) updates.swimlaneId = lane?.id;
    }
    return updates;
}

/** Include headers in Fit View without giving the background infinite bounds. */
export function divisionBounds(graph: CanvasGraph) {
    const settings = divisionSettings(graph);
    const rows = settings.rowsVisible ? divisionLanes(graph, 'row') : [];
    const columns = settings.columnsVisible ? divisionLanes(graph, 'column') : [];
    return { x: 0, y: columns.length ? -48 : 0,
        width: Math.max(rows.length ? 320 : 1, columns.reduce((sum, lane) => sum + (lane.width ?? 300), 0)),
        height: Math.max(1, rows.reduce((sum, lane) => sum + lane.height, 0)) + (columns.length ? 48 : 0) };
}
