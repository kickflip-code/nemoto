import { memo } from 'react';
import { NodeProps, Handle, Position } from 'reactflow';
import { ArrowUp } from 'lucide-react';
import clsx from 'clsx';
import { getPaletteColor } from '../../../constants/palette';
import { useTheme } from '../../../context/ThemeContext';
import { NodeTooltip } from '../../shared/NodeTooltip';

export const ArrowNode = memo(({ data, selected }: NodeProps) => {
    const { theme } = useTheme();
    const color = getPaletteColor(data.color ?? 'purple');
    const rotation = typeof data.rotation === 'number' ? data.rotation : 0;

    // Glow effect for selected state (consistent with other nodes)
    const glowStyle = (selected && theme !== 'hard') ? {
        boxShadow: `0 0 20px -2px color-mix(in srgb, ${color} 40%, transparent)`,
        borderColor: color
    } : {};

    return (
        <NodeTooltip content={data.description as string} delay={2500}>
            <div
                className={clsx(
                    "group relative w-16 h-16 flex items-center justify-center axiom-transition-canvas",
                    selected && "z-50"
                )}
                style={{
                    '--node-bg-color': color,
                    '--node-accent-color': color,
                    '--node-glow-color': `color-mix(in srgb, ${color} 45%, transparent)`
                } as React.CSSProperties}
            >
                {/* The Arrow Container */}
                <div
                    className={clsx(
                        "w-12 h-12 flex items-center justify-center rounded-xl bg-app-surface border shape-arrow axiom-transition-canvas",
                        "hover:bg-app-hover shadow-soft-down pointer-events-auto"
                    )}
                    style={{
                        transform: `rotate(${rotation}deg)`,
                        borderColor: color,
                        ...glowStyle
                    }}
                >
                    <ArrowUp
                        size={32}
                        strokeWidth={2.5}
                        style={{ color: color }}
                        className="transition-colors axiom-transition-fast"
                    />
                </div>

                {/* Handles - only visible on hover or selection */}
                <Handle
                    type="target"
                    position={Position.Top}
                    className={clsx(
                        "!w-2 !h-2 !border-2 !border-app-bg transition-opacity",
                        (selected || "group-hover:opacity-100") ? "opacity-100" : "opacity-0"
                    )}
                    style={{ background: color }}
                />
                <Handle
                    type="source"
                    position={Position.Bottom}
                    className={clsx(
                        "!w-2 !h-2 !border-2 !border-app-bg transition-opacity",
                        (selected || "group-hover:opacity-100") ? "opacity-100" : "opacity-0"
                    )}
                    style={{ background: color }}
                />
            </div>
        </NodeTooltip>
    );
});

ArrowNode.displayName = 'ArrowNode';
