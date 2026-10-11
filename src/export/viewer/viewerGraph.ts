import { MarkerType, type Edge } from 'reactflow';
import { getRoutingCorridor } from '../../lib/edgeRouting';
import { resolveViewerColor } from './viewerColors';

interface ViewerNodePosition {
    type?: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export function toViewerEdge(edge: any, nodePositions: ViewerNodePosition[]): Edge {
    const strokeColor = resolveViewerColor(edge.color) || '#52525b';
    return {
        id: edge.id,
        source: edge.sourceId || edge.source,
        target: edge.targetId || edge.target,
        sourceHandle: edge.sourceHandleId || edge.sourceHandle || undefined,
        targetHandle: edge.targetHandleId || edge.targetHandle || undefined,
        type: 'custom',
        label: edge.label || undefined,
        data: {
            pathType: edge.type || 'default',
            labelPosition: edge.labelPosition ?? 0.5,
            labelOrientation: edge.labelOrientation ?? 'horizontal',
            labelSize: edge.labelSize,
            labelColor: edge.labelColor,
            routingPoints: edge.routingPoints,
            routingManual: edge.routingManual,
            routingMargin: edge.routingMargin,
            routingNodes: edge.routingMode && edge.routingMode !== 'auto' && !edge.routingPoints?.length ? nodePositions.filter(node => node.type !== 'group' && node.type !== 'swimlane').map(node => ({
                position: { x: node.x, y: node.y }, width: node.w, height: node.h,
            })) : undefined,
            routingMode: edge.routingMode,
            routingCorridor: getRoutingCorridor(
                edge.routingMode,
                nodePositions.map(position => ({
                    position: { x: position.x, y: position.y },
                    width: position.w,
                    height: position.h,
                })),
                edge.routingMargin,
            ),
        },
        style: {
            stroke: strokeColor,
            strokeWidth: edge.strokeWidth || 1.5,
            strokeDasharray: edge.style === 'dashed' ? '5,5' : edge.style === 'dotted' ? '2,4' : undefined,
        },
        animated: !!edge.animated,
        markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor },
    };
}
