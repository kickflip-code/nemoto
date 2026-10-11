import { Check, ExternalLink, Unlink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AxiomInput, AxiomPopover, AxiomToolbarButton } from '../ui';

interface JournalLinkPopoverProps {
    x: number;
    y: number;
    href: string;
    onApply: (href: string) => void;
    onOpen: (href: string) => void;
    onRemove: () => void;
    onClose: () => void;
}

export default function JournalLinkPopover({
    x,
    y,
    href,
    onApply,
    onOpen,
    onRemove,
    onClose,
}: JournalLinkPopoverProps) {
    const [value, setValue] = useState(href);

    useEffect(() => setValue(href), [href]);
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const left = Math.max(12, Math.min(x, window.innerWidth - 372));
    const top = Math.max(12, Math.min(y + 10, window.innerHeight - 90));

    return createPortal(
        <AxiomPopover
            aria-label="Edit link"
            className="fixed z-[130] w-[360px] max-w-[calc(100vw-24px)] p-2 flex items-center gap-1.5"
            style={{ left, top }}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
        >
            <AxiomInput
                autoFocus
                value={value}
                onChange={event => setValue(event.target.value)}
                onKeyDown={event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        onApply(value);
                    }
                }}
                aria-label="Link URL"
                controlSize="sm"
                className="h-8 min-w-0 flex-1 px-2.5 text-xs"
            />
            <AxiomToolbarButton surface="journal" label="Apply link" onClick={() => onApply(value)} className="text-accent-primary">
                <Check size={14} />
            </AxiomToolbarButton>
            <AxiomToolbarButton surface="journal" label="Open link" onClick={() => onOpen(value)}>
                <ExternalLink size={14} />
            </AxiomToolbarButton>
            <AxiomToolbarButton surface="journal" danger label="Remove link" onClick={onRemove}>
                <Unlink size={14} />
            </AxiomToolbarButton>
            <AxiomToolbarButton surface="journal" label="Close" onClick={onClose}>
                <X size={14} />
            </AxiomToolbarButton>
        </AxiomPopover>,
        document.body,
    );
}
