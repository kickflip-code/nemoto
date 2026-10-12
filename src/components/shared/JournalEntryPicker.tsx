import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { Search, X, Book, Check } from 'lucide-react';

interface JournalEntryPickerProps {
    onClose: () => void;
    onSelect: (entryId: string) => void;
}

export default function JournalEntryPicker({ onClose, onSelect }: JournalEntryPickerProps) {
    const { portfolio } = usePortfolioStore();
    const [search, setSearch] = useState('');

    const allEntries = portfolio.journal?.entries || [];

    const filteredEntries = useMemo(() => {
        if (!search.trim()) return allEntries;
        const lower = search.toLowerCase();

        return allEntries
            .map(entry => {
                const titleLower = (entry.title || '').toLowerCase();
                const contentLower = (entry.content || '').toLowerCase();

                let score = -1;
                if (titleLower.startsWith(lower)) score = 100;
                else if (titleLower.includes(lower)) score = 50;
                else if (contentLower.includes(lower)) score = 10;

                return { entry, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.entry);
    }, [allEntries, search]);

    return createPortal(
        <div className="fixed inset-0 z-[10100] flex items-center justify-center nemoto-motion-overlay">
            <div className="nemoto-dialog-backdrop absolute inset-0" onClick={onClose} />
            <div className="nemoto-dialog-panel relative w-[500px] flex flex-col max-h-[600px] overflow-hidden nemoto-motion-dialog">

                {/* Header */}
                <div className="nemoto-dialog-header h-12 border-b flex items-center justify-between px-4">
                    <span className="font-bold text-sm text-text-main">Link Existing Note</span>
                    <button onClick={onClose} className="nemoto-icon-button nemoto-icon-button-sm nemoto-icon-button-ghost">
                        <X size={16} />
                    </button>
                </div>

                {/* Search */}
                <div className="nemoto-dialog-header p-4 border-b">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                            autoFocus
                            type="text"
                            placeholder="Search notes..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="nemoto-field nemoto-field-sm w-full pl-9 pr-3 text-sm"
                        />
                    </div>
                </div>

                {/* List */}
                <div className="nemoto-dialog-body flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {filteredEntries.map(entry => (
                        <div
                            key={entry.id}
                            onClick={() => {
                                onSelect(entry.id);
                                onClose();
                            }}
                            className="nemoto-dialog-row flex items-center gap-3 p-3 cursor-pointer group"
                        >
                            <div className="nemoto-dialog-row-icon w-8 h-8 flex items-center justify-center">
                                <Book size={16} />
                            </div>
                            <div className="flex-1">
                                <div className="text-sm font-medium text-text-main group-hover:text-text-main">{entry.title || 'Untitled Note'}</div>
                                <div className="text-[10px] text-text-muted line-clamp-1">{entry.content || 'No content...'}</div>
                            </div>
                            <Check size={14} className="opacity-0 group-hover:opacity-100 text-accent-primary transition-opacity" />
                        </div>
                    ))}

                    {filteredEntries.length === 0 && (
                        <div className="text-center py-12 text-text-faint italic">
                            No matching notes found.
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
