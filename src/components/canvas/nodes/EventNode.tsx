import { memo, useRef, type CSSProperties } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import clsx from 'clsx';
import { Handle, Position, type NodeProps } from 'reactflow';
import { getPaletteColor } from '../../../constants/palette';
import {
    EVENT_BEHAVIOR_LABELS,
    EVENT_KIND_LABELS,
    formatEventTiming,
    hasEventTiming,
    resolveEventBehavior,
    resolveEventKind,
} from '../../../lib/events';
import type { EventData } from '../../../types';
import { useJournalStore } from '../../../stores/useJournalStore';
import { useUIStore } from '../../../stores/useUIStore';
import { NodeTooltip } from '../../shared/NodeTooltip';
import { EventKindIcon } from '../../shared/EventKindIcon';
import { EditableLabel, type EditableLabelHandle } from './EditableLabel';

const EventHandles = () => (
    <>
        {([Position.Top, Position.Right, Position.Bottom, Position.Left] as const).map(position => (
            <Handle
                key={`target-${position}`}
                type="target"
                position={position}
                id={`t-${position}`}
                className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform"
                style={{ background: 'var(--node-accent-color)' }}
            />
        ))}
        {([Position.Top, Position.Right, Position.Bottom, Position.Left] as const).map(position => (
            <Handle
                key={`source-${position}`}
                type="source"
                position={position}
                id={`s-${position}`}
                className="!w-2 !h-2 !border-2 !border-app-bg hover:!scale-125 transition-transform"
                style={{ background: 'var(--node-accent-color)' }}
            />
        ))}
    </>
);

const getGlowColor = (color: string, opacityPercent = 45) =>
    `color-mix(in srgb, ${color} ${opacityPercent}%, transparent)`;

export const EventNode = memo(({ id, data, selected }: NodeProps) => {
    const labelRef = useRef<EditableLabelHandle>(null);
    const draggedEntity = useUIStore(state => state.draggedEntity);
    const setDraggedEntity = useUIStore(state => state.setDraggedEntity);
    const linkContext = useJournalStore(state => state.linkContext);
    const event = data.event as EventData | null | undefined;
    const kind = resolveEventKind(event);
    const behavior = resolveEventBehavior(event);
    const timingVisible = hasEventTiming(event?.timing);
    const temporalLabel = formatEventTiming(event?.timing);
    const temporalIconIsCalendar = (event?.timing?.start || event?.timing?.end)?.kind === 'date';
    const width = Number(data.width) || 224;
    const height = Number(data.height) || (timingVisible ? 104 : 88);
    const selectedColor = typeof data.color === 'string' && data.color.trim()
        ? getPaletteColor(data.color)
        : null;
    const accentColor = selectedColor || 'var(--color-node-event-accent)';
    const borderColor = selectedColor || 'var(--color-node-event-border)';
    const isWhite = data.color === 'white' || data.color === '#e4e4e7' || accentColor.includes('palette-white');
    const headerAccentColor = isWhite ? 'var(--palette-white-text, var(--color-text-main))' : accentColor;

    const handleMouseUp = () => {
        if (draggedEntity?.type === 'journalEntry') {
            linkContext(draggedEntity.id, { id, type: 'node' });
            setDraggedEntity(null);
        }
    };

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
                '--node-glow-color': getGlowColor(accentColor),
            } as CSSProperties}
        >
            <EventHandles />
            <NodeTooltip
                content={[
                    `${EVENT_KIND_LABELS[kind]} · ${EVENT_BEHAVIOR_LABELS[behavior]}`,
                    timingVisible ? temporalLabel : null,
                    data.description,
                ].filter(Boolean).join(' · ')}
                delay={1500}
            >
                <div
                    className={clsx(
                        'shape-event relative flex h-full w-full flex-col justify-between overflow-hidden border axiom-transition-canvas backdrop-blur-sm pointer-events-auto',
                        'hover:shadow-[0_0_16px_-2px_var(--node-glow-color)] shadow-soft-down',
                        selected && 'ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20',
                    )}
                    data-event-kind={kind}
                    data-event-behavior={behavior}
                    onMouseUp={handleMouseUp}
                    onDoubleClick={eventObject => {
                        if (eventObject.altKey) return;
                        eventObject.stopPropagation();
                        labelRef.current?.startEditing();
                    }}
                    style={{
                        background: 'var(--node-bg-color)',
                        borderColor: 'var(--node-border-color)',
                        color: 'var(--node-text-color)',
                        borderWidth: 'var(--app-node-border-width)',
                        borderRadius: 'var(--app-radius-node)',
                        boxShadow: selected ? `0 0 16px -2px ${getGlowColor(accentColor, 34)}` : undefined,
                        ...(selected ? { '--tw-ring-color': 'var(--node-accent-color)' } as CSSProperties : {}),
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
                        <EditableLabel
                            ref={labelRef}
                            id={id}
                            label={data.label || 'Untitled Event'}
                            color="var(--node-text-color)"
                            multiline
                            className="event-node-title text-[12px] font-semibold leading-tight text-left"
                        />
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
            </NodeTooltip>
        </div>
    );
});

EventNode.displayName = 'EventNode';
