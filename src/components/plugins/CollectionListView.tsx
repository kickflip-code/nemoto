import { useMemo, useState } from 'react';
import { CalendarDays, Check, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
    PluginCollectionField,
    PluginCollectionListView,
} from '../../plugins/contributionSchemas';
import type { PluginCollectionItem } from '../../plugins/collectionStorage';
import { AxiomButton, AxiomInput } from '../ui';
import {
    usePluginHostServices,
    usePluginHostSnapshot,
} from './PluginHostServicesContext';

interface CollectionListViewProps {
    pluginId: string;
    view: PluginCollectionListView;
}

const makeBlankValues = (fields: PluginCollectionField[]): Record<string, string | boolean> => (
    Object.fromEntries(fields.map(field => [field.key, field.type === 'boolean' ? false : '']))
);

const makeItemId = (): string => (
    typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

export default function CollectionListView({ pluginId, view }: CollectionListViewProps) {
    const host = usePluginHostServices();
    const { portfolioRevision, installedPlugins, pluginRequirements } = usePluginHostSnapshot();
    const pluginApi = useMemo(
        () => host.publicApi.connect(pluginId),
        [host, installedPlugins, pluginId, pluginRequirements],
    );
    const canWrite = useMemo(
        () => host.permissions.has(pluginId, 'plugin-data.write'),
        [host, installedPlugins, pluginId],
    );
    const collection = useMemo(
        () => pluginApi.storage.readCollection(view.collection.id),
        [pluginApi, portfolioRevision, view.collection.id],
    );
    const [draft, setDraft] = useState<Record<string, string | boolean>>(
        () => makeBlankValues(view.collection.fields),
    );

    const commit = (items: PluginCollectionItem[]): boolean => {
        if (!canWrite) {
            toast.error('This plugin does not have permission to save portfolio data.');
            return false;
        }
        try {
            pluginApi.storage.replaceCollection({
                view,
                items,
                expectedRevision: portfolioRevision,
            });
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Plugin data could not be saved.');
            return false;
        }
    };

    const addItem = () => {
        const primaryValue = draft[view.collection.primaryField];
        if (typeof primaryValue !== 'string' || !primaryValue.trim()) {
            toast.error(`${view.collection.itemLabel} needs a title.`);
            return;
        }
        const now = new Date().toISOString();
        const saved = commit([
            ...collection.items,
            { id: makeItemId(), createdAt: now, updatedAt: now, values: { ...draft } },
        ]);
        if (saved) setDraft(makeBlankValues(view.collection.fields));
    };

    const updateItem = (itemId: string, key: string, value: string | boolean) => {
        commit(collection.items.map(item => item.id === itemId ? {
            ...item,
            updatedAt: new Date().toISOString(),
            values: { ...item.values, [key]: value },
        } : item));
    };

    return (
        <div className="h-full overflow-y-auto bg-app-bg p-6 text-text-main">
            <div className="mx-auto max-w-4xl space-y-6">
                <header className="border-b border-app-border pb-5">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent-primary">
                        {view.content.eyebrow}
                    </div>
                    <h1 className="mt-2 text-2xl font-black tracking-tight">{view.content.title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                        {view.content.description}
                    </p>
                </header>

                {collection.error && (
                    <div role="alert" className="rounded-lg border border-accent-danger/30 bg-accent-danger/5 p-4 text-sm text-accent-danger">
                        {collection.error}
                    </div>
                )}

                {!collection.error && canWrite && (
                    <form
                        aria-label={`Add ${view.collection.itemLabel}`}
                        className="axiom-dialog-panel grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]"
                        onSubmit={event => { event.preventDefault(); addItem(); }}
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            {view.collection.fields.filter(field => field.type !== 'boolean').map(field => (
                                <label key={field.key} className="grid gap-1.5 text-xs text-text-muted">
                                    {field.label}
                                    <AxiomInput
                                        type={field.type === 'date' ? 'date' : 'text'}
                                        value={String(draft[field.key] || '')}
                                        maxLength={field.maxLength}
                                        placeholder={field.placeholder}
                                        required={field.required}
                                        onChange={event => setDraft(current => ({
                                            ...current,
                                            [field.key]: event.target.value,
                                        }))}
                                    />
                                </label>
                            ))}
                        </div>
                        <AxiomButton type="submit" className="self-end">
                            <Plus size={14} />
                            {view.content.addLabel}
                        </AxiomButton>
                    </form>
                )}

                {!collection.error && collection.items.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-app-border px-6 py-12 text-center">
                        <Check size={28} className="mx-auto text-text-faint" aria-hidden="true" />
                        <h2 className="mt-3 text-base font-bold">{view.content.emptyTitle}</h2>
                        <p className="mt-1 text-sm text-text-muted">{view.content.emptyDescription}</p>
                    </div>
                ) : null}

                {!collection.error && collection.items.length > 0 && (
                    <ul aria-label={view.content.title} className="space-y-2">
                        {collection.items.map(item => {
                            const primary = String(item.values[view.collection.primaryField] || '');
                            const booleanField = view.collection.fields.find(field => field.type === 'boolean');
                            const dateField = view.collection.fields.find(field => field.type === 'date');
                            const completed = booleanField ? item.values[booleanField.key] === true : false;
                            return (
                                <li key={item.id} className="axiom-dialog-row flex items-center gap-3 p-3">
                                    {booleanField && (
                                        <input
                                            type="checkbox"
                                            aria-label={`Mark ${primary} as ${completed ? 'not completed' : 'completed'}`}
                                            checked={completed}
                                            disabled={!canWrite}
                                            onChange={event => updateItem(item.id, booleanField.key, event.target.checked)}
                                            className="h-4 w-4 accent-[var(--color-accent-primary)]"
                                        />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className={`text-sm font-semibold ${completed ? 'text-text-faint line-through' : ''}`}>
                                            {primary}
                                        </div>
                                        {dateField && item.values[dateField.key] && (
                                            <div className="mt-1 flex items-center gap-1 text-[11px] text-text-muted">
                                                <CalendarDays size={12} aria-hidden="true" />
                                                {String(item.values[dateField.key])}
                                            </div>
                                        )}
                                    </div>
                                    {canWrite && (
                                        <AxiomButton
                                            icon
                                            aria-label={`Delete ${primary}`}
                                            title={`Delete ${primary}`}
                                            onClick={() => commit(collection.items.filter(candidate => candidate.id !== item.id))}
                                        >
                                            <Trash2 size={14} />
                                        </AxiomButton>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
