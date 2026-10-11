import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { resolveEntity } from '../../lib/entityResolver';
import * as Icons from 'lucide-react';

export default function ProcessHeader() {
    const activeProcessId = useProcessSessionStore(s => s.activeProcessId);
    const portfolio = usePortfolioStore(s => s.portfolio);
    const process = portfolio.processes.find(p => p.id === activeProcessId);

    // UI actions
    const openInspector = useUIStore(s => s.openInspector);
    const selectAsset = useUIStore(s => s.selectAsset);

    // Canvas actions
    const selectNodes = useCanvasStore(s => s.selectNodes);
    const selectEdges = useCanvasStore(s => s.selectEdges);

    if (!process) return null;

    const handleClick = (e: React.MouseEvent) => {
        // Prevent click from bubbling down to the ReactFlow pane (which would instantly close the inspector)
        e.stopPropagation();

        // Clear all specific selections
        selectNodes([]);
        selectEdges([]);
        selectAsset(null);

        // Open the inspector. Because nothing is selected, it will show the ProcessInspector!
        openInspector();
    };

    let owner = null;
    if (process.ownerId && process.metaSettings?.showOwnerInCanvas) {
        owner = resolveEntity(process.ownerId, 'asset', portfolio);
    }

    const IconComponent = owner && owner.icon ? (Icons as any)[owner.icon] : null;

    return (
        <div
            onClick={handleClick}
            className="flex-shrink-0 bg-app-surface/40 border-b border-app-border px-6 py-3 flex flex-col gap-1.5 cursor-pointer hover:bg-app-surface/60 transition-colors select-none group"
        >
            <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold font-display text-text-main tracking-tight leading-tight group-hover:text-accent-primary transition-colors">
                    {process.title || 'Untitled Process'}
                </h1>
            </div>

            {(owner || (process.description && process.metaSettings?.showDescriptionInCanvas)) && (
                <div className="flex items-center gap-3">
                    {owner && (
                        <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-app-surface shadow-sm border border-app-border text-[9px] font-bold uppercase tracking-[0.1em] text-text-muted axiom-transition-interactive group-hover:text-text-main group-hover:bg-app-hover group-hover:border-accent-primary/30">
                            {IconComponent && <IconComponent size={10} strokeWidth={2.5} className="text-accent-primary" />}
                            <span>{owner.displayName}</span>
                        </div>
                    )}

                    {process.description && process.metaSettings?.showDescriptionInCanvas && (
                        <p className="text-[11px] font-medium text-text-muted/65 leading-relaxed italic whitespace-pre-wrap max-w-2xl border-l border-accent-primary/20 pl-2.5">
                            {process.description}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
