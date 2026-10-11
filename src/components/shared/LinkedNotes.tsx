import { Book, Trash2, ExternalLink, Plus } from 'lucide-react';
import { useJournalStore } from '../../stores/useJournalStore';
import { useUIStore } from '../../stores/useUIStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { JournalEntry, EntityReference } from '../../types/journal';

interface LinkedNotesProps {
    entityId: string;
    entityType: 'node' | 'asset';
    name: string;
}

export default function LinkedNotes({ entityId, entityType, name }: LinkedNotesProps) {
    const { portfolio } = usePortfolioStore();
    const { linkContext, unlinkContext, selectEntry } = useJournalStore();
    const { draggedEntity, setDraggedEntity, openOmnibox, setLinkingTarget } = useUIStore();

    // Find all entries linked to this entity
    const linkedEntries = (portfolio.journal?.entries || []).filter((entry: JournalEntry) =>
        entry.linkedContext?.some((ctx: EntityReference) => ctx.id === entityId && ctx.type === entityType)
    );

    const handleLinkClick = () => {
        setLinkingTarget({ id: entityId, type: entityType, name });
        openOmnibox();
    };

    const handleDrop = () => {
        if (draggedEntity?.type === 'journalEntry') {
            linkContext(draggedEntity.id, { id: entityId, type: entityType });
            setDraggedEntity(null);
        }
    };

    const handleOpenNote = (entryId: string) => {
        selectEntry(entryId);
        // Ensure panel is open
        useUIStore.getState().expandJournalPanel();
    };

    return (
        <div
            onMouseUp={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="space-y-3"
        >
            <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider">Linked Notes</label>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-faint">{linkedEntries.length}</span>
                    <button
                        onClick={handleLinkClick}
                        className="p-0.5 hover:bg-app-hover rounded text-text-faint hover:text-accent-primary transition-colors"
                        title="Search and Link Note"
                    >
                        <Plus size={12} />
                    </button>
                </div>
            </div>

            <div className="space-y-2">
                {linkedEntries.length > 0 ? (
                    linkedEntries.map((entry: JournalEntry) => (
                        <div
                            key={entry.id}
                            className="bg-app-bg border border-app-border rounded p-2.5 flex items-start gap-3 group hover:border-accent-primary/50 transition-colors"
                        >
                            <div className="mt-0.5 w-7 h-7 rounded bg-accent-primary/5 flex items-center justify-center border border-accent-primary/10">
                                <Book size={14} className="text-accent-primary/70" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-text-main truncate">{entry.title || 'Untitled Note'}</div>
                                <div className="text-[10px] text-text-muted mt-0.5">{new Date(entry.updatedAt).toLocaleDateString()}</div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => handleOpenNote(entry.id)}
                                    className="p-1 text-text-faint hover:text-accent-primary transition-colors"
                                    title="Open Note"
                                >
                                    <ExternalLink size={12} />
                                </button>
                                <button
                                    onClick={() => unlinkContext(entry.id, entityId)}
                                    className="p-1 text-text-faint hover:text-accent-danger transition-colors"
                                    title="Unlink Note"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-[10px] text-text-faint italic p-4 border border-dashed border-app-border rounded text-center bg-app-surface">
                        No notes linked. Drag a note here or use the search to link.
                    </div>
                )}
            </div>
        </div>
    );
}
