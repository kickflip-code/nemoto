import type { Viewport } from 'reactflow';
import type { CanvasGraph } from '../types';
import { divisionLanes, divisionSettings } from './canvasDivision';

/** Keep existing negative-coordinate content reachable, including column headings. */
export function canvasPanOrigin(graph: CanvasGraph) {
    const columns = divisionSettings(graph).columnsVisible && divisionLanes(graph, 'column').length > 0;
    const points = [...graph.nodes.map(node => node.position), ...graph.edges.flatMap(edge => edge.routingPoints ?? [])];
    return {
        x: Math.min(0, ...points.map(point => point.x)),
        y: Math.min(columns ? -48 : 0, ...points.map(point => point.y)),
    };
}

export function constrainCanvasPan(viewport: Viewport, origin: { x: number; y: number }, elastic = false): Viewport {
    const limit = (value: number, coordinate: number) => {
        const boundary = 16 - coordinate * viewport.zoom;
        const excess = Math.max(0, value - boundary);
        // Continuous resistance, capped at 80 screen pixels at every zoom level.
        return value <= boundary ? value : boundary + (elastic ? 80 * excess / (160 + excess) : 0);
    };
    return { ...viewport, x: limit(viewport.x, origin.x), y: limit(viewport.y, origin.y) };
}
