import { Globe2, LockKeyhole } from 'lucide-react';
import { AxiomButton } from '../ui';

interface JournalSharingControlProps {
    internal: boolean;
    onChange: (internal: boolean) => void;
}

export default function JournalSharingControl({ internal, onChange }: JournalSharingControlProps) {
    const label = internal ? 'Internal' : 'Shareable';
    const description = internal
        ? 'Excluded from shared HTML and .nemoto-process exports. Included in full .nemoto backups.'
        : 'Included in shared HTML and .nemoto-process exports when linked to the exported process.';
    const Icon = internal ? LockKeyhole : Globe2;

    return (
        <AxiomButton
            size="sm"
            variant="ghost"
            aria-label={`Sharing: ${label}`}
            aria-pressed={internal}
            title={`${label}. ${description}`}
            onClick={() => onChange(!internal)}
            className={`axiom-journal-sharing-control gap-1.5 ${
                internal ? 'text-accent-warning' : 'text-text-faint'
            }`}
        >
            <Icon size={12} aria-hidden="true" />
            <span>{label}</span>
        </AxiomButton>
    );
}
