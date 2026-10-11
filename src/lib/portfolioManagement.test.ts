import { describe, expect, it } from 'vitest';
import type { Portfolio } from '../types';
import { collectReferencedAssetIds, createPortfolioManagementSummary } from './portfolioManagement';

const timestamp = '2026-08-25T00:00:00.000Z';

function createPortfolio(): Portfolio {
    return {
        version: '1.0',
        lastModified: timestamp,
        processes: [{
            id: 'process-1',
            title: 'Service delivery',
            createdAt: timestamp,
            updatedAt: timestamp,
            mode: 'blank',
            ownerId: 'asset-owner',
            graph: {
                nodes: [{
                    id: 'node-1',
                    type: 'action',
                    label: 'Deliver service',
                    position: { x: 0, y: 0 },
                    assetIds: ['asset-used'],
                }],
                edges: [],
                swimlanes: [],
            },
            subGraphs: {},
        }],
        processFolders: [],
        assets: [
            { id: 'asset-used', name: 'Used system', type: 'systems' },
            { id: 'asset-owner', name: 'Process owner', type: 'roles' },
            { id: 'asset-journal', name: 'Journal context', type: 'documents' },
            { id: 'asset-parent', name: 'Parent resource', type: 'systems' },
            { id: 'asset-child', name: 'Child resource', type: 'systems', parentId: 'asset-parent' },
            { id: 'asset-unused', name: 'Unused resource', type: 'systems' },
        ],
        assetCategories: [
            { id: 'systems', label: 'Systems', icon: 'Box', color: 'blue' },
            { id: 'roles', label: 'Roles', icon: 'User', color: 'green' },
            { id: 'documents', label: 'Documents', icon: 'FileText', color: 'gray' },
        ],
        incidents: [],
        journal: {
            notebooks: [
                { id: 'notebook-used', title: 'Used notebook', createdAt: timestamp, updatedAt: timestamp },
                { id: 'notebook-empty', title: 'Empty notebook', createdAt: timestamp, updatedAt: timestamp },
            ],
            folders: [],
            tags: [],
            entries: [
                {
                    id: 'entry-linked',
                    notebookId: 'notebook-used',
                    title: 'Linked note',
                    content: '<p>Linked</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [{ id: 'asset-journal', type: 'asset' }],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                {
                    id: 'entry-unlinked',
                    notebookId: 'notebook-used',
                    title: 'Unlinked note',
                    content: '<p>Unlinked</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            ],
        },
    };
}

describe('portfolio management summary', () => {
    it('treats process, journal, ownership, and hierarchy references as resource usage', () => {
        expect([...collectReferencedAssetIds(createPortfolio())].sort()).toEqual([
            'asset-journal',
            'asset-owner',
            'asset-parent',
            'asset-used',
        ]);
    });

    it('summarizes content and only actionable attention groups', () => {
        const summary = createPortfolioManagementSummary(createPortfolio());

        expect(summary.counts).toEqual({
            processes: 1,
            assets: 6,
            journalEntries: 2,
            notebooks: 2,
        });
        expect(summary.attention.unusedAssetIds).toEqual(['asset-child', 'asset-unused']);
        expect(summary.attention.unlinkedJournalEntryIds).toEqual(['entry-unlinked']);
        expect(summary.attention.emptyNotebookIds).toEqual(['notebook-empty']);
        expect(summary.attention.integrityIssues).toEqual([]);
        expect(summary.attention.total).toBe(4);
    });
});
