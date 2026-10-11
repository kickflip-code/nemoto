import { Handle, Position, NodeProps } from 'reactflow';
import { memo, useLayoutEffect, useState, useRef } from 'react';
import clsx from 'clsx';
import { getPaletteColor } from '../../../constants/palette';
import { useUIStore } from '../../../stores/useUIStore';
import { NodeTooltip } from '../../shared/NodeTooltip';
import { useJournalStore } from '../../../stores/useJournalStore';
import { EditableLabel, EditableLabelHandle } from './EditableLabel';
import { useTheme } from '../../../context/ThemeContext';
export * from './SwimlaneStackNode';
export * from './PostItNode';
export * from './ArrowNode';
export * from './ProcessHeaderNode';
export * from './EventNode';
export * from './ResourceNode';

// --- AUTO-RESIZE HOOK (Height-only expansion with fixed width) ---
const useAutoResize = (label: string, fixedWidth: number, minHeight: number) => {
    const textRef = useRef<HTMLSpanElement>(null);
    const [height, setHeight] = useState(minHeight);

    useLayoutEffect(() => {
        if (textRef.current) {
            const tempSpan = document.createElement('span');
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            tempSpan.style.fontSize = '11px';
            tempSpan.style.fontWeight = '500';
            tempSpan.style.lineHeight = '1.25';
            tempSpan.style.letterSpacing = '0.025em'; // tracking-wide
            tempSpan.style.fontFamily = 'Inter, sans-serif';
            tempSpan.style.whiteSpace = 'pre-wrap';
            tempSpan.style.maxWidth = `${fixedWidth - 40}px`; // Fixed width minus padding
            tempSpan.innerText = label || '';
            document.body.appendChild(tempSpan);

            // Add vertical padding
            const contentHeight = tempSpan.offsetHeight + 40;

            // Snap to 16px grid
            const snap = (v: number) => Math.ceil(v / 16) * 16;
            const newH = Math.max(minHeight, snap(contentHeight));

            setHeight(newH);
            document.body.removeChild(tempSpan);
        }
    }, [label, fixedWidth, minHeight]);

    return { textRef, width: fixedWidth, height };
};

const getGlowColor = (color: string, opacityPercent = 45) =>
    `color-mix(in srgb, ${color} ${opacityPercent}%, transparent)`;

const NodeWrapper = ({ id, data, selected, className, children, label, color, style, textRef, hasDrilldown }: any) => {
    const draggedEntity = useUIStore(state => state.draggedEntity);
    const setDraggedEntity = useUIStore(state => state.setDraggedEntity);
    const linkContext = useJournalStore(state => state.linkContext);
    const labelRef = useRef<EditableLabelHandle>(null);

    const handleMouseUp = () => {
        if (draggedEntity?.type === 'journalEntry') {
            linkContext(draggedEntity.id, { id: id, type: 'node' });
            setDraggedEntity(null);
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        if (e.altKey) return; // Allow bubble for drilldown
        e.stopPropagation();
        labelRef.current?.startEditing();
    };

    return (
        <NodeTooltip content={data?.description as string} delay={2500}>
            <div
                onMouseUp={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                className={clsx(
                    "relative flex items-center justify-center transition-all duration-300 backdrop-blur-sm",
                    selected && "ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20",
                    className
                )}
                style={{
                    borderWidth: 'var(--app-node-border-width)',
                    borderStyle: 'solid',
                    borderColor: color,
                    color: color,
                    ...style,
                    ...(selected ? { '--tw-ring-color': color } as any : {})
                }}
            >
                {/* Eyebrow Label (Role/Actor annotation) */}
                {data?.eyebrow && (
                    <div
                        className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none select-none z-30"
                        style={{ color }}
                    >
                        <span className="text-[8px] font-bold uppercase tracking-[0.15em] opacity-70">
                            {data.eyebrow}
                        </span>
                    </div>
                )}
                <div className="flex flex-col items-center justify-center gap-2 p-4 text-center z-10 w-full h-full">
                    <div ref={textRef as any} className="hidden" />
                    <EditableLabel
                        ref={labelRef}
                        id={id}
                        label={label}
                        color={color}
                        multiline={true}
                        className="text-[11px] font-medium leading-tight tracking-wide"
                    />
                    {children}

                    {/* Drilldown/Subprocess Indicator */}
                    {hasDrilldown && (
                        <div className="absolute bottom-1.5 left-1.5 opacity-60 hover:opacity-100 transition-opacity" title="Contains sub-process (Alt+Double Click)">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                                <polyline points="2 17 12 22 22 17" />
                                <polyline points="2 12 12 17 22 12" />
                            </svg>
                        </div>
                    )}
                </div>
            </div>
        </NodeTooltip>
    );
};

// --- 1. START NODE (Pill - Auto Resizing) ---
export const StartNode = memo(({ id, data, selected }: NodeProps) => {
    const color = getPaletteColor(data.color ?? 'green');
    // Align to grid: 64px height -> Center 32px (divisible by 16)
    const { textRef, width, height } = useAutoResize(data.label, 224, 64);

    return (
        <div className="group relative" style={{ width, height, transition: 'width 0.2s, height 0.2s', '--node-glow-color': getGlowColor(color), '--node-bg-color': color, '--node-accent-color': color } as any}>
            {/* Target Handles */}
            <Handle type="target" position={Position.Top} id="t-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Right} id="t-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Left} id="t-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            {/* Source Handles */}
            <Handle type="source" position={Position.Top} id="s-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Right} id="s-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Left} id="s-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            <NodeWrapper
                id={id}
                data={data}
                selected={selected}
                label={data.label}
                color={color}
                textRef={textRef}
                className="w-full h-full bg-app-surface border shape-pill hover:bg-app-hover"
                style={{ borderColor: color, color: color }}
                hasDrilldown={data.hasDrilldown}
            />
        </div>
    );
});
// --- 2. ACTION NODE (Rect - Auto Resizing) ---
export const ActionNode = memo(({ id, data, selected }: NodeProps) => {
    const color = getPaletteColor(data.color ?? 'blue');
    const { textRef, width, height } = useAutoResize(data.label, 224, 96); // Standard width, height-only expansion

    return (
        <div className="group relative" style={{ width, height, transition: 'width 0.2s, height 0.2s', '--node-glow-color': getGlowColor(color), '--node-bg-color': color, '--node-accent-color': color } as any}>
            <Handle type="target" position={Position.Top} id="t-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Right} id="t-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Left} id="t-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            <Handle type="source" position={Position.Top} id="s-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Right} id="s-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Left} id="s-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            <NodeWrapper
                id={id}
                data={data}
                selected={selected}
                label={data.label}
                color={color}
                textRef={textRef}
                className="w-full h-full bg-app-surface border shape-rect hover:bg-app-hover"
                style={{ borderColor: color }}
                hasDrilldown={data.hasDrilldown}
            />
        </div>
    );
});

// --- 3. DECISION NODE (Diamond - Auto Resizing) ---
export const DecisionNode = memo(({ id, data, selected }: NodeProps) => {
    const rawColor = data.color ?? 'white';
    const color = getPaletteColor(rawColor);
    const { theme } = useTheme();
    const isWhite = rawColor === 'white' || rawColor === '#e4e4e7' || (typeof rawColor === 'string' && rawColor.includes('white'));
    const accentColor = theme === 'soft' && isWhite ? getPaletteColor('gray') : color;
    const handleColor = isWhite && theme === 'hard' ? '#151515' : accentColor;
    const { textRef, width, height } = useAutoResize(data.label, 224, 160);
    const labelRef = useRef<EditableLabelHandle>(null);

    const diamondSize = Math.min(width, height) * 0.8;
    const draggedEntity = useUIStore(state => state.draggedEntity);
    const setDraggedEntity = useUIStore(state => state.setDraggedEntity);
    const linkContext = useJournalStore(state => state.linkContext);

    const handleMouseUp = () => {
        if (draggedEntity?.type === 'journalEntry') {
            linkContext(draggedEntity.id, { id, type: 'node' });
            setDraggedEntity(null);
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        if (e.altKey) return;
        e.stopPropagation();
        labelRef.current?.startEditing();
    };

    // Offset for handles: diamond is 0.8× container, so handles need to move inward by 10%
    const handleOffset = `${((1 - 0.8) / 2) * 100}%`; // 10%

    return (
        <div
            onMouseUp={handleMouseUp}
            className="relative flex items-center justify-center group pointer-events-none"
            style={{
                width,
                height,
                transition: 'width 0.2s, height 0.2s',
                '--node-glow-color': getGlowColor(accentColor),
                '--node-bg-color': isWhite ? 'var(--color-app-surface, #ffffff)' : color,
                '--node-accent-color': accentColor
            } as any}
        >
            {/* Handles - Positioned at diamond tips, not container edges */}
            <Handle type="target" position={Position.Top} id="t-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="target" position={Position.Right} id="t-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor, right: handleOffset }} />
            <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="target" position={Position.Left} id="t-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor, left: handleOffset }} />

            <Handle type="source" position={Position.Top} id="s-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="source" position={Position.Right} id="s-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor, right: handleOffset }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="source" position={Position.Left} id="s-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform z-30 pointer-events-auto" style={{ background: handleColor, left: handleOffset }} />

            <NodeTooltip content={data?.description as string} delay={2500}>
                {/* The Actual Visible Diamond */}
                <div
                    className={clsx(
                        "bg-app-surface border shape-diamond-container transition-all duration-500 pointer-events-auto",
                        selected && "ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20",
                        "group-hover:bg-app-hover shadow-soft-down"
                    )}
                    onDoubleClick={handleDoubleClick}
                    style={{
                        width: `${diamondSize}px`,
                        height: `${diamondSize}px`,
                        borderWidth: 'var(--app-node-border-width)',
                        borderColor: accentColor,
                        '--tw-ring-color': accentColor,
                        '--node-bg-color': isWhite ? 'var(--color-app-surface, #ffffff)' : color,
                        '--node-accent-color': accentColor,
                        '--node-glow-color': getGlowColor(accentColor)
                    } as any}
                >
                    <div className="shape-diamond-content flex-col gap-1 p-2 flex items-center justify-center h-full w-full">
                        <div ref={textRef as any} className="hidden" />
                        <EditableLabel
                            ref={labelRef}
                            id={id}
                            label={data.label}
                            color={accentColor}
                            multiline={true}
                            style={{ textTransform: 'none' }}
                            className="text-[11px] font-medium text-center w-[152px] max-w-[152px] leading-tight tracking-wide opacity-90 group-hover:opacity-100 transition-opacity"
                        />
                    </div>
                </div>
            </NodeTooltip>
        </div>
    );
});

// --- 4. SYSTEM NODE (Auto Resizing) ---
export const SystemNode = memo(({ id, data, selected }: NodeProps) => {
    const color = getPaletteColor(data.color ?? 'purple');
    const { textRef, width, height } = useAutoResize(data.label, 224, 96); // Standard width, height-only expansion
    const labelRef = useRef<EditableLabelHandle>(null);

    const draggedEntity = useUIStore(state => state.draggedEntity);
    const setDraggedEntity = useUIStore(state => state.setDraggedEntity);
    const linkContext = useJournalStore(state => state.linkContext);

    const handleMouseUp = () => {
        if (draggedEntity?.type === 'journalEntry') {
            linkContext(draggedEntity.id, { id, type: 'node' });
            setDraggedEntity(null);
        }
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        if (e.altKey) return; // Allow bubble for drilldown
        e.stopPropagation();
        labelRef.current?.startEditing();
    };

    return (
        <div
            onMouseUp={handleMouseUp}
            className="group relative"
            style={{ width, height, transition: 'width 0.2s, height 0.2s', '--node-glow-color': getGlowColor(color), '--node-bg-color': color, '--node-accent-color': color } as any}
        >
            <Handle type="target" position={Position.Top} id="t-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Right} id="t-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Left} id="t-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            <Handle type="source" position={Position.Top} id="s-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Right} id="s-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Left} id="s-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            {/* Custom Chamfered Border & Body */}
            <NodeTooltip content={data?.description as string} delay={2500}>
                <>
                {/* Outer shadow wrapper to prevent clip-path from cutting off the drop-shadow */}
                <div className="absolute inset-0 shape-system-shadow transition-all duration-300">
                    {selected && (
                        <div
                            className="absolute shape-system-selection-ring pointer-events-none transition-all duration-200 z-10"
                            style={{
                                inset: '-5.5px',
                                clipPath: 'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
                                backgroundColor: color,
                            }}
                        >
                            <div
                                className="absolute"
                                style={{
                                    inset: '2.5px',
                                    clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
                                    backgroundColor: 'var(--color-app-bg)',
                                }}
                            />
                        </div>
                    )}
                    <div className={clsx(
                        "absolute inset-0 clip-chamfer shape-system pointer-events-auto",
                        selected ? "z-20" : ""
                    )}
                        onDoubleClick={handleDoubleClick}
                        style={{
                            backgroundColor: color, // Use solid palette color as border
                        }}
                    >
                        {/* Inner Content Area - Inset to show background as border */}
                        <div className={clsx(
                            "absolute bg-app-surface clip-chamfer transition-all"
                        )}
                            style={{
                                inset: 'var(--app-node-border-width)'
                            }}
                        >
                            <div ref={textRef as any} className="hidden" />
                        </div>
                    </div>
                </div>
                {/* The text is placed outside the clip-chamfer container so it does not inherit the CSS drop-shadow filter */}
                <div className={clsx("absolute inset-0 flex items-center justify-center p-4", selected ? "z-30" : "z-10")} style={{ pointerEvents: 'none' }}>
                    <EditableLabel
                        ref={labelRef}
                        id={id}
                        label={data.label}
                        color={color}
                        multiline={true}
                        style={{ textTransform: 'none' }}
                        className="text-[11px] font-medium leading-tight text-center tracking-widest pointer-events-auto"
                    />
                </div>
                </>
            </NodeTooltip>
        </div>
    );
});

// --- 5. END NODE (Red Pill - Auto Resizing) ---
export const EndNode = memo(({ id, data, selected }: NodeProps) => {
    const color = getPaletteColor(data.color ?? 'red');
    // Align to grid: 64px height -> Center 32px (divisible by 16)
    const { textRef, width, height } = useAutoResize(data.label, 224, 64);

    return (
        <div className="group relative" style={{ width, height, transition: 'width 0.2s, height 0.2s', '--node-glow-color': getGlowColor(color), '--node-bg-color': color, '--node-accent-color': color } as any}>
            <Handle type="target" position={Position.Top} id="t-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Right} id="t-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="target" position={Position.Left} id="t-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            <Handle type="source" position={Position.Top} id="s-top" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Right} id="s-right" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
            <Handle type="source" position={Position.Left} id="s-left" className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />

            <NodeWrapper
                id={id}
                data={data}
                selected={selected}
                label={data.label}
                color={color}
                textRef={textRef}
                className="w-full h-full bg-app-surface border shape-pill hover:bg-app-hover"
                style={{ borderColor: color }}
                hasDrilldown={data.hasDrilldown}
            />
        </div>
    );
});
