import type { ReactNode } from 'react';
import { NemotoToolbarButton } from '../ui';

interface JournalToolbarButtonProps {
    active?: boolean;
    children: ReactNode;
    onClick?: () => void;
    title: string;
    disabled?: boolean;
}

export function JournalToolbarButton({ active, children, onClick, title, disabled = false }: JournalToolbarButtonProps) {
    return (
        <NemotoToolbarButton
            active={active}
            surface="journal"
            label={title}
            onClick={onClick}
            disabled={disabled}
        >
            {children}
        </NemotoToolbarButton>
    );
}
