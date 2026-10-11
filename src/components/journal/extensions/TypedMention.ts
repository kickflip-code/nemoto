import Mention from '@tiptap/extension-mention';

function parsePath(value: string | null): string[] | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter(part => typeof part === 'string') : null;
    } catch {
        return value.split('/').filter(Boolean);
    }
}

/**
 * TipTap mention node with stable entity metadata. The legacy attributes are
 * accepted on parse so existing journal HTML upgrades on its next round-trip.
 */
const TypedMention = Mention.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            id: {
                default: null,
                parseHTML: element => element.getAttribute('data-entity-id')
                    || element.getAttribute('data-id')
                    || element.getAttribute('data-mention-id'),
                renderHTML: attributes => attributes.id ? { 'data-id': attributes.id } : {},
            },
            label: {
                default: null,
                parseHTML: element => element.getAttribute('data-label')
                    || element.textContent?.replace(/^@/, '')
                    || null,
                renderHTML: attributes => attributes.label ? { 'data-label': attributes.label } : {},
            },
            entityType: {
                default: null,
                parseHTML: element => element.getAttribute('data-entity-type')
                    || element.getAttribute('data-mention-type'),
                renderHTML: attributes => attributes.entityType
                    ? { 'data-entity-type': attributes.entityType }
                    : {},
            },
            processId: {
                default: null,
                parseHTML: element => element.getAttribute('data-process-id'),
                renderHTML: attributes => attributes.processId
                    ? { 'data-process-id': attributes.processId }
                    : {},
            },
            path: {
                default: null,
                parseHTML: element => parsePath(element.getAttribute('data-entity-path')),
                renderHTML: attributes => attributes.path
                    ? { 'data-entity-path': JSON.stringify(attributes.path) }
                    : {},
            },
        };
    },
});

export default TypedMention;
