import type { Portfolio } from '../types';
import { PluginDataEnvelopeSchema, createEmptyPluginDataEnvelope, MAX_PLUGIN_DATA_BYTES, type PluginCollectionItem } from './collectionStorage';
import { createEmptyPortfolioPluginState } from './portfolioData';
import { findGraphEntityLocation, graphLocationHint } from './graphLocations';
import { generateId } from '../lib/id';
import type { PluginImportReviewRow } from './portableRecordImport';

function readPortableEnvelope(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !('schema' in raw) || raw.schema !== 'axiom.plugin-data') return null;
    const parsed = PluginDataEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Plugin data is invalid or newer than this Nemoto version. Use a compatible build; no records were transferred.');
    return parsed.data;
}

/** Explicit sharing allowlist: only recognized contextual records, never documents. */
export function projectContextualRecords(source: Portfolio, processId: string, includedNodeIds: ReadonlySet<string>, reviewedFullMerge = false): Pick<Portfolio, 'plugins' | 'extensions'> {
    const extensions: NonNullable<Portfolio['extensions']> = {};
    const requirements: NonNullable<Portfolio['plugins']>['requirements'] = [];
    for (const [pluginId, raw] of Object.entries(source.extensions ?? {})) {
        const parsed = readPortableEnvelope(raw);
        if (!parsed) {
            if (!reviewedFullMerge) throw new Error('Unsupported plugin data cannot be projected. Save a full Portfolio to preserve it.');
            continue;
        }
        if (!reviewedFullMerge && Object.keys(parsed.documents).length) throw new Error('Plugin documents cannot be projected into a process fragment. Save a full Portfolio and use Merge content to review them.');
        const envelope = createEmptyPluginDataEnvelope();
        for (const [collectionId, collection] of Object.entries(parsed.collections)) {
            const items = collection.items.flatMap(item => {
                const ref = item.details?.context?.reference;
                if (!ref) return [];
                if (ref.kind === 'core.process' && ref.id === processId) return [structuredClone(item)];
                if (ref.kind !== 'core.node' || !includedNodeIds.has(ref.id)) return [];
                const location = findGraphEntityLocation(source, 'core.node', ref.id, ref.location?.processId);
                if (!location || location.process.id !== processId) return [];
                return [{ ...structuredClone(item), details: { ...structuredClone(item.details!), context: { ...item.details!.context!, reference: { ...ref, location: graphLocationHint(location) } } } }];
            });
            if (items.length) envelope.collections[collectionId] = { items };
        }
        if (!Object.keys(envelope.collections).length) continue;
        const requirement = source.plugins?.requirements.find(value => value.pluginId === pluginId);
        if (!requirement) throw new Error('Linked plugin records have no version requirement; export a full Portfolio to preserve them.');
        requirements.push({ ...requirement, activation: 'inactive', requirement: 'recommended' });
        extensions[pluginId] = envelope;
    }
    return requirements.length ? { extensions, plugins: { ...createEmptyPortfolioPluginState(), requirements } } : {};
}

/** Import is a copy, like process import: fresh record IDs and remapped context. */
export function mergeContextualRecords(target: Portfolio, source: Portfolio, processId: string, newProcessId: string, nodeIds: ReadonlyMap<string, string>, rows?: PluginImportReviewRow[]): Portfolio {
    const projected = projectContextualRecords(source, processId, new Set(nodeIds.keys()), true);
    return mergeProjection(target, projected, item => {
        const context = item.details!.context!;
        const ref = context.reference;
        const id = ref.kind === 'core.process' ? newProcessId : nodeIds.get(ref.id)!;
        const location = ref.kind === 'core.node' ? findGraphEntityLocation(target, 'core.node', id, newProcessId) : null;
        return { ...item, details: { ...item.details!, context: { ...context, reference: { ...ref, id, ...(location ? { location: graphLocationHint(location) } : {}) } } } };
    }, rows);
}

/** Full Portfolio merge also preserves unlinked records and unresolved targets. */
export function mergeDetachedContextualRecords(target: Portfolio, source: Portfolio, processIds: ReadonlyMap<string, string>, nodeIds: ReadonlyMap<string, string>, rows?: PluginImportReviewRow[]): Portfolio {
    const projected: Pick<Portfolio, 'extensions' | 'plugins'> = { extensions: {}, plugins: createEmptyPortfolioPluginState() };
    for (const [pluginId, raw] of Object.entries(source.extensions ?? {})) {
        const parsed = readPortableEnvelope(raw);
        if (!parsed) continue;
        const envelope = createEmptyPluginDataEnvelope();
        for (const [key, collection] of Object.entries(parsed.collections)) {
            const items = collection.items.filter(item => {
                if (!item.details) return false;
                const ref = item.details.context?.reference;
                return !ref || !(ref.kind === 'core.node' ? nodeIds.has(ref.id) : processIds.has(ref.id));
            });
            if (items.length) envelope.collections[key] = { items: structuredClone(items) };
        }
        if (!Object.keys(envelope.collections).length) continue;
        const requirement = source.plugins?.requirements.find(value => value.pluginId === pluginId);
        if (!requirement) throw new Error('Contextual records have no plugin version requirement.');
        projected.extensions![pluginId] = envelope;
        projected.plugins!.requirements.push({ ...requirement, activation: 'inactive', requirement: 'recommended' });
    }
    return mergeProjection(target, projected, item => {
        const context = item.details!.context;
        if (!context) return item;
        // A missing source ID must not accidentally resolve to an unrelated target object.
        const reference = { ...context.reference, id: generateId('missing-context') };
        if (reference.kind === 'core.node') reference.location = { processId: processIds.get(reference.location!.processId!) ?? generateId('missing-process') };
        return { ...item, details: { ...item.details!, context: { ...context, reference } } };
    }, rows);
}

function mergeProjection(target: Portfolio, projected: Pick<Portfolio, 'plugins' | 'extensions'>, remap: (item: PluginCollectionItem) => PluginCollectionItem, rows?: PluginImportReviewRow[]): Portfolio {
    if (!projected.extensions) return target;
    const next = { ...target, extensions: { ...target.extensions }, plugins: structuredClone(target.plugins ?? createEmptyPortfolioPluginState()) };
    for (const [pluginId, raw] of Object.entries(projected.extensions)) {
        const incoming = PluginDataEnvelopeSchema.parse(raw);
        const requirement = projected.plugins!.requirements.find(value => value.pluginId === pluginId)!;
        const existingRequirement = next.plugins.requirements.find(value => value.pluginId === pluginId);
        if (existingRequirement && (existingRequirement.dataVersion !== requirement.dataVersion || existingRequirement.version !== requirement.version)) throw new Error('Plugin versions differ. Import into a separate Portfolio or align compatible versions first.');
        const existing = next.extensions[pluginId] === undefined ? createEmptyPluginDataEnvelope() : PluginDataEnvelopeSchema.parse(next.extensions[pluginId]);
        for (const [key, collection] of Object.entries(incoming.collections)) {
            const items = collection.items.map(item => {
                const next = { ...remap(item), id: generateId('record') };
                const oldReference = item.details?.context?.reference;
                const reference = next.details?.context?.reference;
                const unresolved = reference?.id.startsWith('missing-context');
                rows?.push({ pluginId, recordId: item.id, role: 'Context',
                    oldTarget: oldReference ? `${oldReference.kind}/${oldReference.id}` : 'Unlinked',
                    destination: reference ? `${reference.kind}/${reference.id}` : 'Unlinked',
                    status: unresolved ? 'unresolved' : reference ? 'mapped' : 'unlinked' });
                return next;
            });
            existing.collections[key] = { items: [...(existing.collections[key]?.items ?? []), ...items] };
        }
        PluginDataEnvelopeSchema.parse(existing);
        if (new TextEncoder().encode(JSON.stringify(existing)).byteLength > MAX_PLUGIN_DATA_BYTES) throw new Error('Imported records exceed plugin storage capacity. Nothing was imported.');
        next.extensions[pluginId] = existing;
        if (!existingRequirement) next.plugins.requirements.push(requirement);
    }
    return next;
}
