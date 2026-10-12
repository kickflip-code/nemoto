import { X } from 'lucide-react';
import { NemotoButton } from '../../components/ui';
import {
    EVENT_BEHAVIOR_LABELS,
    EVENT_KIND_LABELS,
    formatEventTiming,
    hasEventTiming,
    resolveEventBehavior,
    resolveEventKind,
} from '../../lib/events';

interface ViewerSidebarProps {
    selectedElement: any | null;
    assets: any[];
    categories: any[];
    journalEntries: any[];
    onReadNote?: (note: any) => void;
    onViewAsset?: (asset: any) => void;
    onClose?: () => void;
}

export const ViewerSidebar = ({ selectedElement, assets, categories, journalEntries, onReadNote, onViewAsset, onClose }: ViewerSidebarProps) => {

    if (!selectedElement) {
        return null;
    }

    // Find linked assets
    const linkedAssets = (assets || []).filter(a => selectedElement.assetIds?.includes(a.id));

    // Find linked journal entries
    const linkedNotes = (journalEntries || []).filter(entry =>
        entry.linkedContext?.some((ref: any) =>
            ref.id === selectedElement.id
        )
    );
    const dependencyRelations = selectedElement.dependencyRelations || [];

    return (
        <aside className="viewer-sidebar" aria-label="Selection details">
            <div className="sidebar-section">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="section-title">Details</h2>
                    {onClose && <NemotoButton aria-label="Close details" icon size="sm" variant="ghost" onClick={onClose}><X size={16} /></NemotoButton>}
                </div>
                <div className="info-card">
                    <div className="label">Name</div>
                    <div className="value">{selectedElement.label}</div>

                    <div className="label">Type</div>
                    <div style={{ marginBottom: '16px' }}>
                        <span className="node-type-badge">{selectedElement.type || 'node'}</span>
                    </div>

                    {selectedElement.eyebrow && (
                        <>
                            <div className="label">Role / Actor</div>
                            <div className="value" style={{ color: 'var(--color-accent-primary)' }}>{selectedElement.eyebrow}</div>
                        </>
                    )}

                    {selectedElement.description && (
                        <>
                            <div className="label">Description</div>
                            <div className="value text-muted">{selectedElement.description}</div>
                        </>
                    )}

                    {selectedElement.type === 'event' && (
                        <>
                            <div className="label">Event Kind</div>
                            <div className="value text-muted">{EVENT_KIND_LABELS[resolveEventKind(selectedElement.event)]}</div>

                            <div className="label">Behavior</div>
                            <div className="value text-muted">{EVENT_BEHAVIOR_LABELS[resolveEventBehavior(selectedElement.event)]}</div>

                            {hasEventTiming(selectedElement.event?.timing) && (
                                <>
                                    <div className="label">Timing</div>
                                    <div className="value text-muted">{formatEventTiming(selectedElement.event.timing)}</div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>

            {dependencyRelations.length > 0 && (
                <div className="sidebar-section">
                    <h2 className="section-title">Direct Relationships ({dependencyRelations.length})</h2>
                    <div className="flex flex-col gap-2">
                        {dependencyRelations.slice(0, 60).map((relationship: any) => (
                            <div key={relationship.id} className="rounded-md border border-app-border bg-app-surface p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-accent-primary">
                                            {relationship.label}
                                        </div>
                                        <div className="mt-1 truncate text-[13px] font-semibold text-text-main">
                                            {relationship.other.label}
                                        </div>
                                        <div className="mt-0.5 text-[10px] uppercase text-text-muted">
                                            {relationship.other.subtitle || relationship.other.type}
                                        </div>
                                    </div>
                                    {relationship.count > 1 && (
                                        <span className="shrink-0 rounded-full border border-app-border px-2 py-0.5 text-[10px] font-bold text-text-main">
                                            {relationship.count}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {dependencyRelations.length > 60 && (
                            <p className="text-[10px] text-text-muted">Showing the first 60 relationships.</p>
                        )}
                    </div>
                </div>
            )}

            {linkedAssets.length > 0 && (
                <div className="sidebar-section">
                    <h2 className="section-title">Linked Assets ({linkedAssets.length})</h2>
                    <div className="asset-list flex flex-col gap-2">
                        {linkedAssets.map(asset => {
                            const category = categories.find(c => c.id === asset.type);
                            return (
                                <div
                                    key={asset.id}
                                    className="flex items-center justify-between p-3 rounded-md bg-app-surface border border-app-border cursor-pointer hover:border-accent-primary hover:bg-app-hover transition-colors"
                                    onClick={() => onViewAsset && onViewAsset(asset)}
                                >
                                    <span className="text-[13px] font-semibold text-text-main truncate pr-2">{asset.name}</span>
                                    {category && (
                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded border opacity-80 whitespace-nowrap"
                                              style={{ borderColor: category.color, color: category.color }}>
                                            {category.label}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {linkedNotes.length > 0 && (
                <div className="sidebar-section">
                    <h2 className="section-title">Related Notes ({linkedNotes.length})</h2>
                    <div className="journal-list flex flex-col gap-2">
                        {linkedNotes.map(note => {
                            return (
                                <div
                                    key={note.id}
                                    className="flex items-center justify-between p-3 rounded-md bg-app-surface border border-app-border cursor-pointer hover:border-accent-primary hover:bg-app-hover transition-colors"
                                    onClick={() => onReadNote && onReadNote(note)}
                                >
                                    <div className="flex flex-col">
                                        <span className="text-[13px] font-semibold text-text-main truncate">{note.title}</span>
                                        <span className="text-[10px] text-text-muted mt-0.5">{new Date(note.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <div className="text-text-faint hover:text-white transition-colors">
                                        +
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </aside>
    );
};
