import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useJournalStore } from '../../stores/useJournalStore';
import { X, Plus, Hash, Check, Trash2 } from 'lucide-react';
import { PALETTE, getPaletteColor } from '../../constants/palette';
import ConfirmationModal from '../shared/ConfirmationModal';
import {
    AxiomButton,
    AxiomColorSwatch,
    AxiomInput,
    AxiomMenuItem,
    AxiomPanelIconButton,
    AxiomPopover,
} from '../ui';

interface TagSelectorProps {
    selectedTagIds: string[];
    onChange: (ids: string[]) => void;
}

const getTagTextColor = (colorId: string) => {
    const paletteColor = PALETTE.find(color => color.id === colorId);
    return paletteColor?.twText === 'text-[#18181b]' ? 'var(--color-text-main)' : '#ffffff';
};

export default function TagSelector({ selectedTagIds = [], onChange }: TagSelectorProps) {
    const { portfolio } = usePortfolioStore();
    const { createTag, deleteTag, purgeTag } = useJournalStore();
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [newTagLabel, setNewTagLabel] = useState('');
    const [newTagColor, setNewTagColor] = useState('blue');
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);

    const availableTags = portfolio.journal?.tags || [];

    // Close on click outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                containerRef.current
                && !containerRef.current.contains(target)
                && !popoverRef.current?.contains(target)
            ) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                triggerRef.current?.focus();
            }
        };
        if (isOpen) {
            window.addEventListener('mousedown', handleClick);
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            window.removeEventListener('mousedown', handleClick);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const activeTags = availableTags.filter(t => selectedTagIds.includes(t.id));

    const toggleTag = (id: string) => {
        if (selectedTagIds.includes(id)) {
            onChange(selectedTagIds.filter(tid => tid !== id));
        } else {
            onChange([...selectedTagIds, id]);
        }
    };

    const handleCreateTag = () => {
        if (!newTagLabel.trim()) return;
        createTag(newTagLabel.trim(), newTagColor);
        setNewTagLabel('');
        setSearch(''); // Clear search? Optional.
    };

    const filteredTags = availableTags.filter(t =>
        !t.archived && t.label.toLowerCase().includes(search.toLowerCase())
    );

    const updatePopoverPosition = useCallback(() => {
        const trigger = triggerRef.current;
        const popover = popoverRef.current;
        if (!trigger || !popover) return;

        const gap = 8;
        const viewportPadding = 12;
        const triggerRect = trigger.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const width = popoverRect.width || 220;
        const height = popoverRect.height;
        const roomBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
        const roomAbove = triggerRect.top - viewportPadding;
        const openAbove = height > roomBelow && roomAbove > roomBelow;
        const preferredTop = openAbove
            ? triggerRect.top - height - gap
            : triggerRect.bottom + gap;

        setPopoverPosition({
            left: Math.max(
                viewportPadding,
                Math.min(triggerRect.left, window.innerWidth - width - viewportPadding),
            ),
            top: Math.max(
                viewportPadding,
                Math.min(preferredTop, window.innerHeight - height - viewportPadding),
            ),
        });
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) {
            setPopoverPosition(null);
            return;
        }
        updatePopoverPosition();
    }, [filteredTags.length, isOpen, search, updatePopoverPosition]);

    useEffect(() => {
        if (!isOpen) return;

        const handleViewportChange = () => updatePopoverPosition();
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(handleViewportChange);
        if (popoverRef.current) resizeObserver?.observe(popoverRef.current);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
            resizeObserver?.disconnect();
        };
    }, [isOpen, updatePopoverPosition]);

    return (
        <div className="relative" ref={containerRef}>
            <div className="axiom-journal-tags flex flex-wrap gap-1.5 items-center">
                {activeTags.map(tag => (
                    <div
                        key={tag.id}
                        className="axiom-journal-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={{
                            backgroundColor: getPaletteColor(tag.color),
                            color: getTagTextColor(tag.color)
                        }}
                    >
                        <span>{tag.label}</span>
                        <button
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className="axiom-tag-close hover:opacity-70 transition-opacity"
                            aria-label={`Remove ${tag.label}`}
                        >
                            <X size={10} />
                        </button>
                    </div>
                ))}

                <AxiomButton
                    ref={triggerRef}
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsOpen(!isOpen)}
                    aria-expanded={isOpen}
                    aria-haspopup="dialog"
                    aria-controls="journal-tag-selector"
                    className="axiom-journal-add-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-main hover:bg-app-hover transition-colors border border-dashed border-app-border"
                >
                    <Plus size={10} /> Tag
                </AxiomButton>
            </div>

            {/* Dropdown */}
            {isOpen && createPortal(
                <AxiomPopover
                    ref={popoverRef}
                    id="journal-tag-selector"
                    aria-label="Choose journal tags"
                    className="fixed z-[130] w-[220px] flex flex-col p-2 gap-2 axiom-motion-popover"
                    style={{
                        left: popoverPosition?.left ?? 0,
                        top: popoverPosition?.top ?? 0,
                        visibility: popoverPosition ? 'visible' : 'hidden',
                    }}
                >

                    {/* Search */}
                    <div className="relative">
                        <Hash size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                        <AxiomInput
                            autoFocus
                            type="text"
                            placeholder="Search or create..."
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setNewTagLabel(e.target.value);
                            }}
                            controlSize="sm"
                            aria-label="Search or create tag"
                            className="axiom-field-leading-icon w-full text-xs"
                        />
                    </div>

                    {/* Existing Tags */}
                    <div className="max-h-[150px] overflow-y-auto space-y-1 custom-scrollbar">
                        {filteredTags.map(tag => (
                            <div
                                key={tag.id}
                                className="flex items-center gap-1 group/tag"
                            >
                                <AxiomMenuItem
                                    compact
                                    role="checkbox"
                                    aria-checked={selectedTagIds.includes(tag.id)}
                                    onClick={() => toggleTag(tag.id)}
                                    className="min-w-0 flex-1"
                                >
                                    <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: getPaletteColor(tag.color) }}
                                    />
                                    <span className="truncate">{tag.label}</span>
                                    {selectedTagIds.includes(tag.id) && <Check size={12} className="text-accent-primary" />}
                                </AxiomMenuItem>
                                <AxiomPanelIconButton
                                    aria-label={`Remove ${tag.label} from list`}
                                    danger
                                    size="sm"
                                    onClick={() => setConfirmDialog({
                                        isOpen: true,
                                        title: 'Remove Tag',
                                        message: `Remove "${tag.label}" from the quick-selection list? It will remain on existing notes.`,
                                        onConfirm: () => deleteTag(tag.id)
                                    })}
                                    className="opacity-0 group-hover/tag:opacity-100 focus:opacity-100"
                                >
                                    <Trash2 size={12} />
                                </AxiomPanelIconButton>
                            </div>
                        ))}

                        {filteredTags.length === 0 && search && (
                            <div className="p-2 border border-dashed border-app-border rounded bg-app-bg/50">
                                <div className="text-[10px] text-text-muted mb-2">Create new tag "{search}"</div>

                                {/* Color Picker */}
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                    {PALETTE.map(c => (
                                        <AxiomColorSwatch
                                            key={c.id}
                                            aria-label={c.label}
                                            selected={newTagColor === c.id}
                                            onClick={() => setNewTagColor(c.id)}
                                            className="w-4 h-4 rounded-full"
                                            style={{ backgroundColor: c.hex }}
                                            title={c.label}
                                        />
                                    ))}
                                </div>

                                <AxiomButton
                                    size="sm"
                                    variant="primary"
                                    onClick={handleCreateTag}
                                    className="w-full text-[10px]"
                                >
                                    Create Tag
                                </AxiomButton>
                            </div>
                        )}
                    </div>

                    {/* Purge Option */}
                    {availableTags.some(t => t.archived) && (
                        <div className="mt-2 pt-2 border-t border-app-border">
                            <AxiomMenuItem
                                compact
                                danger
                                onClick={() => {
                                    const archived = availableTags.filter(t => t.archived);
                                    setConfirmDialog({
                                        isOpen: true,
                                        title: 'Purge Archived Tags',
                                        message: `Completely remove ${archived.length} archived tags and unlink them from all notes? This cannot be undone.`,
                                        onConfirm: () => archived.forEach(t => purgeTag(t.id))
                                    });
                                }}
                            >
                                <Trash2 size={10} />
                                Purge {availableTags.filter(t => t.archived).length} archived tags
                            </AxiomMenuItem>
                        </div>
                    )}
                </AxiomPopover>,
                document.body,
            )}

            {confirmDialog && (
                <ConfirmationModal
                    isOpen={confirmDialog.isOpen}
                    onClose={() => setConfirmDialog(null)}
                    onConfirm={confirmDialog.onConfirm}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    variant="danger"
                />
            )}
        </div>
    );
}
