import { DivisionBackground } from '../../components/canvas/DivisionBackground';
import { withLinkedContent } from '../../components/canvas/NodeLinkedContentBase';
import { memo, useRef, useState, useLayoutEffect } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import clsx from 'clsx';
import { FileText, ArrowUp, Layers, Database, CalendarDays, Clock3, AlertCircle } from 'lucide-react';
import { getIconComponent } from '../../lib/iconMap';
import {
    EVENT_BEHAVIOR_LABELS,
    EVENT_KIND_LABELS,
    formatEventTiming,
    hasEventTiming,
    resolveEventBehavior,
    resolveEventKind,
} from '../../lib/events';
import type { EventData } from '../../types';
import { EventKindIcon } from '../../components/shared/EventKindIcon';
import { RESOURCE_NODE_SIZE } from '../../lib/edgeRouting';
import { resolveViewerColor, withViewerColorAlpha } from './viewerColors';

/**
 * HTML Export Viewer Node Types
 * ULTRATHINK: Re-engineered to exactly match the main application's aesthetics.
 */

const useAutoResize = (label: string, fixedWidth: number, minHeight: number) => {
    const textRef = useRef<HTMLSpanElement>(null);
    const [height, setHeight] = useState(minHeight);

    useLayoutEffect(() => {
        const tempSpan = document.createElement('span');
        tempSpan.style.visibility = 'hidden';
        tempSpan.style.position = 'absolute';
        tempSpan.style.fontSize = '11px';
        tempSpan.style.fontWeight = '500';
        tempSpan.style.lineHeight = '1.25';
        tempSpan.style.letterSpacing = '0.025em';
        tempSpan.style.fontFamily = 'Inter, sans-serif';
        tempSpan.style.whiteSpace = 'pre-wrap';
        tempSpan.style.maxWidth = `${fixedWidth - 40}px`;
        tempSpan.innerText = label || '';
        document.body.appendChild(tempSpan);

        const contentHeight = tempSpan.offsetHeight + 40;
        const snap = (v: number) => Math.ceil(v / 16) * 16;
        const newH = Math.max(minHeight, snap(contentHeight));

        document.body.removeChild(tempSpan);
        if (newH !== height) setHeight(newH);
    }, [label, fixedWidth, minHeight, height]);

    return { textRef, width: fixedWidth, height };
};

const useResourceAutoResize = (label: string, fixedWidth: number, minHeight: number) => {
    const [height, setHeight] = useState(minHeight);

    useLayoutEffect(() => {
        const tempSpan = document.createElement('span');
        tempSpan.style.visibility = 'hidden';
        tempSpan.style.position = 'absolute';
        tempSpan.style.fontSize = '12px';
        tempSpan.style.fontWeight = '600';
        tempSpan.style.lineHeight = '1.25';
        tempSpan.style.letterSpacing = '0.015em';
        tempSpan.style.fontFamily = 'Inter, sans-serif';
        tempSpan.style.whiteSpace = 'pre-wrap';
        tempSpan.style.maxWidth = `${fixedWidth - 40}px`;
        tempSpan.innerText = label || '';
        document.body.appendChild(tempSpan);

        const contentHeight = tempSpan.offsetHeight + 68;
        const snappedHeight = Math.ceil(contentHeight / 16) * 16;
        const nextHeight = Math.max(minHeight, snappedHeight);

        document.body.removeChild(tempSpan);
        if (nextHeight !== height) setHeight(nextHeight);
    }, [label, fixedWidth, minHeight, height]);

    return { width: fixedWidth, height };
};

const MultiHandle = ({ type, color }: { type: 'source' | 'target', color?: string }) => (
    <>
        <Handle type={type} position={Position.Top} id={`${type[0]}-top`}
            className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
        <Handle type={type} position={Position.Right} id={`${type[0]}-right`}
            className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
        <Handle type={type} position={Position.Bottom} id={`${type[0]}-bottom`}
            className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
        <Handle type={type} position={Position.Left} id={`${type[0]}-left`}
            className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform" style={{ background: color }} />
    </>
);

const NodeWrapper = ({ selected, className, children, label, color, style, hasDrilldown, data }: any) => {
    const glowStyle = selected ? {
        boxShadow: `0 0 20px -2px ${withViewerColorAlpha(color, '60')}`,
        borderColor: color
    } : {};

    return (
        <div
            className={clsx(
                "relative flex items-center justify-center transition-all duration-300 backdrop-blur-sm",
                selected && "ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20",
                className
            )}
            style={{
                borderWidth: 'var(--app-node-border-width)',
                borderStyle: 'solid',
                ...style,
                ...glowStyle,
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
                <span
                    className="viewer-node-label text-[11px] font-medium leading-tight tracking-wide"
                    style={{ color }}
                >
                    {label}
                </span>
                {children}
                {hasDrilldown && (
                    <div className="absolute bottom-1.5 left-1.5 opacity-60" title="Contains sub-process">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                            <polyline points="2 17 12 22 22 17" />
                            <polyline points="2 12 12 17 22 12" />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
};

export const StartNode = memo(({ data, selected }: NodeProps) => {
    const color = resolveViewerColor(data.color || 'green')!;
    const { width, height } = useAutoResize(data.label, data.width || 224, data.height || 64);
    return (
        <div className="group relative" style={{ width, height, '--node-bg-color': color, '--node-accent-color': color, '--node-glow-color': `color-mix(in srgb, ${color} 45%, transparent)` } as any}>
            <MultiHandle type="target" color={color} />
            <MultiHandle type="source" color={color} />
            <NodeWrapper
                selected={selected}
                label={data.label}
                color={color}
                data={data}
                className="w-full h-full bg-app-surface border shape-pill hover:bg-app-hover"
                style={{ borderColor: color, color: color }}
                hasDrilldown={data.hasChildren}
            />
        </div>
    );
});

export const ActionNode = memo(({ data, selected }: NodeProps) => {
    const color = resolveViewerColor(data.color || 'blue')!;
    const { width, height } = useAutoResize(data.label, data.width || 224, data.height || 96);
    return (
        <div className="group relative" style={{ width, height, '--node-bg-color': color, '--node-accent-color': color, '--node-glow-color': `color-mix(in srgb, ${color} 45%, transparent)` } as any}>
            <MultiHandle type="target" color={color} />
            <MultiHandle type="source" color={color} />
            <NodeWrapper
                selected={selected}
                label={data.label}
                color={color}
                data={data}
                className="w-full h-full bg-app-surface border shape-rect hover:bg-app-hover"
                style={{ borderColor: color }}
                hasDrilldown={data.hasChildren}
            >
                {data.assetIds?.length > 0 && (
                    <div className="text-[9px] uppercase font-bold tracking-widest text-text-faint mt-1">
                        {data.assetIds.length} Resources
                    </div>
                )}
            </NodeWrapper>
        </div>
    );
});

export const DecisionNode = memo(({ data, selected }: NodeProps) => {
    const rawColor = data.color;
    const isWhite = !rawColor || rawColor === 'white' || rawColor === '#e4e4e7' || (typeof rawColor === 'string' && rawColor.includes('white'));
    const resolvedColor = resolveViewerColor(rawColor) || rawColor || 'var(--palette-white, #e4e4e7)';
    const color = resolvedColor;
    const theme = document.documentElement.getAttribute('data-theme') || 'void';
    const accentColor = theme === 'soft' && isWhite
        ? resolveViewerColor('gray')!
        : color;
    const handleColor = isWhite && theme === 'hard' ? '#151515' : accentColor;
    const textColor = accentColor;
    const { width, height } = useAutoResize(data.label, data.width || 224, data.height || 160);
    const diamondSize = Math.min(width, height) * 0.8;
    const handleOffset = `${((1 - 0.8) / 2) * 100}%`;

    return (
        <div className="relative flex items-center justify-center group pointer-events-none" style={{ width, height, '--node-bg-color': isWhite ? 'var(--color-app-surface, #ffffff)' : color, '--node-accent-color': accentColor, '--node-glow-color': `color-mix(in srgb, ${accentColor} 45%, transparent)` } as any}>
            <Handle type="target" position={Position.Top} id="t-top" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="target" position={Position.Right} id="t-right" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor, right: handleOffset }} />
            <Handle type="target" position={Position.Bottom} id="t-bottom" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="target" position={Position.Left} id="t-left" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor, left: handleOffset }} />
            <Handle type="source" position={Position.Top} id="s-top" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="source" position={Position.Right} id="s-right" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor, right: handleOffset }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor }} />
            <Handle type="source" position={Position.Left} id="s-left" className="!w-2 !h-2 !border-2 !border-app-bg z-30 pointer-events-auto" style={{ background: handleColor, left: handleOffset }} />

            <div
                className={clsx(
                    "bg-app-surface border shape-diamond-container transition-all duration-500 pointer-events-auto",
                    selected && "ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20",
                    "group-hover:bg-app-hover shadow-soft-down"
                )}
                style={{
                    width: `${diamondSize}px`,
                    height: `${diamondSize}px`,
                    borderWidth: 'var(--app-node-border-width)',
                    borderColor: accentColor,
                    '--tw-ring-color': accentColor,
                    '--node-bg-color': isWhite ? 'var(--color-app-surface, #ffffff)' : color,
                    '--node-accent-color': accentColor,
                    '--node-glow-color': `color-mix(in srgb, ${accentColor} 45%, transparent)`
                } as any}
            >
                <div className="shape-diamond-content flex-col gap-1 p-2 flex items-center justify-center h-full w-full">
                    <span
                        className="viewer-node-label text-[11px] font-medium leading-tight tracking-wide opacity-90 w-[152px] max-w-[152px] whitespace-pre-wrap break-words text-center block text-text-main"
                        style={{ textTransform: 'none', color: textColor }}
                    >
                        {data.label}
                    </span>
                </div>
            </div>
        </div>
    );
});

export const SystemNode = memo(({ data, selected }: NodeProps) => {
    const color = resolveViewerColor(data.color || 'purple')!;
    const { width, height } = useAutoResize(data.label, data.width || 224, data.height || 96);
    return (
        <div className="group relative" style={{ width, height, '--node-bg-color': color, '--node-accent-color': color, '--node-glow-color': `color-mix(in srgb, ${color} 45%, transparent)` } as any}>
            <MultiHandle type="target" color={color} />
            <MultiHandle type="source" color={color} />
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
                    style={{
                        backgroundColor: color, // Removed alpha B3 for parity
                    }}
                >
                    <div className="absolute bg-app-surface clip-chamfer flex items-center justify-center p-4 transition-all"
                        style={{ inset: 'var(--app-node-border-width)' }}
                    />
                </div>
            </div>
            {/* The text is placed outside the clip-chamfer container so it does not inherit the CSS drop-shadow filter */}
            <div className={clsx("absolute inset-0 flex items-center justify-center p-4", selected ? "z-30" : "z-10")} style={{ pointerEvents: 'none' }}>
                <span
                    className="viewer-node-label text-[11px] font-medium leading-tight text-center tracking-widest whitespace-pre-wrap break-words"
                    style={{ textTransform: 'none', color }}
                >
                    {data.label}
                </span>
            </div>
        </div>
    );
});

export const EndNode = memo(({ data, selected }: NodeProps) => {
    const color = resolveViewerColor(data.color || 'red')!;
    const { width, height } = useAutoResize(data.label, data.width || 224, data.height || 64);
    return (
        <div className="group relative" style={{ width, height, '--node-bg-color': color, '--node-accent-color': color, '--node-glow-color': `color-mix(in srgb, ${color} 45%, transparent)` } as any}>
            <MultiHandle type="target" color={color} />
            <MultiHandle type="source" color={color} />
            <NodeWrapper
                selected={selected}
                label={data.label}
                color={color}
                data={data}
                className="w-full h-full bg-app-surface border shape-pill hover:bg-app-hover"
                style={{ borderColor: color }}
                hasDrilldown={data.hasChildren}
            />
        </div>
    );
});

export const ViewerEventNode = memo(({ data, selected }: NodeProps) => {
    const event = data.event as EventData | null | undefined;
    const kind = resolveEventKind(event);
    const behavior = resolveEventBehavior(event);
    const timingVisible = hasEventTiming(event?.timing);
    const temporalLabel = formatEventTiming(event?.timing);
    const temporalIconIsCalendar = (event?.timing?.start || event?.timing?.end)?.kind === 'date';
    const width = data.width || 224;
    const height = data.height || (timingVisible ? 104 : 88);
    const selectedColor = resolveViewerColor(data.color);
    const accentColor = selectedColor || 'var(--color-node-event-accent)';
    const borderColor = selectedColor || 'var(--color-node-event-border)';
    const isWhite = data.color === 'white' || data.color === '#e4e4e7' || accentColor.includes('palette-white');
    const headerAccentColor = isWhite ? 'var(--palette-white-text, var(--color-text-main))' : accentColor;

    return (
        <div
            className="group relative"
            style={{
                width,
                height,
                '--node-bg-color': 'var(--color-node-event-bg)',
                '--node-border-color': borderColor,
                '--node-text-color': 'var(--color-node-event-text)',
                '--node-accent-color': accentColor,
                '--node-glow-color': `color-mix(in srgb, ${accentColor} 45%, transparent)`,
            } as React.CSSProperties}
        >
            <MultiHandle type="target" color="var(--node-accent-color)" />
            <MultiHandle type="source" color="var(--node-accent-color)" />
            <div
                className={clsx(
                    'shape-event relative flex h-full w-full flex-col justify-between overflow-hidden border transition-all duration-300',
                    selected && 'ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20',
                )}
                data-event-kind={kind}
                data-event-behavior={behavior}
                style={{
                    background: 'var(--node-bg-color)',
                    borderColor: 'var(--node-border-color)',
                    color: 'var(--node-text-color)',
                    borderWidth: 'var(--app-node-border-width)',
                    borderRadius: 'var(--app-radius-node)',
                    ...(selected ? { '--tw-ring-color': 'var(--node-accent-color)' } as React.CSSProperties : {}),
                }}
            >
                <div className="event-node-header flex items-center justify-between gap-2 px-3 pt-2.5 pb-1 shrink-0">
                    <span
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.14em]"
                        style={{
                            backgroundColor: `color-mix(in srgb, ${headerAccentColor} 12%, transparent)`,
                            color: headerAccentColor,
                        }}
                    >
                        <EventKindIcon kind={kind} /> {EVENT_KIND_LABELS[kind]} Event
                    </span>
                    <span
                        className={`event-node-badge event-node-behavior-${behavior} text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border`}
                        style={{
                            borderColor: `color-mix(in srgb, ${headerAccentColor} 28%, transparent)`,
                            ...(isWhite ? {
                                backgroundColor: `color-mix(in srgb, ${headerAccentColor} 12%, transparent)`,
                                color: headerAccentColor,
                            } : { color: behavior === 'emitted' ? undefined : headerAccentColor }),
                        }}
                    >
                        {EVENT_BEHAVIOR_LABELS[behavior]}
                    </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col justify-center px-3 py-1">
                    <span className="viewer-node-label event-node-title text-left text-[12px] font-semibold leading-tight">
                        {data.label || 'Untitled Event'}
                    </span>
                </div>
                {timingVisible && (
                    <div className="px-3 pb-2 pt-0.5 shrink-0">
                        <span className="event-node-time flex items-center gap-1.5 text-[9px] leading-tight opacity-75">
                            {temporalIconIsCalendar
                                ? <CalendarDays size={10} aria-hidden="true" className="shrink-0" />
                                : <Clock3 size={10} aria-hidden="true" className="shrink-0" />}
                            <span className="line-clamp-1">{temporalLabel}</span>
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
});

export const ViewerResourceNode = memo(({ data, selected }: NodeProps) => {
    const asset = data.asset;
    const category = data.category;
    const displayName = asset?.name || data.label || 'Resource';
    const categoryColor = resolveViewerColor(data.color) || resolveViewerColor(category?.color) || 'var(--color-accent-primary)';
    const rawColor = data.color || category?.color || 'amber';
    const isWhite = rawColor === 'white' || rawColor === '#e4e4e7' || categoryColor.includes('palette-white');
    const badgeColor = isWhite ? 'var(--palette-white-text, var(--color-text-main))' : categoryColor;
    const IconComponent = category?.icon ? getIconComponent(category.icon) : Database;
    const categoryLabel = category?.label || asset?.type || 'Resource';
    const isMissingAsset = !asset && !!data.assetId;
    const metadataCount = asset?.metadata ? Object.keys(asset.metadata).length : 0;
    const { width, height } = useResourceAutoResize(
        displayName,
        Math.max(data.width || 0, RESOURCE_NODE_SIZE.width),
        Math.max(data.height || 0, RESOURCE_NODE_SIZE.height),
    );

    return (
        <div
            className={clsx(
                "shape-resource relative flex flex-col justify-between p-2.5 axiom-transition-canvas backdrop-blur-sm pointer-events-auto",
                "bg-app-surface hover:bg-app-hover border shadow-soft-down",
                selected && "ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20",
                isMissingAsset && "border-dashed border-accent-danger/70 bg-accent-danger/5"
            )}
            style={{
                width,
                height,
                borderRadius: 'var(--app-radius-node, var(--app-radius-lg, 12px))',
                borderColor: isMissingAsset ? 'var(--color-accent-danger, #ef4444)' : categoryColor,
                borderWidth: 'var(--app-node-border-width, 1.5px)',
                borderStyle: 'solid',
                '--node-bg-color': categoryColor,
                '--node-accent-color': categoryColor,
                '--node-glow-color': `color-mix(in srgb, ${categoryColor} 45%, transparent)`
            } as any}
        >
            <MultiHandle type="target" color={categoryColor} />
            <MultiHandle type="source" color={categoryColor} />

            {/* Header: Category Badge */}
            <div className="flex items-center justify-between w-full gap-2 shrink-0">
                <div
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider select-none shrink-0 resource-category-badge"
                    style={{
                        backgroundColor: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
                        color: badgeColor,
                        border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                    }}
                >
                    <IconComponent size={10} strokeWidth={2.5} />
                    <span className="truncate max-w-[120px]">{categoryLabel}</span>
                </div>
                {isMissingAsset && <AlertCircle size={12} className="text-accent-danger shrink-0" />}
            </div>

            {/* Body: Resource Name */}
            <div className="flex flex-col justify-center flex-1 my-0.5 min-h-0">
                <span
                    className={clsx(
                        "text-[12px] font-semibold leading-snug tracking-tight text-text-main line-clamp-2 select-none",
                        isMissingAsset && "text-accent-danger italic font-normal text-[11px]",
                    )}
                    title={displayName}
                >
                    {isMissingAsset ? `Deleted Resource (${data.assetId})` : displayName}
                </span>
            </div>

            {/* Footer: Properties or Resource Indicator */}
            <div className="flex items-center justify-between text-[9px] text-text-faint select-none pt-1 border-t border-app-border/40 shrink-0">
                <span className="flex items-center gap-1 opacity-70">
                    <Layers size={9} />
                    <span>Resource</span>
                </span>
                {metadataCount > 0 && (
                    <span className="font-mono opacity-80">
                        {metadataCount} {metadataCount === 1 ? 'prop' : 'props'}
                    </span>
                )}
            </div>
        </div>
    );
});

export const SwimlaneNode = memo(({ data }: NodeProps) => {
    const isVertical = data.isVertical;

    return (
        <div
            className={clsx(
                "relative transition-shadow duration-300 pointer-events-none group",
                isVertical
                    ? "border-r border-dashed border-app-border/40"
                    : "border-b border-dashed border-app-border/40"
            )}
            style={{
                width: isVertical ? `${data.laneWidth}px` : '10000px',
                height: isVertical ? '10000px' : `${data.laneHeight}px`,
                backgroundColor: 'transparent'
            }}
        >
            {/* Header Zone */}
            <div
                className={clsx(
                    "absolute flex pointer-events-none border-app-border/40 bg-app-surface shadow-soft-down",
                    isVertical
                        ? "top-0 w-full h-12 border-b items-center justify-center"
                        : "left-0 h-full w-12 border-r"
                )}
            >
                {/* Accent Bar */}
                <div
                    className={clsx(
                        "absolute",
                        isVertical
                            ? "top-0 left-0 right-0 h-1"
                            : "left-0 top-0 bottom-[-1px] w-1"
                    )}
                    style={{ backgroundColor: resolveViewerColor(data.color) ?? undefined }}
                />

                {/* Label Area */}
                <div className="flex-1 flex items-center justify-center relative">
                    <span className={clsx(
                        "text-xs font-bold tracking-[0.2em] uppercase transition-all duration-300 select-none opacity-80",
                        !isVertical && "writing-vertical transform rotate-180"
                    )}
                        style={{ color: data.color === 'white' ? 'var(--color-text-main)' : (resolveViewerColor(data.color) ?? undefined) }}>
                        {data.label}
                    </span>
                </div>
            </div>

            {/* Dot Grid Layer underneath */}
            <div className={clsx(
                "absolute inset-0 bg-dot-grid opacity-[0.02] pointer-events-none",
                isVertical ? "mt-12" : "ml-12"
            )} />
        </div>
    );
});

export const PostItNode = memo(({ data, selected }: NodeProps) => {
    const activeHexColor = resolveViewerColor(data.color || 'amber')!;
    const isWhite = data.color === 'white' || data.color === '#e4e4e7' || (typeof activeHexColor === 'string' && activeHexColor.includes('palette-white'));
    const headerColor = isWhite ? 'var(--palette-white-text, var(--color-text-main))' : activeHexColor;

    return (
        <div className={clsx(
            "group relative p-3 transition-all duration-300 rounded-lg shape-post-it",
            "bg-app-surface border backdrop-blur-md shadow-soft-down",
            selected && "ring-2 ring-offset-2 ring-offset-app-bg z-50 shadow-lg"
        )}
            style={{
                width: data.width || 192,
                minHeight: data.height || 64,
                borderColor: activeHexColor,
                '--tw-ring-color': activeHexColor,
                '--node-bg-color': activeHexColor,
                '--node-accent-color': activeHexColor,
                '--node-glow-color': `color-mix(in srgb, ${activeHexColor} 45%, transparent)`
            } as React.CSSProperties}
        >
            {/* Header: Icon + "NOTE" */}
            <div className="post-it-header flex items-center gap-1.5 mb-2 pointer-events-none opacity-80">
                <FileText size={12} style={{ color: headerColor }} />
                <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: headerColor }}>
                    NOTE
                </span>
            </div>

            {/* Content Area */}
                <div
                    className="relative z-10 w-full h-full font-sans text-[11px] leading-relaxed whitespace-pre-wrap break-words"
                    style={{ color: activeHexColor }}
                >
                {data.label || 'Details...'}
            </div>
        </div>
    );
});

export const ArrowNode = memo(({ data, selected }: NodeProps) => {
    const color = resolveViewerColor(data.color) || '#a855f7';
    const rotation = typeof data.rotation === 'number' ? data.rotation : 0;

    return (
        <div
            className={clsx("group relative flex items-center justify-center", selected && "z-50")}
            style={{
                width: data.width || 64,
                height: data.height || 64,
                '--node-bg-color': color,
                '--node-accent-color': color,
                '--node-glow-color': `color-mix(in srgb, ${color} 45%, transparent)`
            } as any}
        >
            <Handle type="target" position={Position.Top} id="t-top"
                className="!w-2 !h-2 !border-2 !border-app-bg" style={{ background: color }} />
            <Handle type="source" position={Position.Bottom} id="s-bottom"
                className="!w-2 !h-2 !border-2 !border-app-bg" style={{ background: color }} />
            <div
                className={clsx(
                    "w-12 h-12 flex items-center justify-center rounded-xl bg-app-surface border shape-arrow transition-all duration-300",
                    selected ? "border-2" : "border-app-border",
                    "shadow-soft-down"
                )}
                style={{
                    transform: `rotate(${rotation}deg)`,
                    borderColor: selected ? color : undefined,
                    ...(selected ? { boxShadow: `0 0 20px -2px ${withViewerColorAlpha(color, '60')}` } : {}),
                }}
            >
                <ArrowUp size={32} strokeWidth={2.5}
                    style={{ color: selected ? color : 'var(--color-text-main)' }} />
            </div>
        </div>
    );
});

export const ViewerProcessHeaderNode = memo(({ data }: NodeProps) => {
    const IconComponent = data.ownerIcon ? getIconComponent(data.ownerIcon) : null;

    return (
        <div className="relative flex flex-col items-start px-0 py-2 select-none cursor-pointer group" style={{ pointerEvents: 'auto' }}>
            <div className="flex flex-col gap-2 relative z-10 w-full">
                <h1 className="text-3xl font-semibold font-display text-text-main tracking-tight leading-tight pr-10">
                    {data.processTitle || 'Untitled Process'}
                </h1>
                <div className="flex items-center gap-3">
                    {data.ownerName && (
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-app-surface shadow-sm border border-app-border text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">
                            {IconComponent && <IconComponent size={11} strokeWidth={2.5} className="text-accent-primary" />}
                            <span>{data.ownerName}</span>
                        </div>
                    )}
                    {data.processDescription && (
                        <p className="text-[12px] font-medium text-text-muted/60 leading-relaxed italic whitespace-pre-wrap max-w-md mt-1 border-l border-accent-primary/20 pl-3">
                            {data.processDescription}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
});

export const ViewerNodeTypes = {
    action: withLinkedContent(ActionNode),
    start: withLinkedContent(StartNode),
    end: withLinkedContent(EndNode),
    decision: withLinkedContent(DecisionNode),
    system: withLinkedContent(SystemNode),
    resource: withLinkedContent(ViewerResourceNode),
    event: withLinkedContent(ViewerEventNode),
    swimlane: SwimlaneNode,
    'division-background': ({ data }: NodeProps) => <DivisionBackground graph={data.graph} />,
    group: withLinkedContent(ActionNode),
    arrow: ArrowNode,
    'post-it': withLinkedContent(PostItNode),
    'process-header': ViewerProcessHeaderNode,
};
