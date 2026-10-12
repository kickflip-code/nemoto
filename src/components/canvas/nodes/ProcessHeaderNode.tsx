import React, { memo } from 'react';
import { usePortfolioStore } from '../../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../../stores/useProcessSessionStore';
import { useUIStore } from '../../../stores/useUIStore';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { resolveEntity } from '../../../lib/entityResolver';
import * as Icons from 'lucide-react';

export const ProcessHeaderNode = memo(() => {
    const activeProcessId = useProcessSessionStore(s => s.activeProcessId);
    const portfolio = usePortfolioStore(s => s.portfolio);
    const process = portfolio.processes.find(p => p.id === activeProcessId);

    // Fallback if process is still loading or not found
    if (!process) {
        return (
            <div className="p-4 opacity-50 bg-app-surface border border-red-500/20 rounded-xl">
                <p className="text-xs text-text-muted">Loading Header...</p>
            </div>
        );
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        const canvasStore = useCanvasStore.getState();
        canvasStore.selectElements([], []);
        useUIStore.getState().inspectCanvasSelection();
    };

    let owner = null;
    if (process.ownerId && process.metaSettings?.showOwnerInCanvas) {
        owner = resolveEntity(process.ownerId, 'asset', portfolio);
    }

    const IconComponent = owner && owner.icon ? (Icons as any)[owner.icon] : null;

    return (
        <div
            onClick={handleClick}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ pointerEvents: 'all' }}
            className="nopan nodrag nowheel group relative flex flex-col items-start px-0 py-2 nemoto-transition-canvas cursor-pointer select-none"
        >

            <div className="flex flex-col gap-2 relative z-10 w-full">
                {/* Primary Title - High clarity and open tracking */}
                <h1 className="text-3xl font-semibold font-display text-text-main tracking-tight leading-tight transition-colors nemoto-transition-fast pr-10">
                    {process.title || 'Untitled Process'}
                </h1>

                {/* Secondary metadata & description (Now below title) */}
                <div className="flex items-center gap-3">
                    {owner && (
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-app-surface shadow-sm border border-app-border text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted nemoto-transition-interactive group-hover:text-text-main group-hover:bg-app-hover group-hover:border-accent-primary/30">
                            {IconComponent && <IconComponent size={11} strokeWidth={2.5} className="text-accent-primary" />}
                            <span>{owner.displayName}</span>
                        </div>
                    )}

                    {process.description && process.metaSettings?.showDescriptionInCanvas && (
                       <p className="text-[12px] font-medium text-text-muted/60 leading-relaxed italic whitespace-pre-wrap max-w-md mt-1 border-l border-accent-primary/20 pl-3">
                           {process.description}
                       </p>
                    )}
                </div>
            </div>

        </div>
    );
});
