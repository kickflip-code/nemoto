import { Handle, Position, NodeProps } from 'reactflow';
import { memo, useRef, useState, useLayoutEffect } from 'react';
import clsx from 'clsx';
import { Layers, AlertCircle } from 'lucide-react';
import { usePortfolioStore } from '../../../stores/usePortfolioStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useJournalStore } from '../../../stores/useJournalStore';
import { getPaletteColor } from '../../../constants/palette';
import { getIconComponent } from '../../../lib/iconMap';
import { NodeTooltip } from '../../shared/NodeTooltip';
import { RESOURCE_NODE_SIZE } from '../../../lib/edgeRouting';

const useAutoResize = (label: string, fixedWidth: number, minHeight: number) => {
    const textRef = useRef<HTMLSpanElement>(null);
    const [height, setHeight] = useState(minHeight);

    useLayoutEffect(() => {
        if (textRef.current) {
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

            // Adequate room for category badge (~22px) + footer (~18px) + padding (~20px) + borders (~8px)
            const contentHeight = tempSpan.offsetHeight + 68;
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

export const ResourceNode = memo(({ id, data, selected }: NodeProps) => {
    const assetId = (data?.assetId as string) || (data?.assetIds && (data.assetIds as string[])[0]);
    const assets = usePortfolioStore(state => state.portfolio.assets);
    const assetCategories = usePortfolioStore(state => state.portfolio.assetCategories);
    const draggedEntity = useUIStore(state => state.draggedEntity);
    const setDraggedEntity = useUIStore(state => state.setDraggedEntity);
    const linkContext = useJournalStore(state => state.linkContext);

    const asset = assets.find(a => a.id === assetId);
    const category = asset
        ? assetCategories.find(c => c.id === asset.type || (asset as any).categoryId === c.id)
        : undefined;

    const displayName = asset?.name || data?.label || 'Resource';
    const categoryLabel = category?.label || asset?.type || 'Resource';
    const rawColor = data?.color || category?.color || 'amber';
    const color = getPaletteColor(rawColor);
    const isWhite = rawColor === 'white' || rawColor === '#e4e4e7' || color.includes('palette-white');
    const badgeColor = isWhite ? 'var(--palette-white-text, var(--color-text-main))' : color;
    const IconComponent = getIconComponent(category?.icon || 'box');

    const { textRef, width, height } = useAutoResize(
        displayName,
        RESOURCE_NODE_SIZE.width,
        RESOURCE_NODE_SIZE.height,
    );

    const handleMouseUp = () => {
        if (draggedEntity?.type === 'journalEntry') {
            linkContext(draggedEntity.id, { id: id, type: 'node' });
            setDraggedEntity(null);
        }
    };

    const isMissingAsset = !asset && !!assetId;

    return (
        <div
            className="group relative"
            style={{
                width,
                height,
                transition: 'width 0.2s, height 0.2s',
                '--node-glow-color': getGlowColor(color),
                '--node-accent-color': color,
                '--node-bg-color': color
            } as any}
        >
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

            <NodeTooltip
                content={
                    isMissingAsset
                        ? 'Referenced resource was deleted from portfolio'
                        : `${categoryLabel}: ${displayName}`
                }
                delay={1500}
            >
                <div
                    onMouseUp={handleMouseUp}
                    className={clsx(
                        "shape-resource relative flex flex-col justify-between p-2.5 nemoto-transition-canvas backdrop-blur-sm pointer-events-auto",
                        "bg-app-surface hover:bg-app-hover border shadow-soft-down",
                        selected && "ring-[2px] ring-offset-[4px] ring-offset-app-bg z-20",
                        isMissingAsset && "border-dashed border-accent-danger/70 bg-accent-danger/5"
                    )}
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 'var(--app-radius-node, var(--app-radius-lg, 12px))',
                        borderWidth: 'var(--app-node-border-width, 1.5px)',
                        borderColor: isMissingAsset ? 'var(--color-accent-danger, #ef4444)' : color,
                        ...(selected ? { '--tw-ring-color': color } as any : {})
                    }}
                >
                    {/* Header: Category Badge */}
                    <div className="flex items-center justify-between w-full gap-2 shrink-0">
                        <div
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider select-none shrink-0 resource-category-badge"
                            style={{
                                backgroundColor: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
                                color: badgeColor,
                                border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`
                            }}
                        >
                            <IconComponent size={10} strokeWidth={2.5} />
                            <span className="truncate max-w-[120px]">{categoryLabel}</span>
                        </div>

                        {isMissingAsset && (
                            <AlertCircle size={12} className="text-accent-danger shrink-0" />
                        )}
                    </div>

                    {/* Body: Resource Name (Read-Only) */}
                    <div className="flex flex-col justify-center flex-1 my-0.5 min-h-0">
                        <div ref={textRef as any} className="hidden" />
                        <span
                            className={clsx(
                                "text-[12px] font-semibold leading-snug tracking-tight text-text-main line-clamp-2 select-none",
                                isMissingAsset && "text-accent-danger italic font-normal text-[11px]"
                            )}
                            title={displayName}
                        >
                            {isMissingAsset ? `Deleted Resource (${assetId})` : displayName}
                        </span>
                    </div>

                    {/* Footer: Properties or Resource Indicator */}
                    <div className="flex items-center justify-between text-[9px] text-text-faint select-none pt-1 border-t border-app-border/40 shrink-0">
                        <span className="flex items-center gap-1 opacity-70">
                            <Layers size={9} />
                            <span>Resource</span>
                        </span>
                        {asset?.metadata && Object.keys(asset.metadata).length > 0 && (
                            <span className="font-mono opacity-80">
                                {Object.keys(asset.metadata).length} {Object.keys(asset.metadata).length === 1 ? 'prop' : 'props'}
                            </span>
                        )}
                    </div>
                </div>
            </NodeTooltip>
        </div>
    );
});
