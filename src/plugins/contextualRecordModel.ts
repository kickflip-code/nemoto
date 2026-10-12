import type { PluginCollectionListView } from './contributionSchemas';
import type { PluginCollectionItem } from './collectionStorage';
import { emptyRecordDescription, type RecordContext } from './contextualRecords';
import type { NemotoPluginApi } from './publicApi';
import { coreEntityReference, type UniversalEntityReference } from './universalReference';

export function resolveRecordContext(api: NemotoPluginApi, reference: UniversalEntityReference): RecordContext | null {
    const entity = api.read.getEntity(reference);
    if (!entity) return null;
    const ref = entity.reference;
    const processId = ref.kind === 'core.process' ? ref.id : ref.location?.processId;
    const process = processId ? api.read.getEntity(coreEntityReference('core.process', processId)) : null;
    const path = (ref.location?.graphPath ?? []).map(id => api.read.getEntity(coreEntityReference('core.node', id, { processId: processId! }))?.label).filter(Boolean);
    return { reference: ref, labelSnapshot: entity.label, locationSnapshot: [process?.label, ...path].filter(Boolean).join(' / ') };
}

export function createContextualItem(view: PluginCollectionListView, title: string, context: RecordContext | null): PluginCollectionItem {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), createdAt: now, updatedAt: now,
        values: Object.fromEntries(view.collection.fields.map(field => [
            field.key,
            field.key === view.collection.primaryField
                ? title.trim()
                : field.type === 'boolean'
                    ? false
                    : field.required
                        ? field.placeholder || '1'
                        : ''
        ])),
        details: { schemaVersion: 1, context, description: emptyRecordDescription(), completedAt: null } };
}
