import type { Portfolio } from '../types';
import { generateId } from '../lib/id';
import { createEmptyPluginDataEnvelope, MAX_PLUGIN_DATA_BYTES, PluginDataEnvelopeSchema } from './collectionStorage';
import { createEmptyPortfolioPluginState } from './portfolioData';
import { isPortableRecord, PortablePluginRecordSchema } from './portableRecords';
import { doesUniversalReferenceResolve } from './portfolioDataIntegrity';
import { findGraphEntityLocation, graphLocationHint } from './graphLocations';
import type { UniversalEntityReference } from './universalReference';

export interface PluginImportReviewRow {
    pluginId: string;
    recordId: string;
    role: string;
    oldTarget: string;
    destination: string;
    status: 'mapped' | 'unresolved' | 'unlinked' | 'excluded';
}
export type ReferenceImportMaps = ReadonlyMap<string, ReadonlyMap<string, string>>;

export function remapPortableReference(reference: UniversalEntityReference, source: Portfolio,
    target: Portfolio, maps: ReferenceImportMaps): UniversalEntityReference | null {
    // Even an ID present in the target is not a mapping from the source.
    if (!doesUniversalReferenceResolve(reference, source)) return null;
    const id = maps.get(reference.kind)?.get(reference.id);
    if (!id) return null;
    const next: UniversalEntityReference = { ...reference, id };
    delete next.location;
    if (reference.kind === 'core.node' || reference.kind === 'core.edge' || reference.kind === 'core.swimlane') {
        const located = findGraphEntityLocation(target, reference.kind, id);
        if (!located) return null;
        next.location = graphLocationHint(located);
    }
    if (!doesUniversalReferenceResolve(next, target)) return null;
    return next;
}

/** Copies only explicitly recognized records. Every unsupported document is reported. */
export function mergePortableRecordDocuments(target: Portfolio, source: Portfolio, maps: ReferenceImportMaps,
    rows: PluginImportReviewRow[]): Portfolio {
    const next = { ...target, extensions: { ...target.extensions },
        plugins: structuredClone(target.plugins ?? createEmptyPortfolioPluginState()) };
    for (const value of [...(source.plugins?.semanticData.records ?? []),
        ...(source.plugins?.semanticData.relations ?? []), ...(source.plugins?.semanticData.annotations ?? [])]) {
        rows.push({ pluginId: value.owner.pluginId, recordId: value.id, role: 'Semantic data',
            oldTarget: value.type, destination: 'Retained in source file; no copy adapter', status: 'excluded' });
    }
    for (const [pluginId, raw] of Object.entries(source.extensions ?? {})) {
        const parsed = PluginDataEnvelopeSchema.safeParse(raw);
        if (!parsed.success) {
            rows.push({ pluginId, recordId: 'namespace', role: 'Unsupported data', oldTarget: 'Unknown envelope', destination: 'Retained in source file', status: 'excluded' });
            continue;
        }
        const seen = new Set<string>();
        for (const [key, collection] of Object.entries(parsed.data.collections)) {
            for (const item of collection.items) {
                if (!item.details) rows.push({ pluginId, recordId: item.id, role: key,
                    oldTarget: 'Collection without a portable reference contract', destination: 'Retained in source file', status: 'excluded' });
            }
        }
        for (const [key, document] of Object.entries(parsed.data.documents)) {
            const record = isPortableRecord(document.value) ? PortablePluginRecordSchema.safeParse(document.value) : null;
            if (!record?.success) {
                rows.push({ pluginId, recordId: key, role: 'Unsupported document', oldTarget: 'Opaque or unsupported record', destination: 'Retained in source file', status: 'excluded' });
                continue;
            }
            if (seen.has(record.data.id)) throw new Error('Duplicate portable record IDs. Nothing was imported.');
            seen.add(record.data.id);
            const requirement = source.plugins?.requirements.find(value => value.pluginId === pluginId);
            if (!requirement) throw new Error('Portable records have no plugin version requirement.');
            const existingRequirement = next.plugins.requirements.find(value => value.pluginId === pluginId);
            if (existingRequirement && (existingRequirement.version !== requirement.version || existingRequirement.dataVersion !== requirement.dataVersion)) {
                throw new Error('Plugin versions differ. Import into a separate Portfolio or align versions first.');
            }
            const envelope = next.extensions[pluginId] === undefined
                ? createEmptyPluginDataEnvelope() : PluginDataEnvelopeSchema.parse(next.extensions[pluginId]);
            const id = generateId('record');
            for (const existing of Object.values(envelope.documents)) {
                const parsedExisting = PortablePluginRecordSchema.safeParse(existing.value);
                if (parsedExisting.success && parsedExisting.data.id === id) throw new Error('Imported record ID collision. Nothing was imported.');
            }
            const references = record.data.references.map(slot => {
                const reference = slot.reference ? remapPortableReference(slot.reference, source, next, maps) : null;
                rows.push({ pluginId, recordId: record.data.id, role: slot.role,
                    oldTarget: slot.reference ? `${slot.fallbackLabel} (${slot.reference.kind}/${slot.reference.id})` : slot.fallbackLabel || 'Unlinked',
                    destination: reference ? `${reference.kind}/${reference.id}` : 'Unlinked; fallback label preserved',
                    status: reference ? 'mapped' : slot.reference ? 'unresolved' : 'unlinked' });
                return { ...slot, reference };
            });
            if (!references.length) rows.push({ pluginId, recordId: record.data.id, role: 'Record', oldTarget: 'Unlinked', destination: id, status: 'unlinked' });
            // Copied documents get a fresh address as well as a fresh record identity.
            const destinationKey = `records/${id}`;
            if (Object.prototype.hasOwnProperty.call(envelope.documents, destinationKey)) throw new Error('Imported record ID collision. Nothing was imported.');
            envelope.documents[destinationKey] = { documentVersion: 1, value: { ...record.data, id, references } };
            PluginDataEnvelopeSchema.parse(envelope);
            if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_PLUGIN_DATA_BYTES) throw new Error('Imported records exceed plugin storage capacity. Nothing was imported.');
            next.extensions[pluginId] = envelope;
            if (!existingRequirement) next.plugins.requirements.push({ ...requirement, activation: 'inactive', requirement: 'recommended' });
        }
    }
    return next;
}
