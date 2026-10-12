import { Copy, FileDown, ArrowUpRight, Search, Link2, X, Trash2 } from 'lucide-react';
import '../../styles/features/tasks.css';
import { coreEntityReference } from '../../plugins/universalReference';
import { completionDay, createRecordReport } from '../../plugins/contextualRecordReport';
import { exportRecordReport } from '../../host/contextualRecordReportExport';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { PluginCollectionListView } from '../../plugins/contributionSchemas';
import type { PluginCollectionItem } from '../../plugins/collectionStorage';
import type { RecordContext } from '../../plugins/contextualRecords';
import type { NemotoPluginApi } from '../../plugins/publicApi';
import { createContextualItem, resolveRecordContext } from '../../plugins/contextualRecordModel';
import { NemotoButton, NemotoInput, NemotoDialog, NemotoSelect } from '../ui';
import { usePluginHostServices, usePluginHostSnapshot } from './PluginHostServicesContext';
import RecordRichTextEditor from './RecordRichTextEditor';

export default function ContextualCollectionView({ pluginId, view }: { pluginId: string; view: PluginCollectionListView }) {
    const host = usePluginHostServices();
    const snapshot = usePluginHostSnapshot();
    const api = useMemo(() => host.publicApi.connect(pluginId), [host, pluginId, snapshot.installedPlugins, snapshot.pluginRequirements]);
    const [title, setTitle] = useState('');
    const [quickDueDate, setQuickDueDate] = useState('');
    const [omitContext, setOmitContext] = useState(false);
    const [scope, setScope] = useState('all');
    const [processFilter, setProcessFilter] = useState('');
    const [search, setSearch] = useState('');
    const [archive, setArchive] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [editing, setEditing] = useState<{ item: PluginCollectionItem; revision: number } | null>(null);
    const [deletingItem, setDeletingItem] = useState<PluginCollectionItem | null>(null);
    const canWrite = host.permissions.has(pluginId, 'plugin-data.write');
    const data = useMemo(() => {
        try {
            const collection = api.storage.readCollection(view.collection.id);
            if (collection.error) throw new Error(collection.error);
            if (collection.items.some(item => !item.details)) throw new Error('Saved records need a compatible data migration. Data has been left untouched.');
            const workspace = api.workspace.getContext();
            const contexts = new Map(collection.items.map(item => [item.id, item.details?.context ? resolveRecordContext(api, item.details.context.reference) : null]));
            return { items: collection.items, workspace, contexts, error: null };
        } catch (error) { return { items: [], workspace: null, contexts: new Map<string, RecordContext | null>(), error: error instanceof Error ? error.message : 'Records unavailable.' }; }
    }, [api, snapshot.portfolioRevision, view.collection.id]);
    const processOptions = useMemo(() => {
        const options = new Map<string, string>();
        for (const item of data.items) {
            const context = data.contexts.get(item.id) ?? item.details?.context;
            const id = context?.reference.kind === 'core.process' ? context.reference.id : context?.reference.location?.processId;
            if (!id || options.has(id)) continue;
            const process = api.read.getEntity(coreEntityReference('core.process', id));
            options.set(id, process?.label ?? `Unavailable process: ${context?.locationSnapshot || context?.labelSnapshot || id}`);
        }
        return [...options].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
    }, [api, data]);
    const config = view.contextual!;
    const itemLabel = view.collection.itemLabel || 'item';
    const capitalizedItemLabel = itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1);
    const primaryFieldDef = view.collection.fields.find(f => f.key === view.collection.primaryField);
    const primaryLabel = primaryFieldDef?.label || 'Title';
    const dueDateFieldDef = view.collection.fields.find(f => f.key === config.dueDateField);
    const dueDateLabel = dueDateFieldDef?.label || 'Due date';

    const commit = (items: PluginCollectionItem[], revision = snapshot.portfolioRevision) => {
        try { api.storage.replaceCollection({ view, items, expectedRevision: revision }); return true; }
        catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save.'); return false; }
    };
    const update = (item: PluginCollectionItem, revision?: number) => commit(data.items.map(old => old.id === item.id ? { ...item, updatedAt: new Date().toISOString() } : old), revision);
    const removePermanent = (item: PluginCollectionItem) => {
        if (commit(data.items.filter(candidate => candidate.id !== item.id))) {
            setDeletingItem(null);
            if (editing?.item.id === item.id) setEditing(null);
            toast.success(`${capitalizedItemLabel} permanently deleted`);
        }
    };
    const captureContext = () => {
        if (omitContext) return null;
        const ref = processFilter.startsWith('process:') ? coreEntityReference('core.process', processFilter.slice(8)) : scope === 'process' ? data.workspace?.activeProcess : null;
        return ref && ['core.node', 'core.process'].includes(ref.kind) ? resolveRecordContext(api, ref) : null;
    };
    const openContext = (context: RecordContext) => {
        try {
            const result = api.workspace.open({ schema: 'axiom.plugin-navigation-intent', schemaVersion: 1, action: 'inspect', reference: context.reference });
            if (result.status !== 'opened') toast.error('The linked object could not be opened.');
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not navigate.'); }
    };
    const rows = data.items.filter(item => {
        if ((item.values[config.completionField] === true) !== archive) return false;
        if (archive && ((from && completionDay(item) < from) || (to && completionDay(item) > to))) return false;
        const context = data.contexts.get(item.id) ?? item.details?.context;
        const processId = context?.reference.kind === 'core.process' ? context.reference.id : context?.reference.location?.processId;
        if (processFilter === 'unlinked' && context) return false;
        if (processFilter.startsWith('process:') && processId !== processFilter.slice(8)) return false;
        if (scope === 'process' && (!context || (context.reference.kind === 'core.process' ? context.reference.id : context.reference.location?.processId) !== data.workspace?.activeProcess?.id)) return false;
        return `${item.values[view.collection.primaryField]} ${context?.labelSnapshot ?? ''} ${context?.locationSnapshot ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
    }).sort((a, b) => (archive ? (b.details?.completedAt ?? '').localeCompare(a.details?.completedAt ?? '') : 0) || String(a.values[config.dueDateField] || '9999').localeCompare(String(b.values[config.dueDateField] || '9999')) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const report = async (copy: boolean) => {
        try {
            const text = createRecordReport(view, rows, data.contexts);
            if (copy) { await navigator.clipboard.writeText(text); toast.success(`${capitalizedItemLabel} list copied`); }
            else if (await exportRecordReport(text)) toast.success(`${capitalizedItemLabel} list exported`);
        } catch (error) { toast.error(error instanceof Error ? error.message : `Could not export ${itemLabel} list.`); }
    };
    const quickContext = captureContext();
    return <div className="nemoto-tasks h-full overflow-auto bg-app-bg text-text-main"><div className="nemoto-tasks-page">
        <header className="nemoto-tasks-header"><h1 className="text-2xl font-bold text-accent-primary">{view.content.title}</h1></header>
        {data.error ? <p role="alert">{data.error}</p> : <>
            <div className="nemoto-tasks-toolbar">
                <div className="nemoto-tasks-segments" aria-label="Scope">
                    {[['all', 'All'], ['process', 'Current process']].map(([id, label]) => <NemotoButton size="sm" key={id} aria-pressed={scope === id && !processFilter} disabled={id === 'process' ? !data.workspace?.activeProcess : false} onClick={() => { setScope(id); setProcessFilter(''); setOmitContext(false); }}>{label}</NemotoButton>)}
                </div>
                <div className="nemoto-tasks-tools">
                    <div className="nemoto-tasks-segments" aria-label={`${capitalizedItemLabel} status`}>
                        <NemotoButton size="sm" aria-pressed={!archive} onClick={() => setArchive(false)}>Open</NemotoButton>
                        <NemotoButton size="sm" aria-pressed={archive} onClick={() => setArchive(true)}>Archive</NemotoButton>
                    </div>
                    <NemotoButton icon size="sm" aria-label="Copy list" title={`Copy filtered ${itemLabel} list to clipboard`} disabled={!rows.length} onClick={() => void report(true)}><Copy size={16} /></NemotoButton>
                    <NemotoButton icon size="sm" aria-label="Export text" title={`Export filtered ${itemLabel} list as text file`} disabled={!rows.length} onClick={() => void report(false)}><FileDown size={16} /></NemotoButton>
                </div>
            </div>
            <div className="nemoto-tasks-filters">
                <label className="nemoto-tasks-search"><Search size={16} aria-hidden="true" /><NemotoInput aria-label={`Search ${itemLabel}s`} placeholder={`Search ${itemLabel}s or context`} value={search} onChange={event => setSearch(event.target.value)} /></label>
                <NemotoSelect aria-label="Filter by process" value={processFilter} onChange={event => { setProcessFilter(event.target.value); setScope('all'); setOmitContext(false); }}>
                    <option value="">All processes</option>
                    <option value="unlinked">No linked object</option>
                    {processOptions.map(([id, label]) => <option key={id} value={`process:${id}`}>{label}</option>)}
                    {processFilter.startsWith('process:') && !processOptions.some(([id]) => `process:${id}` === processFilter) && <option value={processFilter}>Selected process (no {itemLabel}s)</option>}
                </NemotoSelect>
            </div>
            {canWrite && !archive && <section className="nemoto-tasks-quick" aria-labelledby="tasks-quick-title">
                <h2 id="tasks-quick-title">Quick add</h2>
                <form className="nemoto-tasks-quick-form" onSubmit={event => {
                    event.preventDefault();
                    const item = createContextualItem(view, title, quickContext);
                    if (config.dueDateField) {
                        item.values[config.dueDateField] = quickDueDate;
                    }
                    if (title.trim() && commit([...data.items, item])) { setTitle(''); setQuickDueDate(''); setOmitContext(false); toast.success(`${capitalizedItemLabel} added`); }
                }}>
                    <NemotoInput aria-label={`New ${itemLabel} ${primaryLabel.toLowerCase()}`} placeholder={primaryFieldDef?.placeholder || (itemLabel === 'task' ? 'What needs to be done?' : `Add ${itemLabel}...`)} maxLength={primaryFieldDef?.maxLength ?? 500} value={title} onChange={event => setTitle(event.target.value)} required />
                    <NemotoInput type="date" aria-label={`New ${itemLabel} ${dueDateLabel.toLowerCase()}`} title={`Optional ${dueDateLabel.toLowerCase()}`} value={quickDueDate} onChange={event => setQuickDueDate(event.target.value)} />
                    <NemotoButton type="submit" variant="primary">{view.content.addLabel}</NemotoButton>
                </form>
                {quickContext ? <span className="nemoto-tasks-context-chip"><Link2 size={13} aria-hidden="true" />{quickContext.reference.kind === 'core.node' ? 'Node' : 'Process'}: {quickContext.labelSnapshot}<button className="nemoto-text-button" aria-label="Remove quick-add context" title="Create without a linked object" onClick={() => setOmitContext(true)}><X size={13} /></button></span> : <span className="text-xs text-text-muted">New {itemLabel} without a linked object</span>}
            </section>}
            {archive && <div className="nemoto-tasks-archive-dates flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm">Completed from<NemotoInput type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label>
                <label className="grid gap-1 text-sm">Completed through<NemotoInput type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
                <NemotoButton disabled={!from && !to} onClick={() => { setFrom(''); setTo(''); }}>Clear dates</NemotoButton>
            </div>}
            <div className="nemoto-tasks-list-heading"><h2>{archive ? `Completed ${itemLabel}s` : `${capitalizedItemLabel}s list`}<span>{rows.length}</span></h2></div>
            <ul className="space-y-2" aria-label={view.content.title}>{rows.map(item => {
                const completed = item.values[config.completionField] === true;
                const context = data.contexts.get(item.id);
                const savedContext = item.details?.context;
                const name = String(item.values[view.collection.primaryField]);
                return <li key={item.id} className="nemoto-tasks-row">
                    <input type="checkbox" className="nemoto-tasks-check" aria-label={`Mark ${name} as ${completed ? 'open' : 'completed'}`} disabled={!canWrite} checked={completed} onChange={() => {
                        const completedAt = completed ? null : new Date().toISOString();
                        if (update({ ...item, values: { ...item.values, [config.completionField]: !completed }, details: { ...item.details!, completedAt } })) {
                            toast.success(completed ? `${capitalizedItemLabel} reopened` : `${capitalizedItemLabel} archived`, { action: { label: 'Undo', onClick: () => {
                                try {
                                    const current = api.storage.readCollection(view.collection.id);
                                    if (current.error) throw new Error(current.error);
                                    const record = current.items.find(entry => entry.id === item.id);
                                    if (!record || record.values[config.completionField] !== !completed || record.details?.completedAt !== completedAt) {
                                        toast.info(`This ${itemLabel} has changed. Open it to review its current status.`);
                                        return;
                                    }
                                    api.storage.replaceCollection({ view, expectedRevision: api.workspace.getContext().portfolioRevision,
                                        items: current.items.map(entry => entry.id === item.id ? { ...entry, updatedAt: new Date().toISOString(),
                                            values: { ...entry.values, [config.completionField]: completed },
                                            details: { ...entry.details!, completedAt: item.details!.completedAt } } : entry) });
                                    toast.success(`${capitalizedItemLabel} status restored`);
                                } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not undo.'); }
                            } } });
                        }
                    }} />
                    <div className="min-w-0 flex-1"><button className={`nemoto-text-button nemoto-tasks-open text-left font-semibold ${completed ? 'line-through text-text-muted' : ''}`} onClick={() => setEditing({ item: structuredClone(item), revision: snapshot.portfolioRevision })}>{name}</button>
                        {savedContext && <div className="mt-1 text-xs text-text-muted truncate">{context ? <span><strong className="font-medium text-text-main">{context.labelSnapshot}</strong>{context.locationSnapshot ? <span> ({context.locationSnapshot})</span> : null}</span> : <span>Object unavailable: {savedContext.labelSnapshot}{savedContext.locationSnapshot ? ` (${savedContext.locationSnapshot})` : ''}</span>}</div>}
                    </div>
                    {(completed ? item.details?.completedAt : item.values[config.dueDateField]) && <time className="shrink-0 text-xs text-text-muted">{completed ? `Completed ${completionDay(item)}` : String(item.values[config.dueDateField])}</time>}
                    {context && <NemotoButton className="nemoto-tasks-navigate" icon size="sm" variant="ghost" aria-label={`Show on canvas: ${name}`} title={`Show on canvas: ${context.labelSnapshot}`} onClick={() => openContext(context)}><ArrowUpRight size={18} /></NemotoButton>}
                    {archive && canWrite && <NemotoButton className="nemoto-tasks-delete text-text-muted hover:text-accent-danger" icon size="sm" variant="ghost" aria-label={`Permanently delete ${name}`} title={`Permanently delete ${itemLabel}`} onClick={() => setDeletingItem(item)}><Trash2 size={16} /></NemotoButton>}
                </li>;
            })}</ul>
            {rows.length === 0 && <p className="py-8 text-center text-text-muted">{archive ? `No completed ${itemLabel}s match these filters.` : `No open ${itemLabel}s match these filters.`}</p>}
        </>}
        {deletingItem && (
            <NemotoDialog aria-labelledby="delete-task-title" onClose={() => setDeletingItem(null)} panelClassName="w-full max-w-md p-6">
                <h2 id="delete-task-title" className="text-lg font-bold text-accent-danger">Delete {itemLabel} permanently?</h2>
                <p className="mt-2 text-sm text-text-muted">
                    Are you sure you want to permanently delete <strong className="text-text-main">{String(deletingItem.values[view.collection.primaryField] || `Untitled ${itemLabel}`)}</strong>? This action cannot be undone.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                    <NemotoButton onClick={() => setDeletingItem(null)}>Cancel</NemotoButton>
                    <NemotoButton variant="danger" onClick={() => removePermanent(deletingItem)}>Delete permanently</NemotoButton>
                </div>
            </NemotoDialog>
        )}
        {editing && <RecordDetails key={editing.item.id} api={api} view={view} item={editing.item} canWrite={canWrite} onClose={() => setEditing(null)} onSave={item => { if (update(item, editing.revision)) setEditing(null); }} onDelete={editing.item.values[config.completionField] === true ? () => removePermanent(editing.item) : undefined} onOpen={openContext} />}
    </div></div>;
}

function RecordDetails({ api, view, item, canWrite, onClose, onSave, onDelete, onOpen }: { api: NemotoPluginApi; view: PluginCollectionListView; item: PluginCollectionItem; canWrite: boolean; onClose: () => void; onSave: (item: PluginCollectionItem) => void; onDelete?: () => void; onOpen: (context: RecordContext) => void }) {
    const [draft, setDraft] = useState(item);
    const [query, setQuery] = useState('');
    const [discard, setDiscard] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const dirty = JSON.stringify(draft) !== JSON.stringify(item);
    let context: RecordContext | null = null;
    let results: ReturnType<NemotoPluginApi['read']['search']> = [];
    try {
        if (draft.details?.context) context = resolveRecordContext(api, draft.details.context.reference);
        if (query.trim()) results = api.read.search({ query, kinds: ['core.node', 'core.process'], limit: 12 });
    } catch { /* Retain the saved label when content permissions or the target disappear. */ }
    const config = view.contextual!;
    const itemLabel = view.collection.itemLabel || 'item';
    const capitalizedItemLabel = itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1);
    const primaryFieldDef = view.collection.fields.find(f => f.key === view.collection.primaryField);
    const primaryLabel = primaryFieldDef?.label || 'Title';
    const dueDateFieldDef = view.collection.fields.find(f => f.key === config.dueDateField);
    const dueDateLabel = dueDateFieldDef?.label || 'Due date';

    const otherFields = view.collection.fields.filter(
        field => field.key !== view.collection.primaryField &&
                 field.key !== config.completionField &&
                 field.key !== config.dueDateField
    );

    return <NemotoDialog aria-labelledby="record-details-title" onClose={() => dirty ? setDiscard(true) : onClose()} panelClassName="nemoto-task-details w-full max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden p-5">
        <h2 id="record-details-title" className="mb-4 text-lg font-bold">{capitalizedItemLabel} details</h2>
        <fieldset disabled={!canWrite} className="space-y-3">
            <label className="block text-sm">{primaryLabel}<NemotoInput className="mt-1 w-full" value={String(draft.values[view.collection.primaryField])} maxLength={primaryFieldDef?.maxLength ?? 500} onChange={event => setDraft({ ...draft, values: { ...draft.values, [view.collection.primaryField]: event.target.value } })} /></label>
            <div><p className="mb-2 text-sm">Notes</p><RecordRichTextEditor editable={canWrite} value={draft.details!.description} onChange={description => setDraft(current => ({ ...current, details: { ...current.details!, description } }))} /></div>
            {dueDateFieldDef && (
                <label className="grid gap-1 text-sm">{dueDateLabel}<NemotoInput className="w-full" type="date" value={String(draft.values[config.dueDateField] || '')} onChange={event => setDraft({ ...draft, values: { ...draft.values, [config.dueDateField]: event.target.value } })} /></label>
            )}
            {otherFields.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {otherFields.map(field => (
                        field.type === 'boolean' ? (
                            <label key={field.key} className="flex items-center gap-2 text-sm sm:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={Boolean(draft.values[field.key])}
                                    onChange={event => setDraft({ ...draft, values: { ...draft.values, [field.key]: event.target.checked } })}
                                />
                                <span>{field.label}</span>
                            </label>
                        ) : (
                            <label key={field.key} className="grid gap-1 text-sm">
                                {field.label}
                                <NemotoInput
                                    className="w-full"
                                    type={field.type === 'date' ? 'date' : 'text'}
                                    value={String(draft.values[field.key] ?? '')}
                                    maxLength={field.maxLength}
                                    placeholder={field.placeholder}
                                    onChange={event => setDraft({ ...draft, values: { ...draft.values, [field.key]: event.target.value } })}
                                />
                            </label>
                        )
                    ))}
                </div>
            )}
            <div className="rounded-md border border-app-border/70 bg-app-surface/50 p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 break-words">
                        {context ? (
                            <span>
                                <strong className="font-semibold text-text-main">{context.labelSnapshot}</strong>
                                {context.locationSnapshot ? (
                                    <span className="ml-1 text-text-muted">({context.locationSnapshot})</span>
                                ) : null}
                            </span>
                        ) : draft.details?.context ? (
                            <span className="text-text-muted">
                                Object unavailable: {draft.details.context.labelSnapshot}
                                {draft.details.context.locationSnapshot ? ` (${draft.details.context.locationSnapshot})` : ''}
                            </span>
                        ) : (
                            <span className="text-text-muted">No linked object</span>
                        )}
                    </div>
                    {draft.details?.context && canWrite && (
                        <NemotoButton
                            size="sm"
                            variant="ghost"
                            className="shrink-0 text-xs text-text-muted hover:text-accent-danger"
                            onClick={() => setDraft({ ...draft, details: { ...draft.details!, context: null } })}
                        >
                            Remove link
                        </NemotoButton>
                    )}
                </div>
            </div>
            <div>
                <NemotoInput className="block w-full" aria-label="Find context" placeholder="Find a process or node to link" value={query} maxLength={240} onChange={event => setQuery(event.target.value)} />
                {results.length > 0 && (
                    <ul className="mt-1 max-h-48 overflow-y-auto overflow-x-hidden rounded-lg border border-app-border bg-app-surface divide-y divide-app-border/40 shadow-md" role="listbox">
                        {results.map(result => {
                            const isNode = result.reference.kind === 'core.node';
                            return (
                                <li key={`${result.reference.kind}:${result.reference.id}`} role="option">
                                    <button
                                        type="button"
                                        className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-app-border/20 focus:bg-app-border/30 block break-words"
                                        onClick={() => {
                                             const next = resolveRecordContext(api, result.reference);
                                            if (next) setDraft({ ...draft, details: { ...draft.details!, context: next } });
                                            setQuery('');
                                        }}
                                    >
                                        <span className="font-medium text-text-main">{result.label}</span>
                                        <span className="ml-1.5 text-xs text-text-muted">
                                            ({isNode ? result.context : 'Process'})
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </fieldset>
        <p className="mt-4 text-xs text-text-muted">Created {new Date(item.createdAt).toLocaleString()}{item.details?.completedAt ? ` · Completed ${new Date(item.details.completedAt).toLocaleString()}` : ''}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-4">
            <div className="flex flex-wrap gap-2">
                {context && <NemotoButton disabled={dirty} onClick={() => onOpen(context!)}>Show on canvas</NemotoButton>}
                {canWrite && <NemotoButton disabled={!String(draft.values[view.collection.primaryField]).trim()} onClick={() => onSave(draft)}>Save</NemotoButton>}
                <NemotoButton onClick={() => dirty ? setDiscard(true) : onClose()}>Close</NemotoButton>
            </div>
            {onDelete && canWrite && (
                <NemotoButton variant="danger" onClick={() => setConfirmDelete(true)}>
                    Delete permanently
                </NemotoButton>
            )}
        </div>
        {confirmDelete && (
            <div role="alert" className="mt-4 rounded-lg border border-accent-danger/40 bg-accent-danger/10 p-3 text-sm">
                <p className="font-semibold text-accent-danger">Permanently delete this {itemLabel}? This cannot be undone.</p>
                <div className="mt-2 flex gap-2">
                    <NemotoButton variant="danger" size="sm" onClick={() => { setConfirmDelete(false); onDelete?.(); }}>
                        Confirm delete
                    </NemotoButton>
                    <NemotoButton size="sm" onClick={() => setConfirmDelete(false)}>
                        Cancel
                    </NemotoButton>
                </div>
            </div>
        )}
        {discard && <div role="alert" className="mt-3"><p>Discard unsaved changes?</p><NemotoButton onClick={onClose}>Discard changes</NemotoButton><NemotoButton onClick={() => setDiscard(false)}>Keep editing</NemotoButton></div>}
    </NemotoDialog>;
}
