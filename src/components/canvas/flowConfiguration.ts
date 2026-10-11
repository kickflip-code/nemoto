import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from 'reactflow';
import { getPaletteColor } from '../../constants/palette';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import { getRoutingCorridor, resolveRoutingNodeSize } from '../../lib/edgeRouting';
import type { CanvasEdge, CanvasNode } from '../../types';
import CustomEdge from './edges/CustomEdge';
import {
    ActionNode,
    ArrowNode,
    DecisionNode,
    EndNode,
    EventNode,
    PostItNode,
    ProcessHeaderNode,
    ResourceNode,
    StartNode,
    SwimlaneStackNode,
    SystemNode,
} from './nodes';

export const CANVAS_NODE_TYPES = {
    start: StartNode,
    end: EndNode,
    action: ActionNode,
    decision: DecisionNode,
    system: SystemNode,
    'swimlane-stack': SwimlaneStackNode,
    'post-it': PostItNode,
    arrow: ArrowNode,
    'process-header': ProcessHeaderNode,
    resource: ResourceNode,
    event: EventNode,
};

export const CANVAS_EDGE_TYPES = {
    custom: CustomEdge,
};

export const toFlowNode = (node: CanvasNode, selected: boolean = false): FlowNode => {
    const { width, height } = resolveRoutingNodeSize(node);

    return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
            label: node.label ?? '',
            ...(node.data ?? {}),
            ...(node.type === 'resource' ? {
                assetId: getResourceReferenceAssetId(node),
                assetIds: node.assetIds,
            } : {}),
            ...(node.type === 'event' ? { event: node.event } : {}),
            hasDrilldown: !!node.subGraphId,
            width,
            height,
        },
        selected,
        width,
        height,
        style: { width, height },
    };
};

export const toFlowEdge = (
    edge: CanvasEdge,
    selected: boolean = false,
    nodes: CanvasNode[] = [],
): FlowEdge => {
    const resolvedColor = edge.color ? getPaletteColor(edge.color) : 'var(--color-canvas-edge, #52525b)';

    return {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        sourceHandle: edge.sourceHandleId,
        targetHandle: edge.targetHandleId,
        type: 'custom',
        label: edge.label,
        data: {
            labelPosition: edge.labelPosition,
            labelOrientation: edge.labelOrientation,
            labelSize: edge.labelSize,
            labelColor: edge.labelColor,
            pathType: edge.type || 'default',
            routingPoints: edge.routingPoints,
            routingManual: edge.routingManual,
            routingMargin: edge.routingMargin,
            routingNodes: edge.routingMode && edge.routingMode !== 'auto' && !edge.routingPoints?.length ? nodes.filter(node => node.type !== 'group' && node.type !== 'swimlane').map(node => ({
                position: node.position, type: node.type, ...resolveRoutingNodeSize(node),
            })) : undefined,
            routingMode: edge.routingMode,
            routingCorridor: getRoutingCorridor(edge.routingMode, nodes, edge.routingMargin),
        },
        animated: !!edge.animated,
        selected,
        style: {
            ...(edge.style === 'dotted' ? { strokeDasharray: '2,4' } :
                edge.style === 'dashed' ? { strokeDasharray: '5,5' } : {}),
            stroke: selected ? '#3b82f6' : resolvedColor,
            strokeWidth: selected ? 2.5 : (edge.strokeWidth || 1.5),
            filter: selected ? 'drop-shadow(0 0 4px rgba(59, 130, 246, 0.5))' : undefined,
            transition: 'stroke 0.2s, stroke-width 0.2s, filter 0.2s',
        },
        zIndex: selected ? 10 : 0,
        markerEnd: {
            type: MarkerType.ArrowClosed,
            color: selected ? '#3b82f6' : resolvedColor,
        },
    };
};
