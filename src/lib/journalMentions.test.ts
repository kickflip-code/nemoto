import { describe, expect, it } from 'vitest';
import type { Portfolio } from '../types';
import type { EntityReference } from '../types/journal';
import { createEntityResolverIndex } from './entityResolver';
import {
    buildMentionHtml,
    getMentionHtmlAttributes,
    mentionAttributesToReference,
    normalizeJournalMentions,
    reconcileLinkedContext,
} from './journalMentions';

const portfolio: Portfolio = {
    version: '1',
    lastModified: '2026-01-01T00:00:00.000Z',
    processes: [{
        id: 'process-1',
        title: 'Incident Response',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mode: 'blank',
        graph: {
            nodes: [{ id: 'step-1', type: 'action', label: 'Triage', position: { x: 0, y: 0 } }],
            edges: [],
            swimlanes: [],
        },
    }],
    processFolders: [],
    assets: [{ id: 'asset-1', name: 'Support Laptop', type: 'hardware' }],
    assetCategories: [{ id: 'hardware', label: 'Hardware', icon: 'Laptop', color: 'blue' }],
    incidents: [],
    journal: { notebooks: [], folders: [], entries: [], tags: [] },
};

describe('typed journal mentions', () => {
    it('upgrades a legacy subprocess reference using the actual portfolio', () => {
        expect(mentionAttributesToReference({
            id: 'step-1',
            entityType: 'subprocess',
            processId: 'process-1',
        }, portfolio)).toEqual({
            id: 'step-1',
            type: 'node',
            processId: 'process-1',
            path: ['step-1'],
            source: 'inline',
        });
    });

    it('serializes stable typed metadata and escapes labels', () => {
        const reference: EntityReference = { id: 'asset-1', type: 'asset' };
        const attributes = getMentionHtmlAttributes(reference, 'Laptop');

        expect(attributes['data-entity-type']).toBe('asset');
        expect(attributes['data-mention-type']).toBe('resource');
        expect(buildMentionHtml(reference, '<Laptop & Dock>')).toContain('@&lt;Laptop &amp; Dock&gt;');
    });

    it('refreshes resolved labels and marks missing references as dangling', () => {
        const result = normalizeJournalMentions(`
            <p><span class="mention" data-type="mention" data-id="process-1" data-entity-type="process">@Old name</span></p>
            <p><span class="mention" data-type="mention" data-id="asset-missing" data-entity-type="asset">@Missing asset</span></p>
        `, portfolio);
        const body = new DOMParser().parseFromString(result.content, 'text/html').body;

        expect(body.querySelector('[data-id="process-1"]')?.textContent).toBe('@Incident Response');
        expect(body.querySelector('[data-id="asset-missing"]')?.classList.contains('mention-dangling')).toBe(true);
        expect(result.inlineReferences).toHaveLength(2);
    });

    it('preserves content without mentions without parsing it', () => {
        const content = '<p>Plain journal content</p>';
        expect(normalizeJournalMentions(content, portfolio)).toEqual({
            content,
            inlineReferences: [],
        });
    });

    it('uses a shared resolver index while normalizing inline references', () => {
        const index = createEntityResolverIndex(portfolio);
        const result = normalizeJournalMentions(
            `<p><span class='mention' data-id='step-1' data-entity-type='node'>@Old</span></p>`,
            portfolio,
            index,
        );

        expect(result.inlineReferences).toEqual([
            expect.objectContaining({ id: 'step-1', type: 'node', processId: 'process-1' }),
        ]);
        expect(result.content).toContain('@Triage');
    });

    it('keeps manual links while replacing stale inline context', () => {
        const reconciled = reconcileLinkedContext([
            { id: 'asset-1', type: 'asset', source: 'manual' },
            { id: 'old-inline', type: 'asset', source: 'inline' },
        ], [
            { id: 'process-1', type: 'process', source: 'inline' },
        ], portfolio);

        expect(reconciled).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'asset-1', source: 'manual' }),
            expect.objectContaining({ id: 'process-1', type: 'process', source: 'inline' }),
        ]));
        expect(reconciled.some(reference => reference.id === 'old-inline')).toBe(false);
    });
});
