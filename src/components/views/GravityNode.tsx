import { memo } from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import {
    Activity,
    Box,
    Database,
    File,
    FileText,
    HelpCircle,
    Tag,
    User,
    Workflow,
} from 'lucide-react';

const ICON_MAP: Record<string, typeof Activity> = {
    process: Workflow,
    asset: Box,
    entry: FileText,
    tag: Tag,
    node: Activity,
    system: Database,
    role: User,
    document: File,
    custom: Box,
};

const HANDLES = [
    { type: 'source' as const, id: 'source-t', position: Position.Top },
    { type: 'target' as const, id: 'target-t', position: Position.Top },
    { type: 'source' as const, id: 'source-b', position: Position.Bottom },
    { type: 'target' as const, id: 'target-b', position: Position.Bottom },
    { type: 'source' as const, id: 'source-l', position: Position.Left },
    { type: 'target' as const, id: 'target-l', position: Position.Left },
    { type: 'source' as const, id: 'source-r', position: Position.Right },
    { type: 'target' as const, id: 'target-r', position: Position.Right },
];

export const GravityNode = memo(({ data, selected }: NodeProps) => {
    const {
        label,
        type,
        weight = 0,
        isFocal,
        isContext,
        isMassive,
        color = 'var(--color-accent-primary)',
        icon: iconName,
        subtitle,
        relationCount = 0,
    } = data;
    const Icon = ICON_MAP[iconName?.toLowerCase()] || ICON_MAP[type] || HelpCircle;
    const borderColor = selected
        ? 'var(--color-text-main)'
        : isFocal
            ? color
            : `color-mix(in srgb, ${color} 48%, var(--color-app-border))`;

    return (
        <div
            className="group relative flex h-full w-full items-center gap-3 bg-app-surface px-3 py-2 text-text-main"
            style={{
                border: `${selected || isFocal ? 2 : 1}px ${isContext ? 'dashed' : 'solid'} ${borderColor}`,
                borderRadius: 'var(--app-radius-node)',
                boxShadow: isFocal
                    ? `0 0 28px color-mix(in srgb, ${color} 28%, transparent)`
                    : 'var(--app-shadow-sm)',
                opacity: isContext ? 0.72 : 1,
                transition: isMassive ? 'none' : 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
            }}
        >
            {HANDLES.map(handle => (
                <Handle
                    key={`${handle.type}-${handle.id}`}
                    type={handle.type}
                    id={handle.id}
                    position={handle.position}
                    className="pointer-events-none opacity-0"
                    style={{ width: 0, height: 0, border: 'none', background: 'transparent' }}
                />
            ))}

            <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-bg"
                style={{ color }}
            >
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
                <div
                    className="line-clamp-2 text-[12px] font-semibold leading-[1.25] text-text-main"
                    title={label}
                >
                    {label}
                </div>
                <div className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color }}>
                    {subtitle}
                </div>
            </div>

            {(weight > 0 || relationCount > 0) && (
                <div
                    className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full border bg-app-surface px-1.5 text-[10px] font-bold text-text-main"
                    style={{ borderColor: color }}
                    title={weight > 0
                        ? `${weight} tagged ${weight === 1 ? 'reference' : 'references'}`
                        : `${relationCount} ${relationCount === 1 ? 'relation' : 'relations'}`}
                >
                    {weight > 0 ? weight : relationCount}
                </div>
            )}

            {isFocal && (
                <div className="pointer-events-none absolute inset-[-7px] rounded-[inherit] border border-dashed opacity-50" style={{ borderColor: color }} />
            )}
        </div>
    );
});

GravityNode.displayName = 'GravityNode';
