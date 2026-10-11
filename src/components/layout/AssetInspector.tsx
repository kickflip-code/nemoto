import { useEffect, useState, useMemo } from 'react';

import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { Check, Trash2, X } from 'lucide-react';
import LinkedNotes from '../shared/LinkedNotes';
import ConfirmationModal from '../shared/ConfirmationModal';

interface AssetInspectorProps {
    id: string;
}

export default function AssetInspector({ id }: AssetInspectorProps) {
    const { portfolio, updateAsset, deleteAsset } = usePortfolioStore();
    const assets = portfolio.assets || [];
    const asset = assets.find(a => a.id === id);

    const [editedName, setEditedName] = useState('');
    const [editedType, setEditedType] = useState<string>('system');
    const [editedMetadata, setEditedMetadata] = useState<Record<string, unknown>>({});
    const [newMetaKey, setNewMetaKey] = useState('');
    const [newMetaValue, setNewMetaValue] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);

    // Dynamic Category Options
    const categoryOptions = useMemo(() => {
        if (!portfolio.assetCategories) return [];
        return portfolio.assetCategories.map(cat => ({
            value: cat.id,
            label: cat.label
        }));
    }, [portfolio.assetCategories]);

    // Sync state when asset changes
    useEffect(() => {
        if (asset) {
            setEditedName(asset.name);
            setEditedType(asset.type);
            setEditedMetadata(asset.metadata || {});
        }
    }, [asset]);

    if (!asset) return <div className="p-4 text-text-muted text-xs">Resource not found</div>;

    const handleSave = () => {
        updateAsset(asset.id, {
            name: editedName.trim(),
            type: editedType,
            metadata: Object.keys(editedMetadata).length > 0 ? editedMetadata : undefined,
        });
    };

    const handleBlur = () => {
        handleSave();
    };

    const handleDelete = () => {
        setConfirmOpen(true);
    };

    const confirmDelete = () => {
        deleteAsset(asset.id);
    };

    const addMetadataField = () => {
        if (newMetaKey.trim()) {
            const newMeta = { ...editedMetadata, [newMetaKey.trim()]: newMetaValue.trim() };
            setEditedMetadata(newMeta);
            setNewMetaKey('');
            setNewMetaValue('');
            // Auto-save on add
            updateAsset(asset.id, { metadata: newMeta });
        }
    };

    const removeMetadataField = (key: string) => {
        const newMeta = { ...editedMetadata };
        delete newMeta[key];
        setEditedMetadata(newMeta);
        // Auto-save on remove
        updateAsset(asset.id, { metadata: newMeta });
    };

    return (
        <div className="space-y-6">
            {/* Header / Identity */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Identity</label>
                <div className="space-y-3">
                    <div>
                        <label className="text-[9px] text-text-muted block mb-1">Name</label>
                        <input
                            type="text"
                            value={editedName}
                            aria-label="Name"
                            onChange={(e) => setEditedName(e.target.value)}
                            onBlur={handleBlur}
                            className="axiom-field axiom-field-sm w-full"
                        />
                    </div>
                    <div>
                        <label className="text-[9px] text-text-muted block mb-1">Category</label>
                        <select
                            value={editedType}
                            aria-label="Category"
                            onChange={(e) => {
                                setEditedType(e.target.value);
                                // Immediate save for dropdown
                                updateAsset(asset.id, { type: e.target.value });
                            }}
                            className="axiom-field axiom-field-sm w-full appearance-none cursor-pointer"
                        >
                            <option value="">Select Category...</option>
                            {categoryOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                            {!categoryOptions.some(o => o.value === editedType) && editedType && (
                                <option value={editedType}>{editedType} (Legacy)</option>
                            )}
                        </select>
                    </div>
                </div>
            </div>

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Custom Metadata */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Properties</label>

                <div className="space-y-2 mb-3">
                    {Object.entries(editedMetadata).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 group">
                            <div className="axiom-panel-card flex-1 min-w-0 px-2 py-1 text-xs flex justify-between">
                                <span className="text-text-faint font-mono mr-2">{key}</span>
                                <span className="text-text-main">
                                    {typeof value === 'string' ? value : JSON.stringify(value)}
                                </span>
                            </div>
                            <button
                                onClick={() => removeMetadataField(key)}
                                aria-label={`Remove property ${key}`}
                                className="axiom-panel-icon-button axiom-icon-button-sm axiom-panel-icon-button-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>

                {/* Add New Prop */}
                <div className="axiom-panel-card p-2.5 space-y-2.5">
                    <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Add Property</div>
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newMetaKey}
                            aria-label="Property key"
                            onChange={(e) => setNewMetaKey(e.target.value)}
                            placeholder="Key"
                            className="axiom-field axiom-field-xs flex-1 min-w-0 placeholder:text-text-faint"
                        />
                        <input
                            type="text"
                            value={newMetaValue}
                            aria-label="Property value (optional)"
                            onChange={(e) => setNewMetaValue(e.target.value)}
                            placeholder="Value (optional)"
                            className="axiom-field axiom-field-xs flex-1 min-w-0 placeholder:text-text-faint"
                        />
                    </div>
                    <button
                        onClick={addMetadataField}
                        disabled={!newMetaKey.trim()}
                        className="axiom-button axiom-button-sm w-full disabled:opacity-70"
                    >
                        <Check size={10} /> Add Property
                    </button>
                </div>
            </div>

            <div className="axiom-panel-divider h-[1px]"></div>

            <LinkedNotes entityId={id} entityType="asset" name={asset.name} />

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Actions */}
            <div>
                <button
                    onClick={handleDelete}
                    className="axiom-button axiom-button-sm axiom-button-danger w-full"
                >
                    <Trash2 size={14} />
                    Delete Resource
                </button>
            </div>

            {/* Meta Info */}
            <div className="pt-4 text-[10px] text-text-faint space-y-1 font-mono">
                <div className="flex justify-between">
                    <span>ID</span>
                    <span className="truncate max-w-[150px]">{asset.id}</span>
                </div>
            </div>

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={confirmDelete}
                title="Delete Resource"
                message={`Are you sure you want to delete "${asset.name}"? This action cannot be undone.`}
                variant="danger"
            />
        </div>
    );
}
