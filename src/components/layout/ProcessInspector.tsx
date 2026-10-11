import { useState } from 'react';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { resolveEntity } from '../../lib/entityResolver';
import OwnerPickerModal from '../shared/OwnerPickerModal';
import { AxiomInput, AxiomPanelDivider, AxiomSwitch, AxiomTextarea } from '../ui';

export default function ProcessInspector() {
    const { portfolio, updateProcess } = usePortfolioStore();
    const activeProcessId = useProcessSessionStore(s => s.activeProcessId);
    const process = portfolio.processes.find(p => p.id === activeProcessId);

    const [isOwnerPickerOpen, setIsOwnerPickerOpen] = useState(false);

    if (!process || !activeProcessId) {
        return <div className="text-text-muted text-xs p-4">Process not found</div>;
    }

    const handleUpdate = (updates: Partial<typeof process>) => {
        updateProcess(activeProcessId, updates);
    };

    return (
        <div className="space-y-6">
            {/* Identity Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Process Identity</label>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Title</span>
                        <AxiomInput
                            type="text"
                            controlSize="sm"
                            className="w-full font-medium"
                            value={process.title}
                            aria-label="Title"
                            onChange={(e) => handleUpdate({ title: e.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Description</span>
                        <AxiomTextarea
                            controlSize="sm"
                            className="w-full"
                            value={process.description || ''}
                            aria-label="Description"
                            placeholder="Add details about the process overall..."
                            onChange={(e) => handleUpdate({ description: e.target.value })}
                        />
                    </div>
                </div>
            </div>

            <AxiomPanelDivider />

            {/* Ownership Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Ownership</label>
                <div className="space-y-3">
                    <div className="space-y-1 relative">
                        <span className="text-[10px] text-text-faint pb-2">Process Owner</span>
                        <button
                            onClick={() => setIsOwnerPickerOpen(true)}
                            className="axiom-panel-card w-full flex items-center justify-between px-2 py-1.5 text-xs text-left hover:bg-app-hover transition-colors"
                        >
                            <span className="truncate">
                                {process.ownerId
                                    ? (resolveEntity(process.ownerId, 'asset', portfolio)?.displayName || 'Unknown Owner')
                                    : <span className="text-text-muted italic">Click to select owner...</span>
                                }
                            </span>
                            <span className="text-[10px] text-accent-primary bg-accent-primary/10 px-1.5 rounded uppercase font-bold tracking-wide">
                                Change
                            </span>
                        </button>
                    </div>

                    {isOwnerPickerOpen && (
                        <OwnerPickerModal
                            currentOwnerId={process.ownerId}
                            onSelect={(id: string | null) => handleUpdate({ ownerId: id })}
                            onClose={() => setIsOwnerPickerOpen(false)}
                        />
                    )}

                    <div className="flex items-center justify-between mt-4">
                        <span className="text-[10px] text-text-faint">Show Owner in Canvas</span>
                        <AxiomSwitch
                            checked={process.metaSettings?.showOwnerInCanvas ?? false}
                            label="Show owner in canvas"
                            onCheckedChange={(checked) => handleUpdate({
                                metaSettings: {
                                    ...process.metaSettings,
                                    showOwnerInCanvas: checked,
                                }
                            })}
                        />
                    </div>

                    <div className="flex items-center justify-between mt-3">
                        <span className="text-[10px] text-text-faint">Show Description in Canvas</span>
                        <AxiomSwitch
                            checked={process.metaSettings?.showDescriptionInCanvas ?? false}
                            label="Show description in canvas"
                            onCheckedChange={(checked) => handleUpdate({
                                metaSettings: {
                                    ...process.metaSettings,
                                    showDescriptionInCanvas: checked,
                                }
                            })}
                        />
                    </div>

                    <span className="text-[9px] text-text-faint opacity-60 block leading-tight mt-2 italic">
                        Control visibility of ownership and process details inside the canvas origin header.
                    </span>
                </div>
            </div>

            <AxiomPanelDivider />

            {/* Meta */}
            <div className="space-y-2">
                <div className="flex justify-between text-[10px]">
                    <span className="text-text-faint">Process ID</span>
                    <span className="font-mono text-text-muted">{process.id}</span>
                </div>
                {process.folderId && (
                    <div className="flex justify-between text-[10px]">
                        <span className="text-text-faint">Folder ID</span>
                        <span className="font-mono text-text-muted">{process.folderId}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
