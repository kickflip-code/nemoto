import type { PluginCollectionItem } from './collectionStorage';
import type { PluginCollectionListView } from './contributionSchemas';
import type { RecordContext, RecordRichText } from './contextualRecords';

export function descriptionAsText(node: RecordRichText): string {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    const separator = node.type === 'paragraph' ? '' : '\n';
    const text = (node.content ?? []).map(descriptionAsText).join(separator);
    return node.type === 'listItem' ? `• ${text}` : text;
}

/** Calendar filters use the same local day displayed in the archive. */
export function completionDay(item: PluginCollectionItem): string {
    if (!item.details?.completedAt) return '';
    const date = new Date(item.details.completedAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createRecordReport(view: PluginCollectionListView, items: PluginCollectionItem[], contexts: Map<string, RecordContext | null>): string {
    const itemLabel = view.collection.itemLabel || 'item';
    const dueDateLabel = view.collection.fields.find(f => f.key === view.contextual!.dueDateField)?.label || 'Due date';
    const otherFields = view.collection.fields.filter(field =>
        field.key !== view.collection.primaryField &&
        field.key !== view.contextual!.completionField &&
        field.key !== view.contextual!.dueDateField
    );
    const records = items.map((item, index) => {
        const context = contexts.get(item.id) ?? item.details?.context;
        const extraFields = otherFields
            .map(field => {
                const val = item.values[field.key];
                return val !== undefined && val !== '' ? `${field.label}: ${val}` : '';
            })
            .filter(Boolean);
        return [
            `${index + 1}. ${item.values[view.collection.primaryField]}`,
            `Status: ${item.values[view.contextual!.completionField] ? 'Completed' : 'Open'}`,
            `Created: ${item.createdAt}`,
            item.details?.completedAt ? `Completed: ${item.details.completedAt}` : '',
            item.values[view.contextual!.dueDateField] ? `${dueDateLabel}: ${item.values[view.contextual!.dueDateField]}` : '',
            ...extraFields,
            context ? `Context: ${context.locationSnapshot} / ${context.labelSnapshot}${contexts.get(item.id) ? '' : ' (object unavailable)'}` : 'Context: No linked object',
            item.details ? descriptionAsText(item.details.description).trim() : '',
        ].filter(Boolean).join('\n');
    });
    return `${view.content.title} — ${items.length} ${itemLabel}s\nDates with Z are UTC.\n\n${records.join('\n\n')}\n`;
}
