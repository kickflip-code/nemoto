import { Search } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePortfolioStore } from '../../stores/usePortfolioStore';

import type { EntityReference } from '../../types/journal';
import { listEntityCandidates } from '../../lib/entityResolver';
import { AxiomButton, AxiomDialog, AxiomInput } from '../ui';

interface EntityPickerModalProps {
    onClose: () => void;
    onSelect: (entityRef: EntityReference) => void;
    allowedTypes?: Array<EntityReference['type']>;
}

export default function EntityPickerModal({ onClose, onSelect, allowedTypes }: EntityPickerModalProps) {
    const { portfolio } = usePortfolioStore();

    const [searchQuery, setSearchQuery] = useState('');

    const allEntities = listEntityCandidates(portfolio, allowedTypes).map(candidate => ({
        reference: candidate.reference,
        id: candidate.reference.id,
        type: candidate.reference.type,
        name: candidate.label,
        subtitle: candidate.context,
    }));

    // Filter by search
    const filteredEntities = allEntities.filter(entity => {
        return entity.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const handleSelect = (entity: typeof allEntities[0]) => {
        onSelect({ ...entity.reference, source: 'manual' });
        onClose();
    };

    return createPortal(
        <AxiomDialog
            aria-labelledby="entity-picker-title"
            onClose={onClose}
            rootClassName="z-[10120]"
            panelClassName="w-[500px] max-h-[600px] flex flex-col overflow-hidden"
        >
                {/* Header */}
                <div className="axiom-dialog-header px-4 py-3 border-b">
                    <h3 id="entity-picker-title" className="text-sm font-bold text-text-main mb-3">Add Linked Context</h3>
                    <div className="relative">
                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
                        <AxiomInput
                            type="search"
                            aria-label="Search entities"
                            placeholder="Search entities..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            controlSize="sm"
                            className="axiom-field-leading-icon w-full pr-3 text-sm"
                            autoFocus
                        />
                    </div>
                </div>

                {/* Results */}
                <div className="axiom-dialog-body flex-1 overflow-y-auto custom-scrollbar p-2">
                    {filteredEntities.length === 0 ? (
                        <div className="text-center py-8 text-text-faint text-xs">
                            No entities found
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredEntities.map((entity) => (
                                <button
                                    key={entity.id}
                                    onClick={() => handleSelect(entity)}
                                    className="axiom-dialog-row w-full flex items-center gap-3 px-3 py-2 text-left"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-text-main truncate">
                                            {entity.name}
                                        </div>
                                        <div className="text-xs text-text-faint">{entity.subtitle}</div>
                                    </div>
                                    <div className="axiom-dialog-badge text-[10px] uppercase px-2 py-0.5">
                                        {entity.type}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="axiom-dialog-footer px-4 py-3 border-t flex justify-end gap-2">
                    <AxiomButton
                        onClick={onClose}
                        size="sm"
                    >
                        Cancel
                    </AxiomButton>
                </div>
        </AxiomDialog>,
        document.body,
    );
}
