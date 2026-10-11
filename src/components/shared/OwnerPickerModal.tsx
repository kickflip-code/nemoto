import { useMemo, useState } from 'react';
import { Check, Plus, Search, Trash2, X } from 'lucide-react';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { resolveEntity } from '../../lib/entityResolver';
import { generateId } from '../../lib/id';
import { getIconComponent } from '../../lib/iconMap';
import type { Asset, AssetCategory } from '../../types';
import {
    AxiomButton,
    AxiomDialog,
    AxiomDialogBody,
    AxiomDialogFooter,
    AxiomInput,
    AxiomSelect,
} from '../ui';

interface OwnerPickerModalProps {
    onClose: () => void;
    onSelect: (id: string | null) => void;
    currentOwnerId?: string | null;
}

const isOwnerCategory = (category: AssetCategory) => {
    const semanticType = category.baseType ?? category.id;
    return semanticType !== 'document' && semanticType !== 'location';
};

export default function OwnerPickerModal({ onClose, onSelect, currentOwnerId }: OwnerPickerModalProps) {
    const { portfolio, addAsset } = usePortfolioStore();
    const [search, setSearch] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [newResourceName, setNewResourceName] = useState('');
    const [newResourceCategory, setNewResourceCategory] = useState('');

    const ownerCategories = useMemo(
        () => (portfolio.assetCategories || []).filter(isOwnerCategory),
        [portfolio.assetCategories],
    );

    const potentialOwners = useMemo(() => {
        const excludedCategoryIds = new Set(
            (portfolio.assetCategories || [])
                .filter(category => !isOwnerCategory(category))
                .map(category => category.id),
        );

        return (portfolio.assets || []).filter(asset => (
            asset.type !== 'document'
            && asset.type !== 'location'
            && !excludedCategoryIds.has(asset.type)
        ));
    }, [portfolio.assetCategories, portfolio.assets]);

    const filteredItems = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        if (!normalizedSearch) return potentialOwners;

        return potentialOwners
            .map(item => {
                const labelLower = (item.name || '').toLowerCase();
                let score = -1;

                if (labelLower.startsWith(normalizedSearch)) score = 100;
                else if (labelLower.includes(normalizedSearch)) score = 50;

                return { item, score };
            })
            .filter(result => result.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(result => result.item);
    }, [potentialOwners, search]);

    const beginCreatingResource = () => {
        setNewResourceName(search.trim());
        setNewResourceCategory(ownerCategories[0]?.id ?? '');
        setIsCreating(true);
    };

    const handleCreateResource = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!newResourceName.trim() || !newResourceCategory) return;

        const newAsset: Asset = {
            id: generateId('res'),
            name: newResourceName.trim(),
            type: newResourceCategory,
            parentId: undefined,
        };

        addAsset(newAsset);
        onSelect(newAsset.id);
        onClose();
    };

    return (
        <AxiomDialog
            aria-labelledby="owner-picker-title"
            onClose={onClose}
            panelClassName="w-[500px] max-h-[600px] flex flex-col overflow-hidden"
        >
            <div className="axiom-dialog-header h-12 border-b flex items-center justify-between px-4 shrink-0">
                <h2 id="owner-picker-title" className="font-bold text-sm text-text-main">
                    {isCreating ? 'Create Resource' : 'Select Owner'}
                </h2>
                <AxiomButton icon size="sm" variant="ghost" onClick={onClose} aria-label="Close owner picker">
                    <X size={16} />
                </AxiomButton>
            </div>

            {isCreating ? (
                <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleCreateResource}>
                    <AxiomDialogBody className="flex-1 space-y-4 overflow-y-auto p-4">
                        <p className="text-xs leading-relaxed text-text-muted">
                            Add the missing resource and use it as the process owner immediately.
                        </p>

                        <div className="space-y-1.5">
                            <label htmlFor="owner-resource-category" className="text-[10px] font-bold uppercase tracking-wider text-text-faint">
                                Category
                            </label>
                            <AxiomSelect
                                id="owner-resource-category"
                                controlSize="sm"
                                className="w-full"
                                value={newResourceCategory}
                                onChange={event => setNewResourceCategory(event.target.value)}
                                disabled={ownerCategories.length === 0}
                            >
                                {ownerCategories.map(category => (
                                    <option key={category.id} value={category.id}>{category.label}</option>
                                ))}
                            </AxiomSelect>
                            {ownerCategories.length === 0 && (
                                <p className="text-[10px] leading-relaxed text-text-faint">
                                    Create a resource category in Portfolio before adding an owner.
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <label htmlFor="owner-resource-name" className="text-[10px] font-bold uppercase tracking-wider text-text-faint">
                                Resource Name
                            </label>
                            <AxiomInput
                                id="owner-resource-name"
                                controlSize="sm"
                                className="w-full"
                                value={newResourceName}
                                onChange={event => setNewResourceName(event.target.value)}
                                placeholder="e.g. Product Owner"
                                autoFocus
                            />
                        </div>
                    </AxiomDialogBody>

                    <AxiomDialogFooter className="flex justify-end gap-2 border-t px-4 py-3">
                        <AxiomButton size="sm" onClick={() => setIsCreating(false)}>
                            Back
                        </AxiomButton>
                        <AxiomButton
                            size="sm"
                            variant="primary"
                            type="submit"
                            disabled={!newResourceName.trim() || !newResourceCategory}
                        >
                            Create Resource
                        </AxiomButton>
                    </AxiomDialogFooter>
                </form>
            ) : (
                <>
                    <div className="axiom-dialog-header border-b p-4 shrink-0">
                        <div className="relative">
                            <Search
                                size={14}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                                aria-hidden="true"
                            />
                            <AxiomInput
                                aria-label="Search owners"
                                autoFocus
                                type="search"
                                placeholder="Search resources, roles, systems..."
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                controlSize="sm"
                                className="axiom-field-leading-icon w-full text-sm"
                            />
                        </div>
                    </div>

                    <AxiomDialogBody className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                        <div className="space-y-1">
                            {currentOwnerId && !search && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onSelect(null);
                                        onClose();
                                    }}
                                    className="axiom-dialog-row axiom-dialog-row-danger mb-2 flex w-full items-center gap-3 p-3 text-left"
                                >
                                    <span className="axiom-dialog-icon-danger flex h-8 w-8 items-center justify-center rounded">
                                        <Trash2 size={16} />
                                    </span>
                                    <span className="flex-1 text-sm font-medium">Remove Current Owner</span>
                                </button>
                            )}

                            {filteredItems.map(item => {
                                const resolved = resolveEntity(item.id, 'asset', portfolio);
                                const isSelected = item.id === currentOwnerId;
                                const IconComponent = getIconComponent(resolved?.icon);

                                return (
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => {
                                            onSelect(item.id);
                                            onClose();
                                        }}
                                        className={`axiom-dialog-row group flex w-full items-center gap-3 p-3 text-left ${isSelected ? 'axiom-dialog-row-selected' : ''}`}
                                    >
                                        <span className="axiom-dialog-row-icon flex h-8 w-8 items-center justify-center transition-colors">
                                            <IconComponent size={16} />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium text-text-main">
                                                {resolved?.displayName || item.name}
                                            </span>
                                            <span className="block truncate text-[10px] text-text-muted">
                                                {resolved?.subtitle || item.type} • <span className="font-mono text-text-faint">{item.id}</span>
                                            </span>
                                        </span>
                                        {isSelected ? <Check size={14} className="text-accent-primary" /> : <span className="w-3.5" />}
                                    </button>
                                );
                            })}

                            {filteredItems.length === 0 && (
                                <div className="px-3 py-8 text-center text-xs italic text-text-faint">
                                    No owners found.
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={beginCreatingResource}
                                className="axiom-dialog-row mt-2 flex w-full items-center gap-3 border-t p-3 text-left text-accent-primary"
                            >
                                <span className="axiom-dialog-row-icon flex h-8 w-8 items-center justify-center">
                                    <Plus size={16} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium">Create new resource</span>
                                    <span className="block truncate text-[10px] text-text-muted">
                                        {search.trim() ? `Use “${search.trim()}” as the resource name` : 'Add a missing owner to Portfolio'}
                                    </span>
                                </span>
                            </button>
                        </div>
                    </AxiomDialogBody>
                </>
            )}
        </AxiomDialog>
    );
}
