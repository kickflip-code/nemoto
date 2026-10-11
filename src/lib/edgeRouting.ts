import type { EdgeRoutingMode, Position } from '../types';

export type RoutedEdgePath = [string, number, number, number, number];
export const DEFAULT_EDGE_ROUTING_MARGIN = 80;
export const MIN_EDGE_ROUTING_MARGIN = 24;
export const MAX_EDGE_ROUTING_MARGIN = 320;

const INTRINSIC_NODE_TYPES = new Set([
    'start', 'end', 'action', 'decision', 'system', 'post-it', 'event', 'resource',
]);

const INTRINSIC_NODE_SIZES = [
    { width: 224, height: 64 },
    { width: 224, height: 96 },
    { width: 224, height: 160 },
    { width: 192, height: 64 },
    { width: 224, height: 88 },
    { width: 200, height: 72 },
];

export const RESOURCE_NODE_SIZE = { width: 224, height: 96 } as const;

export interface RoutingNodeBounds {
    position: Position;
    width?: number | null;
    height?: number | null;
    type?: string | null;
}

export interface RoutedEdgePathOptions {
    cornerRadius?: number;
}

export function getDefaultRoutingNodeSize(type?: string | null): { width: number; height: number } {
    switch (type) {
        case 'start':
        case 'end':
            return { width: 224, height: 64 };
        case 'resource':
            return { ...RESOURCE_NODE_SIZE };
        case 'event':
            return { width: 240, height: 112 };
        case 'decision':
            return { width: 224, height: 160 };
        case 'post-it':
            return { width: 192, height: 64 };
        case 'arrow':
            return { width: 64, height: 64 };
        default:
            return { width: 224, height: 96 };
    }
}

/**
 * Resolve durable node dimensions consistently in the editor, routing, and
 * export viewer. Exact built-in dimensions from another node shape are legacy
 * measurement residue; genuinely custom/imported sizes are preserved.
 */
export function resolveRoutingNodeSize(node: RoutingNodeBounds): { width: number; height: number } {
    const defaults = getDefaultRoutingNodeSize(node.type);
    const width = (typeof node.width === 'number' && node.width > 0 && node.width < 2000)
        ? node.width
        : defaults.width;
    const height = (typeof node.height === 'number' && node.height > 0 && node.height < 2000)
        ? node.height
        : defaults.height;
    const matchesDifferentIntrinsicSize = INTRINSIC_NODE_SIZES.some(size => (
        size.width === width
        && size.height === height
        && (size.width !== defaults.width || size.height !== defaults.height)
    ));

    return node.type && INTRINSIC_NODE_TYPES.has(node.type) && matchesDifferentIntrinsicSize
        ? defaults
        : { width, height };
}

export function normalizeRoutingMargin(value: unknown): number {
    if (!Number.isFinite(value)) return DEFAULT_EDGE_ROUTING_MARGIN;
    return Math.min(MAX_EDGE_ROUTING_MARGIN, Math.max(MIN_EDGE_ROUTING_MARGIN, Number(value)));
}

/** Resolve the shared outside corridor for a semantic route. */
export function getRoutingCorridor(
    mode: EdgeRoutingMode | null | undefined,
    nodes: RoutingNodeBounds[],
    margin?: number | null,
): number | null {
    if (!mode || mode === 'auto' || nodes.length === 0) return null;

    const bounds = nodes
        .filter(node => Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y))
        .map(node => {
            const { width, height } = resolveRoutingNodeSize(node);
            return {
                left: node.position.x,
                top: node.position.y,
                right: node.position.x + width,
                bottom: node.position.y + height,
            };
        });
    if (bounds.length === 0) return null;

    const distance = normalizeRoutingMargin(margin);
    switch (mode) {
        case 'outside-right':
            return Math.max(...bounds.map(bound => bound.right)) + distance;
        case 'outside-left':
            return Math.min(...bounds.map(bound => bound.left)) - distance;
        case 'above':
            return Math.min(...bounds.map(bound => bound.top)) - distance;
        case 'below':
            return Math.max(...bounds.map(bound => bound.bottom)) + distance;
        default:
            return null;
    }
}

/** Convert a semantic route and its corridor into live waypoints at the rendered handles. */
export function getDynamicRoutingPoints(
    mode: EdgeRoutingMode | null | undefined,
    corridor: unknown,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
): Position[] | null {
    if (!mode || mode === 'auto' || !Number.isFinite(corridor)) return null;
    const coordinate = Number(corridor);

    switch (mode) {
        case 'outside-right':
        case 'outside-left':
            return [{ x: coordinate, y: sourceY }, { x: coordinate, y: targetY }];
        case 'above':
        case 'below':
            return [{ x: sourceX, y: coordinate }, { x: targetX, y: coordinate }];
        default:
            return null;
    }
}

function isFinitePoint(value: unknown): value is Position {
    if (!value || typeof value !== 'object') return false;
    const point = value as Partial<Position>;
    return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointsEqual(a: Position, b: Position): boolean {
    return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

function pointAtFraction(points: Position[], fraction: number): Position {
    const segments = points.slice(1).map((point, index) => ({
        start: points[index],
        end: point,
        length: Math.hypot(point.x - points[index].x, point.y - points[index].y),
    }));
    const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
    if (totalLength === 0) return points[0];

    let remaining = totalLength * fraction;
    for (const segment of segments) {
        if (remaining <= segment.length) {
            const ratio = segment.length === 0 ? 0 : remaining / segment.length;
            return {
                x: segment.start.x + ((segment.end.x - segment.start.x) * ratio),
                y: segment.start.y + ((segment.end.y - segment.start.y) * ratio),
            };
        }
        remaining -= segment.length;
    }
    return points[points.length - 1];
}

function moveTowards(from: Position, to: Position, distance: number): Position {
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentLength === 0) return from;
    const ratio = Math.min(1, distance / segmentLength);
    return {
        x: from.x + ((to.x - from.x) * ratio),
        y: from.y + ((to.y - from.y) * ratio),
    };
}

function buildPath(points: Position[], cornerRadius: number): string {
    if (cornerRadius <= 0 || points.length < 3) {
        return points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
            .join(' ');
    }

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length - 1; index += 1) {
        const previous = points[index - 1];
        const corner = points[index];
        const next = points[index + 1];
        const radius = Math.min(
            cornerRadius,
            Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2,
            Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
        );
        const entry = moveTowards(corner, previous, radius);
        const exit = moveTowards(corner, next, radius);
        path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
    }
    const target = points[points.length - 1];
    return `${path} L ${target.x} ${target.y}`;
}

/** Build an SVG path from durable absolute canvas routing points. */
export function getRoutedEdgePath(
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    routingPoints: unknown,
    options: RoutedEdgePathOptions = {},
): RoutedEdgePath | null {
    if (!Array.isArray(routingPoints)) return null;

    const points: Position[] = [{ x: sourceX, y: sourceY }];
    routingPoints.filter(isFinitePoint).forEach(point => {
        if (!pointsEqual(points[points.length - 1], point)) points.push(point);
    });
    const target = { x: targetX, y: targetY };
    if (!pointsEqual(points[points.length - 1], target)) points.push(target);
    if (points.length < 3) return null;

    const path = buildPath(points, Math.max(0, options.cornerRadius ?? 0));
    const label = pointAtFraction(points, 0.5);
    return [
        path,
        label.x,
        label.y,
        Math.abs(label.x - sourceX),
        Math.abs(label.y - sourceY),
    ];
}
