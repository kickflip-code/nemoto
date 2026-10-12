import DivisionControls from './DivisionControls';
import { CircleDot, FileText, MousePointer2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { createDefaultEventData } from '../../lib/events';
import { generateId } from '../../lib/id';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import type { NodeType } from '../../types';
import { NemotoDock, NemotoDockButton, NemotoDockDivider } from '../ui';

type DockNodeTool = {
    type: NodeType;
    title: string;
    color: string;
    shape: 'pill' | 'rect' | 'diamond' | 'system' | 'note' | 'event';
};

const NODE_TOOLS: DockNodeTool[] = [
    { type: 'start', title: 'Start', color: 'var(--palette-green)', shape: 'pill' },
    { type: 'end', title: 'End', color: 'var(--palette-red)', shape: 'pill' },
    { type: 'action', title: 'Action', color: 'var(--palette-blue)', shape: 'rect' },
    { type: 'decision', title: 'Decision', color: 'var(--palette-white)', shape: 'diamond' },
    { type: 'system', title: 'System', color: 'var(--palette-purple)', shape: 'system' },
    { type: 'post-it', title: 'Note', color: 'var(--palette-amber)', shape: 'note' },
    { type: 'event', title: 'Event', color: 'var(--color-node-event-accent)', shape: 'event' },
];

interface FloatingDockProps {
    preview?: boolean;
}

export default function FloatingDock({ preview = false }: FloatingDockProps) {
    const { activeTool, setActiveTool } = useUIStore();
    const { addNode } = useCanvasStore();
    const isImportedPreview = useCanvasStore(state => !!state.previewGraph);
    if (isImportedPreview && !preview) return null;

    const handleAddNode = (type: NodeType) => {
        const baseNode = {
            id: generateId('node'),
            type,
            position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
        };

        addNode({
            ...baseNode,
            label: type === 'event' ? 'New Event' : type.charAt(0).toUpperCase() + type.slice(1),
            ...(type === 'event' ? { event: createDefaultEventData() } : {}),
        });
    };

    return (
        <div className={`absolute left-1/2 -translate-x-1/2 max-w-[calc(100%-1rem)] overflow-x-auto z-30 floating-dock ${preview ? 'floating-dock-preview bottom-3' : 'bottom-6'}`}>
            <NemotoDock aria-label="Canvas creation tools" className="flex w-max items-center p-1.5 gap-1 backdrop-blur-sm">

                {/* Primary Tools */}
                <ToolButton
                    active={preview || activeTool === 'select'}
                    onClick={preview ? () => undefined : () => setActiveTool('select')}
                    title="Select"
                />

                <DockDivider />

                {/* Nodes */}
                {NODE_TOOLS.slice(0, 5).map(tool => (
                    <NodeButton key={tool.type} tool={tool} onClick={preview ? () => undefined : () => handleAddNode(tool.type)} />
                ))}

                <DockDivider />

                {NODE_TOOLS.slice(5).map(tool => (
                    <NodeButton key={tool.type} tool={tool} onClick={preview ? () => undefined : () => handleAddNode(tool.type)} />
                ))}
                <DockDivider />
                <DivisionControls preview={preview} />
            </NemotoDock>
        </div>
    );
}

function DockDivider() {
    return <NemotoDockDivider className="w-[1px] h-6 mx-1" />;
}

function ToolButton({ active, onClick, title }: { active: boolean; onClick: () => void; title: string }) {
    return (
        <NemotoDockButton
            onClick={onClick}
            label={title}
            title={`${title} — drag to select, Ctrl/Cmd-click to add, Space-drag to pan`}
            active={active}
            className="dock-select-button"
        >
            <MousePointer2 size={20} strokeWidth={2} className={active ? 'fill-current' : ''} />
        </NemotoDockButton>
    )
}

function NodeButton({ onClick, tool }: { onClick: () => void; tool: DockNodeTool }) {
    return (
        <NemotoDockButton
            onClick={onClick}
            label={`Add ${tool.title}`}
            className="dock-node-button"
        >
            <MiniNodeIcon tool={tool} />
        </NemotoDockButton>
    )
}

function MiniNodeIcon({ tool }: { tool: DockNodeTool }) {
    if (tool.shape === 'note') {
        return (
            <span className="dock-mini-node dock-mini-note" style={{ '--dock-color': tool.color } as CSSProperties}>
                <FileText size={15} strokeWidth={2} />
            </span>
        );
    }

    if (tool.shape === 'event') {
        return (
            <span className="dock-mini-node dock-mini-event" style={{ '--dock-color': tool.color } as CSSProperties}>
                <CircleDot size={15} strokeWidth={2} />
            </span>
        );
    }

    return (
        <span
            className={`dock-mini-node dock-mini-${tool.shape}`}
            style={{ '--dock-color': tool.color } as CSSProperties}
        />
    );
}
