import { CaseSensitive, ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AxiomButton, AxiomInput, AxiomPanelDivider, AxiomToolbarButton } from '../ui';

interface JournalFindReplaceBarProps {
    query: string;
    replacement: string;
    caseSensitive: boolean;
    currentMatch: number;
    matchCount: number;
    onQueryChange: (value: string) => void;
    onReplacementChange: (value: string) => void;
    onCaseSensitiveChange: (value: boolean) => void;
    onPrevious: () => void;
    onNext: () => void;
    onReplace: () => void;
    onReplaceAll: () => void;
    onClose: () => void;
}

export default function JournalFindReplaceBar({
    query,
    replacement,
    caseSensitive,
    currentMatch,
    matchCount,
    onQueryChange,
    onReplacementChange,
    onCaseSensitiveChange,
    onPrevious,
    onNext,
    onReplace,
    onReplaceAll,
    onClose,
}: JournalFindReplaceBarProps) {
    const queryInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        queryInputRef.current?.focus();
        queryInputRef.current?.select();
    }, []);

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        } else if (event.key === 'Enter' && event.target === queryInputRef.current) {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
        }
    };

    return (
        <div
            className="axiom-journal-findbar border-b border-app-border/40 bg-app-header px-4 py-2 flex flex-wrap items-center gap-2 shadow-sm"
            onKeyDown={handleKeyDown}
        >
            <div className="relative flex-1 min-w-[180px] max-w-sm">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
                <AxiomInput
                    ref={queryInputRef}
                    value={query}
                    onChange={event => onQueryChange(event.target.value)}
                    placeholder="Find in note"
                    aria-label="Find in note"
                    controlSize="sm"
                    className="axiom-journal-find-input w-full h-8 text-xs"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-faint tabular-nums">
                    {matchCount === 0 ? '0' : `${currentMatch + 1}/${matchCount}`}
                </span>
            </div>

            <AxiomToolbarButton surface="journal" label="Previous match" onClick={onPrevious} disabled={matchCount === 0} title="Previous match (Shift+Enter)">
                <ChevronUp size={14} />
            </AxiomToolbarButton>
            <AxiomToolbarButton surface="journal" label="Next match" onClick={onNext} disabled={matchCount === 0} title="Next match (Enter)">
                <ChevronDown size={14} />
            </AxiomToolbarButton>
            <AxiomToolbarButton
                surface="journal"
                label="Match case"
                active={caseSensitive}
                onClick={() => onCaseSensitiveChange(!caseSensitive)}
                title="Match case"
            >
                <CaseSensitive size={14} />
            </AxiomToolbarButton>

            <AxiomPanelDivider orientation="vertical" className="h-5 mx-1" />

            <div className="relative flex-1 min-w-[160px] max-w-sm">
                <Replace size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
                <AxiomInput
                    value={replacement}
                    onChange={event => onReplacementChange(event.target.value)}
                    placeholder="Replace with"
                    aria-label="Replace with"
                    controlSize="sm"
                    className="axiom-journal-replace-input w-full h-8 text-xs"
                />
            </div>
            <AxiomButton size="sm" onClick={onReplace} disabled={matchCount === 0} className="h-8 px-3 text-[10px]">Replace</AxiomButton>
            <AxiomButton size="sm" onClick={onReplaceAll} disabled={matchCount === 0} className="h-8 px-3 text-[10px]">Replace all</AxiomButton>
            <AxiomToolbarButton surface="journal" label="Close find and replace" onClick={onClose}>
                <X size={14} />
            </AxiomToolbarButton>
        </div>
    );
}
