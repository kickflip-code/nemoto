import { X } from 'lucide-react';
import { usePortfolioStore } from '../../stores/usePortfolioStore';

import { resolveEntityReference } from '../../lib/entityResolver';
import type { EntityReference } from '../../types/journal';
import { getIconComponent } from '../../lib/iconMap';
import { Server } from 'lucide-react';
import { PALETTE } from '../../constants/palette';

interface LinkedEntitiesSectionProps {
    linkedContext: EntityReference[];
    onUnlink?: (entityId: string) => void;
}

export default function LinkedEntitiesSection({ linkedContext, onUnlink }: LinkedEntitiesSectionProps) {
    const { portfolio } = usePortfolioStore();


    if (linkedContext.length === 0) {
        return (
            <div className="nemoto-linked-empty text-[10px] text-text-faint italic p-2 border border-dashed border-app-border rounded text-center">
                No linked entities. Link assets, nodes, or processes to this note.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {linkedContext.map((entityRef, index) => {
                const portfolioWithAssets = portfolio;
                const resolved = resolveEntityReference(entityRef, portfolioWithAssets);

                // Fallback if resolution fails
                if (!resolved) {
                    return (
                        <div
                            key={`${entityRef.id}-${index}`}
                            className="nemoto-linked-entity-card bg-app-bg border border-accent-danger/30 rounded p-2 flex items-start gap-2.5"
                        >
                            <div className="nemoto-linked-entity-icon mt-0.5 w-6 h-6 rounded bg-accent-danger/10 flex items-center justify-center border border-accent-danger/20">
                                <Server size={14} className="text-accent-danger" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-accent-danger">Missing {entityRef.type}</div>
                                <div className="text-[10px] text-text-muted mt-0.5 font-mono">
                                    {entityRef.id ? `ID: ${entityRef.id}` : 'MISSING ID'}
                                </div>
                            </div>
                            {onUnlink && entityRef.source !== 'inline' && (
                                <button
                                    onClick={() => onUnlink(entityRef.id)}
                                    className="text-text-faint hover:text-accent-danger"
                                    title="Remove dangling reference"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    );
                }

                // Get icon component
                const IconComponent = getIconComponent(resolved.icon);

                // Get color from palette
                const colorData = PALETTE.find(p => p.id === resolved.color);
                const colorHex = colorData?.hex || '#a855f7'; // Fallback to purple

                return (
                    <div
                        key={`${entityRef.id}-${index}`}
                        className="nemoto-linked-entity-card bg-app-bg border border-app-border rounded p-2 flex items-start gap-2.5 group hover:border-accent-primary/50 transition-colors"
                    >
                        {/* ... content ... */}
                        <div
                            className="nemoto-linked-entity-icon mt-0.5 w-6 h-6 rounded flex items-center justify-center border"
                            style={{
                                backgroundColor: `${colorHex}15`,
                                borderColor: `${colorHex}30`
                            }}
                        >
                            <IconComponent size={14} style={{ color: colorHex }} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="nemoto-linked-entity-title text-xs font-medium text-text-main">{resolved.displayName}</div>
                            {resolved.subtitle && (
                                <div className="text-[10px] text-text-muted mt-0.5">{resolved.subtitle}</div>
                            )}
                            <div className="text-[9px] text-text-faint mt-0.5 capitalize">
                                {entityRef.source === 'inline' ? 'Inline mention' : entityRef.type}
                            </div>
                        </div>
                        {onUnlink && entityRef.source !== 'inline' && (
                            <button
                                onClick={() => onUnlink(entityRef.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-text-faint hover:text-accent-danger"
                                title="Unlink entity"
                            >
                                <X size={12} />
                            </button>
                        )}
                        {entityRef.source === 'inline' && (
                            <span className="text-[9px] text-text-faint" title="Remove the mention from the note to unlink it">
                                @
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
