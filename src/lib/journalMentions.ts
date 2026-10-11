import type { Portfolio } from '../types';
import type { EntityReference } from '../types/journal';
import { escapeHtml } from './sanitize';
import {
    normalizeEntityReference,
    resolveEntityReference,
} from './entityResolver';
import type { EntityResolverIndex } from './entityResolver';

export interface MentionAttributes {
    id: string | null;
    label?: string | null;
    entityType?: string | null;
    processId?: string | null;
    path?: string[] | string | null;
}

const INLINE_MENTION_PATTERN = /<span\b[^>]*(?:data-type\s*=\s*["']mention["']|class\s*=\s*["'][^"']*\bmention\b)/i;

function parsePath(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const path = value.filter((part): part is string => typeof part === 'string' && part.length > 0);
        return path.length > 0 ? path : [];
    }
    if (typeof value !== 'string' || value.length === 0) return undefined;

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.filter((part): part is string => typeof part === 'string' && part.length > 0);
        }
    } catch {
        return value.split('/').filter(Boolean);
    }

    return undefined;
}

export function mentionAttributesToReference(
    attributes: MentionAttributes,
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): EntityReference | null {
    if (!attributes.id) return null;

    return normalizeEntityReference({
        id: attributes.id,
        type: attributes.entityType || undefined,
        processId: attributes.processId || undefined,
        path: parsePath(attributes.path),
        source: 'inline',
    }, portfolio, index);
}

export function mentionElementToReference(
    element: HTMLElement,
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): EntityReference | null {
    return mentionAttributesToReference({
        id: element.dataset.entityId || element.dataset.id || element.dataset.mentionId || null,
        label: element.dataset.label || null,
        entityType: element.dataset.entityType || element.dataset.mentionType || null,
        processId: element.dataset.processId || null,
        path: element.dataset.entityPath || null,
    }, portfolio, index);
}

export function referenceToMentionAttributes(
    reference: EntityReference,
    label?: string,
): MentionAttributes {
    return {
        id: reference.id,
        label,
        entityType: reference.type,
        processId: reference.processId,
        path: reference.path,
    };
}

export function getMentionHtmlAttributes(
    reference: EntityReference,
    label: string,
): Record<string, string> {
    const attributes: Record<string, string> = {
        'data-type': 'mention',
        'data-id': reference.id,
        'data-label': label,
        'data-entity-id': reference.id,
        'data-entity-type': reference.type,
        // Retain the old attributes for portfolios exported by earlier builds.
        'data-mention-id': reference.id,
        'data-mention-type': reference.type === 'asset' ? 'resource' : reference.type === 'node' ? 'subprocess' : reference.type,
    };

    if (reference.processId) attributes['data-process-id'] = reference.processId;
    if (reference.path) attributes['data-entity-path'] = JSON.stringify(reference.path);

    return attributes;
}

export function buildMentionHtml(reference: EntityReference, label: string): string {
    const attributes = getMentionHtmlAttributes(reference, label);
    const serializedAttributes = Object.entries(attributes)
        .map(([name, value]) => `${name}="${escapeHtml(value)}"`)
        .join(' ');

    return `<span class="mention" ${serializedAttributes}>@${escapeHtml(label)}</span>`;
}

function referenceKey(reference: Pick<EntityReference, 'id' | 'type'>): string {
    return `${reference.type}:${reference.id}`;
}

function normalizeExistingReference(
    reference: EntityReference | string,
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): EntityReference {
    if (typeof reference === 'string') {
        return normalizeEntityReference({ id: reference, source: 'manual' }, portfolio, index);
    }

    return normalizeEntityReference({
        ...reference,
        source: reference.source || 'manual',
    }, portfolio, index);
}

/**
 * Upgrade legacy mention attributes, refresh labels through the shared
 * resolver, and make dangling references explicit in the stored HTML.
 */
export function normalizeJournalMentions(
    content: string,
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): { content: string; inlineReferences: EntityReference[] } {
    if (!content || typeof DOMParser === 'undefined') {
        return { content, inlineReferences: [] };
    }
    if (!INLINE_MENTION_PATTERN.test(content)) {
        return { content, inlineReferences: [] };
    }

    const document = new DOMParser().parseFromString(content, 'text/html');
    const mentions = document.body.querySelectorAll<HTMLElement>('span[data-type="mention"], span.mention');
    const references = new Map<string, EntityReference>();

    mentions.forEach(element => {
        const reference = mentionElementToReference(element, portfolio, index);
        if (!reference) return;

        const resolved = resolveEntityReference(reference, portfolio, index);
        const storedLabel = element.dataset.label || element.textContent?.replace(/^@/, '') || reference.id;
        const label = resolved?.displayName || storedLabel;
        const attributes = getMentionHtmlAttributes(reference, label);

        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
        element.classList.add('mention');
        element.textContent = `@${label}`;

        if (resolved) {
            element.classList.remove('mention-dangling');
            element.removeAttribute('data-dangling');
        } else {
            element.classList.add('mention-dangling');
            element.setAttribute('data-dangling', 'true');
        }

        references.set(referenceKey(reference), { ...reference, source: 'inline' });
    });

    return {
        content: document.body.innerHTML,
        inlineReferences: Array.from(references.values()),
    };
}

/**
 * Inline mentions are authoritative for matching references. Legacy and
 * sidebar-created references are manual; inline references are replaced on
 * every content update and therefore disappear when their mention is removed.
 */
export function reconcileLinkedContext(
    existing: Array<EntityReference | string> | null | undefined,
    inlineReferences: EntityReference[],
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): EntityReference[] {
    const reconciled = new Map<string, EntityReference>();

    (existing || [])
        .map(reference => normalizeExistingReference(reference, portfolio, index))
        .filter(reference => reference.source !== 'inline')
        .forEach(reference => reconciled.set(referenceKey(reference), reference));

    inlineReferences.forEach(reference => {
        const normalized = normalizeEntityReference({ ...reference, source: 'inline' }, portfolio, index);
        reconciled.set(referenceKey(normalized), normalized);
    });

    return Array.from(reconciled.values());
}
