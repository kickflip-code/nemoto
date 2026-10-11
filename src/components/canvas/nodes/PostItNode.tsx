import { memo, useRef } from 'react';
import { NodeProps } from 'reactflow';
import { FileText } from 'lucide-react';
import clsx from 'clsx';
import { EditableLabel, EditableLabelHandle } from './EditableLabel';
import { getPaletteColor } from '../../../constants/palette';

export const PostItNode = memo(({ id, data, selected }: NodeProps) => {
    const labelRef = useRef<EditableLabelHandle>(null);

    const activeHexColor = getPaletteColor(data.color ?? 'amber');
    const isWhite = data.color === 'white' || data.color === '#e4e4e7' || activeHexColor.includes('palette-white');
    const headerColor = isWhite ? 'var(--palette-white-text, var(--color-text-main))' : activeHexColor;

    const handleDoubleClick = (e: React.MouseEvent) => {
        if (e.altKey) return;
        e.stopPropagation();
        labelRef.current?.startEditing();
    };

    return (
        <div
            className={clsx(
                "group relative w-48 min-h-[64px] p-3 axiom-transition-canvas shape-post-it",
                "bg-app-surface border backdrop-blur-md shadow-soft-down",
                selected && "ring-2 ring-offset-2 ring-offset-app-bg z-50 shadow-lg"
            )}
            style={{
                borderColor: activeHexColor,
                '--tw-ring-color': activeHexColor,
                '--node-bg-color': activeHexColor,
                '--node-accent-color': activeHexColor,
                '--node-glow-color': `color-mix(in srgb, ${activeHexColor} 45%, transparent)`,
                borderRadius: 'var(--app-radius-node, var(--app-radius-lg, 8px))'
            } as React.CSSProperties}
            onDoubleClick={handleDoubleClick}
        >
            {/* Header: Icon + "NOTE" */}
            <div className="post-it-header flex items-center gap-1.5 mb-2 pointer-events-none opacity-90">
                <FileText size={12} style={{ color: headerColor }} />
                <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: headerColor }}>
                    NOTE
                </span>
            </div>

            {/* Content Area */}
            <div className="relative z-10 w-full h-full flex font-sans text-xs text-text-muted opacity-90 group-hover:opacity-100 transition-opacity">
                <EditableLabel
                    ref={labelRef}
                    id={id}
                    label={data.label || 'Details...'}
                    color={activeHexColor}
                    className="w-full text-left leading-relaxed text-[11px]"
                    multiline={true}
                />
            </div>

            {/* Purposely omitted Handles to prevent edge connections */}
        </div>
    );
});

PostItNode.displayName = 'PostItNode';
