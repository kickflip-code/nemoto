import { useMemo, useState } from 'react';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useJournalStore } from '../../stores/useJournalStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasStore } from '../../stores/useCanvasStore';

import { X, Book, Plus, ExternalLink, Link2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import JournalEntryPicker from '../shared/JournalEntryPicker';
import { resolveEntity, inferEntityType } from '../../lib/entityResolver';
import type { EntityReference } from '../../types/journal';
import ConfirmationModal from '../shared/ConfirmationModal';
import {
    AxiomButton,
    AxiomPanel,
    AxiomPanelBody,
    AxiomPanelHeader,
    AxiomPanelIconButton,
    AxiomPanelRowButton,
} from '../ui';

export default function JournalContextPanel() {
    const {
        selectedAssetId, rightPanelMode, setRightPanelMode, expandJournalPanel
    } = useUIStore();
    const { selectedNodeIds } = useCanvasStore();
    const { portfolio } = usePortfolioStore();


    // Need to use journal store hooks
    const journalStore = useJournalStore();

    const { draggedAsset, setDraggedAsset } = useUIStore();
    const { linkContext } = useJournalStore();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    // Determine context ID
    const contextId = useMemo(() => {
        if (selectedAssetId) return selectedAssetId;
        if (selectedNodeIds.length === 1) return selectedNodeIds[0];
        return null; // Swimlanes or multiple selection not supported yet
    }, [selectedAssetId, selectedNodeIds]);

    // Find linked entries
    const linkedEntries = useMemo(() => {
        if (!contextId || !portfolio.journal?.entries) return [];
        return portfolio.journal.entries.filter(e =>
            (e.linkedContext || []).some(ref => ref.id === contextId)
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }, [contextId, portfolio.journal?.entries]);

    const handleDrop = (entryId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (draggedAsset) {
            const entityRef: EntityReference = {
                id: draggedAsset.id,
                type: 'asset'
            };
            linkContext(entryId, entityRef);
            setDraggedAsset(null);
        }
    };

    const handleCreateLinkedEntry = () => {
        if (!contextId) return;
        // Create entry in Default Notebook (or first available)
        const notebookId = portfolio.journal?.notebooks[0]?.id;
        if (!notebookId) {
            setAlertMessage("No notebooks available. Please create one in Journal View first.");
            return;
        }

        const newId = journalStore.createEntry(notebookId, `Note for ${contextId}`);
        const entityType = inferEntityType(contextId, portfolio);
        const entityRef: EntityReference = { id: contextId, type: entityType };
        journalStore.linkContext(newId, entityRef);
    };

    const handleOpenEntry = (entryId: string) => {
        journalStore.selectEntry(entryId);
        // Expand journal panel to show the selected note
        expandJournalPanel();
    };

    const handleClose = () => {
        setRightPanelMode('inspector');
        // If nothing selected, maybe close inspector too?
        // toggleInspector(); 
    };

    if (rightPanelMode !== 'journal') return null;

    return (
        <AxiomPanel as="aside" className="axiom-journal-context-panel w-[300px] border-l flex flex-col shrink-0 z-20 shadow-xl relative">
            {/* Header */}
            <AxiomPanelHeader className="h-10 px-4 flex items-center justify-between border-b bg-accent-primary/5">
                <div className="flex items-center gap-2">
                    <Book size={14} className="text-accent-primary" />
                    <span className="text-[10px] uppercase font-black tracking-[0.2em] text-text-main">Context</span>
                </div>
                <AxiomPanelIconButton
                    aria-label="Close journal context"
                    onClick={handleClose}
                >
                    <X size={16} />
                </AxiomPanelIconButton>
            </AxiomPanelHeader>

            <AxiomPanelBody className="flex-1 overflow-y-auto p-4">
                {!contextId ? (
                    <div className="text-center mt-10 space-y-2">
                        <p className="text-sm text-text-muted">No selection</p>
                        <p className="text-xs text-text-faint">Select a node or asset to see linked notes</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-text-faint tracking-wider">
                                Linked to {(() => {
                                    const portfolioWithAssets = portfolio;
                                    const entityType = inferEntityType(contextId, portfolioWithAssets);
                                    const resolved = resolveEntity(contextId, entityType, portfolioWithAssets);
                                    return resolved ? <span className="font-mono text-accent-primary">{resolved.displayName}</span> : <span className="font-mono text-text-muted">{contextId}</span>;
                                })()}
                            </span>
                            <div className="flex items-center gap-2">
                                <AxiomButton
                                    size="sm"
                                    onClick={() => setPickerOpen(true)}
                                    className="text-[10px] px-2 py-1 bg-app-surface hover:bg-app-hover text-text-muted hover:text-text-main rounded transition-colors flex items-center gap-1 border border-app-border"
                                >
                                    <Link2 size={10} /> Link Note
                                </AxiomButton>
                                <AxiomButton
                                    size="sm"
                                    variant="primary"
                                    onClick={handleCreateLinkedEntry}
                                    className="text-[10px] px-2 py-1 flex items-center gap-1.5 font-bold uppercase tracking-wider"
                                >
                                    <Plus size={10} /> Add Note
                                </AxiomButton>
                            </div>
                        </div>

                        {linkedEntries.length === 0 ? (
                            <div className="text-[10px] text-text-faint italic p-4 border border-dashed border-app-border rounded text-center">
                                No linked notes found.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {linkedEntries.map(entry => (
                                    <AxiomPanelRowButton
                                        key={entry.id}
                                        aria-label={`Open note ${entry.title || 'Untitled Note'}`}
                                        className="bg-app-bg border border-app-border rounded-sm p-3.5 hover:border-accent-primary/40 axiom-transition-interactive group cursor-pointer relative overflow-hidden"
                                        onClick={() => handleOpenEntry(entry.id)}
                                        onMouseUp={(e) => handleDrop(entry.id, e)}
                                    >
                                        <div className="absolute top-0 left-0 w-1 h-full bg-accent-primary/20 group-hover:bg-accent-primary transition-colors" />
                                        <div className="flex items-start justify-between mb-2">
                                            <span className="text-xs font-bold text-text-main group-hover:text-accent-primary transition-colors leading-tight">
                                                {entry.title || 'Untitled Note'}
                                            </span>
                                            <ExternalLink size={10} className="text-text-faint opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                                        </div>
                                        <div className="text-[11px] text-text-faint line-clamp-2 mb-3 leading-relaxed">
                                            {entry.content?.replace(/<[^>]*>/g, '') || 'No content...'}
                                        </div>
                                        <div className="text-[9px] text-text-faint font-mono flex justify-end">
                                            {new Date(entry.updatedAt).toLocaleDateString()}
                                        </div>
                                    </AxiomPanelRowButton>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </AxiomPanelBody>
            {pickerOpen && contextId && createPortal(
                <JournalEntryPicker
                    onClose={() => setPickerOpen(false)}
                    onSelect={(entryId) => {
                        const entityType = inferEntityType(contextId, portfolio);
                        const entityRef: EntityReference = { id: contextId, type: entityType };
                        linkContext(entryId, entityRef);
                        setPickerOpen(false);
                    }}
                />,
                document.body
            )}

            <ConfirmationModal
                isOpen={!!alertMessage}
                onClose={() => setAlertMessage(null)}
                onConfirm={() => setAlertMessage(null)}
                title="Notice"
                message={alertMessage || ''}
                variant="primary"
                hideCancel={true}
                confirmLabel="Understood"
            />
        </AxiomPanel>
    );
}
