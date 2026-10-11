import ReactFlow, { Background, BackgroundVariant } from 'reactflow';
import 'reactflow/dist/style.css';
import type { CanvasEdge, CanvasNode } from '../../types';
import type { BuiltInThemeId } from '../../theme/themeContract';
import { CANVAS_EDGE_TYPES, CANVAS_NODE_TYPES, toFlowEdge, toFlowNode } from './flowConfiguration';

const PREVIEW_NODES: CanvasNode[] = [
    {
        id: 'theme-preview-start',
        type: 'start',
        label: 'Start',
        position: { x: 0, y: 64 },
        data: { color: 'green' },
    },
    {
        id: 'theme-preview-action',
        type: 'action',
        label: 'Validate Request',
        position: { x: 288, y: 64 },
        data: { color: 'blue' },
    },
    {
        id: 'theme-preview-decision',
        type: 'decision',
        label: 'Approved?',
        position: { x: 576, y: 16 },
        data: { color: 'gray' },
    },
    {
        id: 'theme-preview-system',
        type: 'system',
        label: 'CRM System',
        position: { x: 576, y: 240 },
        data: { color: 'purple' },
    },
    {
        id: 'theme-preview-note',
        type: 'post-it',
        label: 'Document assumptions near the process.',
        position: { x: 576, y: 400 },
        data: { color: 'amber' },
    },
    {
        id: 'theme-preview-subprocess',
        type: 'action',
        subGraphId: 'theme-preview-escalation-graph',
        label: 'Escalation Flow',
        position: { x: 288, y: 240 },
        data: { color: 'orange' },
    },
    {
        id: 'theme-preview-resource',
        type: 'resource',
        label: 'Incident Manager',
        position: { x: 288, y: 400 },
        data: { color: 'amber' },
    },
    {
        id: 'theme-preview-event',
        type: 'event',
        label: 'Payment Confirmed',
        position: { x: 0, y: 400 },
        event: {
            kind: 'message',
            behavior: 'observed',
        },
    },
    {
        id: 'theme-preview-end',
        type: 'end',
        label: 'End',
        position: { x: 0, y: 256 },
        data: { color: 'red' },
    },
];

export const THEME_PREVIEW_NODES = PREVIEW_NODES;

const PREVIEW_EDGES: CanvasEdge[] = [
    {
        id: 'theme-preview-edge-start-action',
        sourceId: 'theme-preview-start',
        targetId: 'theme-preview-action',
        sourceHandleId: 's-right',
        targetHandleId: 't-left',
        style: 'solid',
        type: 'straight',
    },
    {
        id: 'theme-preview-edge-action-decision',
        sourceId: 'theme-preview-action',
        targetId: 'theme-preview-decision',
        sourceHandleId: 's-right',
        targetHandleId: 't-left',
        style: 'solid',
        type: 'default',
    },
    {
        id: 'theme-preview-edge-decision-system',
        sourceId: 'theme-preview-decision',
        targetId: 'theme-preview-system',
        sourceHandleId: 's-bottom',
        targetHandleId: 't-top',
        style: 'solid',
        type: 'straight',
        label: 'Yes',
    },
    {
        id: 'theme-preview-edge-action-subprocess',
        sourceId: 'theme-preview-action',
        targetId: 'theme-preview-subprocess',
        sourceHandleId: 's-bottom',
        targetHandleId: 't-top',
        style: 'dashed',
        type: 'default',
    },
    {
        id: 'theme-preview-edge-system-subprocess',
        sourceId: 'theme-preview-system',
        targetId: 'theme-preview-subprocess',
        sourceHandleId: 's-left',
        targetHandleId: 't-right',
        style: 'solid',
        type: 'straight',
    },
    {
        id: 'theme-preview-edge-subprocess-resource',
        sourceId: 'theme-preview-subprocess',
        targetId: 'theme-preview-resource',
        sourceHandleId: 's-bottom',
        targetHandleId: 't-top',
        style: 'dashed',
        type: 'straight',
    },
    {
        id: 'theme-preview-edge-subprocess-end',
        sourceId: 'theme-preview-subprocess',
        targetId: 'theme-preview-end',
        sourceHandleId: 's-left',
        targetHandleId: 't-right',
        style: 'solid',
        type: 'straight',
    },
];

const FLOW_NODES = PREVIEW_NODES.map(node => toFlowNode(node));
const FLOW_EDGES = PREVIEW_EDGES.map(edge => toFlowEdge(edge));

const COMPACT_NODES: CanvasNode[] = [
    {
        id: 'theme-app-preview-action',
        type: 'action',
        label: 'Validate Request',
        position: { x: 0, y: 48 },
        data: { color: 'blue', eyebrow: 'Service Desk' },
    },
    {
        id: 'theme-app-preview-decision',
        type: 'decision',
        label: 'Approved?',
        position: { x: 288, y: 0 },
        data: { color: 'gray' },
    },
    {
        id: 'theme-app-preview-end',
        type: 'end',
        label: 'Escalate',
        position: { x: 864, y: 48 },
        data: { color: 'red' },
    },
    {
        id: 'theme-app-preview-event',
        type: 'event',
        label: 'SLA Expires',
        position: { x: 576, y: 40 },
        event: {
            kind: 'timer',
            behavior: 'observed',
            timing: {
                start: { kind: 'date', precision: 'day', value: '2026-09-08' },
                allDay: true,
            },
        },
    },
];

export const THEME_COMPACT_PREVIEW_NODES = COMPACT_NODES;

const COMPACT_EDGES: CanvasEdge[] = [
    {
        id: 'theme-app-preview-edge-action-decision',
        sourceId: 'theme-app-preview-action',
        targetId: 'theme-app-preview-decision',
        sourceHandleId: 's-right',
        targetHandleId: 't-left',
        style: 'solid',
        type: 'default',
    },
    {
        id: 'theme-app-preview-edge-decision-end',
        sourceId: 'theme-app-preview-decision',
        targetId: 'theme-app-preview-event',
        sourceHandleId: 's-right',
        targetHandleId: 't-left',
        style: 'dashed',
        type: 'default',
    },
    {
        id: 'theme-app-preview-edge-event-end',
        sourceId: 'theme-app-preview-event',
        targetId: 'theme-app-preview-end',
        sourceHandleId: 's-right',
        targetHandleId: 't-left',
        style: 'solid',
        type: 'straight',
    },
];

const COMPACT_FLOW_NODES = COMPACT_NODES.map(node => toFlowNode(node));
const COMPACT_FLOW_EDGES = COMPACT_EDGES.map(edge => toFlowEdge(edge));

interface CanvasThemePreviewProps {
    themeId: BuiltInThemeId;
    variant?: 'compact' | 'full';
}

export function CanvasThemePreview({ themeId, variant = 'full' }: CanvasThemePreviewProps) {
    const isBrutalist = themeId === 'hard';
    const isCompact = variant === 'compact';

    return (
        <ReactFlow
            nodes={isCompact ? COMPACT_FLOW_NODES : FLOW_NODES}
            edges={isCompact ? COMPACT_FLOW_EDGES : FLOW_EDGES}
            nodeTypes={CANVAS_NODE_TYPES}
            edgeTypes={CANVAS_EDGE_TYPES}
            fitView
            fitViewOptions={{ padding: isCompact ? 0.18 : 0.12, minZoom: 0.3, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            edgesUpdatable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
            className="pointer-events-none bg-app-bg"
        >
            <Background
                id={`theme-studio-canvas-${themeId}`}
                color="var(--color-app-grid)"
                gap={isBrutalist ? 32 : 24}
                size={isBrutalist ? 1 : 2}
                variant={isBrutalist ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            />
        </ReactFlow>
    );
}
