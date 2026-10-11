import { describe, expect, it } from 'vitest';
import { createEmptyPortfolioPluginState } from '../plugins/portfolioData';
import type { Portfolio } from '../types';
import { createSharedProcessProjection } from './shareablePortfolio';

const timestamp = '2026-09-03T00:00:00.000Z';

function portfolioFixture(): Portfolio {
    return {
        schemaVersion: 2,
        version: '1.0.0',
        lastModified: timestamp,
        processes: [{
            id: 'process-1',
            title: 'Shared process',
            description: 'Visible process description',
            createdAt: timestamp,
            updatedAt: timestamp,
            mode: 'blank',
            graph: {
                nodes: [{
                    id: 'node-1',
                    type: 'action',
                    label: 'Visible node',
                    position: { x: 10, y: 20 },
                    assetIds: ['asset-1'],
                    subGraphId: 'sg-live',
                    data: {
                        description: 'Visible node description',
                        privatePluginDraft: 'NODE_DATA_SECRET',
                    },
                    extensions: { plugin: 'NODE_EXTENSION_SECRET' },
                }],
                edges: [],
                swimlanes: [],
                mode: 'blank',
                extensions: { plugin: 'GRAPH_EXTENSION_SECRET' },
            },
            subGraphs: {
                'sg-live': {
                    nodes: [{
                        id: 'child-node',
                        type: 'action',
                        label: 'Visible child',
                        position: { x: 0, y: 0 },
                    }],
                    edges: [],
                    swimlanes: [],
                    mode: 'blank',
                },
                'sg-detached': {
                    nodes: [{
                        id: 'detached-node',
                        type: 'action',
                        label: 'DETACHED_GRAPH_SECRET',
                        position: { x: 0, y: 0 },
                    }],
                    edges: [],
                    swimlanes: [],
                    mode: 'blank',
                },
            },
            extensions: { plugin: 'PROCESS_EXTENSION_SECRET' },
        }],
        processFolders: [{ id: 'folder-secret', title: 'PROCESS_FOLDER_SECRET' }],
        assets: [
            {
                id: 'asset-1',
                name: 'Visible resource',
                type: 'category-1',
                metadata: { Owner: 'Visible owner' },
                extensions: { plugin: 'ASSET_EXTENSION_SECRET' },
            },
            {
                id: 'asset-secret',
                name: 'UNRELATED_ASSET_SECRET',
                type: 'category-secret',
            },
        ],
        assetCategories: [
            {
                id: 'category-1',
                label: 'Visible category',
                icon: 'Box',
                color: 'blue',
                baseType: 'hardware',
                extensions: { plugin: 'CATEGORY_EXTENSION_SECRET' },
            },
            {
                id: 'category-secret',
                label: 'UNRELATED_CATEGORY_SECRET',
                icon: 'Box',
                color: 'red',
            },
        ],
        incidents: [{
            id: 'incident-secret',
            title: 'INCIDENT_SECRET',
            createdAt: timestamp,
            findings: [],
        }],
        journal: {
            notebooks: [{
                id: 'notebook-1',
                title: 'Visible notebook',
                folderId: 'journal-folder-1',
                createdAt: timestamp,
                updatedAt: timestamp,
                extensions: { plugin: 'NOTEBOOK_EXTENSION_SECRET' },
            }],
            folders: [{
                id: 'journal-folder-1',
                title: 'Visible journal folder',
                createdAt: timestamp,
                extensions: { plugin: 'FOLDER_EXTENSION_SECRET' },
            }],
            tags: [
                { id: 'tag-1', label: 'Visible tag', color: 'blue', extensions: { plugin: 'TAG_EXTENSION_SECRET' } },
                { id: 'tag-secret', label: 'INTERNAL_TAG_SECRET', color: 'red' },
            ],
            entries: [
                {
                    id: 'entry-shareable',
                    notebookId: 'notebook-1',
                    title: 'Visible note',
                    content: '<p>Visible note content</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: ['tag-1'],
                    linkedContext: [
                        { id: 'node-1', type: 'node', processId: 'process-1' },
                        { id: 'other-process', type: 'process' },
                    ],
                    sharePolicy: 'shareable',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    extensions: { plugin: 'ENTRY_EXTENSION_SECRET' },
                },
                {
                    id: 'entry-internal',
                    notebookId: 'notebook-1',
                    title: 'INTERNAL_NOTE_SECRET',
                    content: '<p>INTERNAL_CONTENT_SECRET</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: ['tag-secret'],
                    linkedContext: [{ id: 'process-1', type: 'process' }],
                    sharePolicy: 'internal',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                {
                    id: 'entry-unrelated',
                    notebookId: 'notebook-1',
                    title: 'UNRELATED_NOTE_SECRET',
                    content: '<p>Not linked to the exported process</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [{ id: 'other-process', type: 'process' }],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            ],
            extensions: { plugin: 'JOURNAL_EXTENSION_SECRET' },
        },
        customThemes: [
            {
                id: 'theme-active',
                label: 'Visible theme',
                colors: { '--color-app-bg': '#fff' },
                extensions: { plugin: 'THEME_EXTENSION_SECRET' },
            },
            {
                id: 'theme-secret',
                label: 'UNRELATED_THEME_SECRET',
                colors: { '--color-app-bg': '#000' },
            },
        ],
        activeThemeId: 'theme-active',
        plugins: createEmptyPortfolioPluginState(),
        extensions: { plugin: 'PORTFOLIO_EXTENSION_SECRET' },
    };
}

describe('shared process projection', () => {
    it('includes only reachable, explicitly supported, shareable data', () => {
        const result = createSharedProcessProjection(portfolioFixture(), 'process-1', true);
        const serialized = JSON.stringify(result.portfolio);

        expect(result.summary).toEqual({
            includedAssets: 1,
            includedJournalEntries: 1,
            excludedInternalJournalEntries: 1,
        });
        expect(result.portfolio.journal.entries.map(entry => entry.id)).toEqual(['entry-shareable']);
        expect(result.portfolio.journal.entries[0].linkedContext).toEqual([
            { id: 'node-1', type: 'node', processId: 'process-1' },
        ]);
        expect(Object.keys(result.portfolio.processes[0].subGraphs || {})).toEqual(['sg-live']);
        expect(result.portfolio.processes[0].graph.nodes[0].data).toEqual({
            description: 'Visible node description',
        });
        expect(result.portfolio.assets[0].metadata).toEqual({ Owner: 'Visible owner' });
        expect(result.portfolio.customThemes).toEqual([]);
        expect(result.portfolio.plugins).toBeUndefined();
        expect(result.portfolio.extensions).toBeUndefined();

        [
            'INTERNAL_NOTE_SECRET',
            'INTERNAL_CONTENT_SECRET',
            'UNRELATED_NOTE_SECRET',
            'UNRELATED_ASSET_SECRET',
            'UNRELATED_CATEGORY_SECRET',
            'DETACHED_GRAPH_SECRET',
            'NODE_DATA_SECRET',
            'NODE_EXTENSION_SECRET',
            'GRAPH_EXTENSION_SECRET',
            'PROCESS_EXTENSION_SECRET',
            'PORTFOLIO_EXTENSION_SECRET',
            'ENTRY_EXTENSION_SECRET',
            'UNRELATED_THEME_SECRET',
        ].forEach(secret => expect(serialized).not.toContain(secret));
    });

    it('keeps the process but removes all dependencies when they are disabled', () => {
        const result = createSharedProcessProjection(portfolioFixture(), 'process-1', false);

        expect(result.portfolio.processes).toHaveLength(1);
        expect(result.portfolio.assets).toEqual([]);
        expect(result.portfolio.assetCategories).toEqual([]);
        expect(result.portfolio.journal).toEqual({
            notebooks: [],
            folders: [],
            entries: [],
            tags: [],
        });
        expect(result.summary).toEqual({
            includedAssets: 0,
            includedJournalEntries: 0,
            excludedInternalJournalEntries: 0,
        });
    });

    it('preserves complete Event semantics in a shared process without exposing node extensions', () => {
        const source = portfolioFixture();
        source.processes[0].graph.nodes.push({
            id: 'event-1',
            type: 'event',
            label: 'Release window',
            position: { x: 240, y: 20 },
            event: {
                kind: 'milestone',
                behavior: 'neutral',
                timing: {
                    start: {
                        kind: 'datetime',
                        value: '2026-09-05T11:30:00.000Z',
                        timeZone: 'Asia/Kathmandu',
                        extensions: { sourceAccuracy: 'confirmed' },
                    },
                },
                metadata: { owner: 'Operations' },
                extensions: { 'org.example.process': { id: '42' } },
                futureEventField: { retained: true },
            },
            extensions: { privateNodeState: true },
        });

        const projected = createSharedProcessProjection(source, 'process-1', false)
            .portfolio.processes[0].graph.nodes[1];

        expect(projected.event).toEqual(source.processes[0].graph.nodes[1].event);
        expect(projected.extensions).toBeUndefined();
        expect(projected.event).not.toBe(source.processes[0].graph.nodes[1].event);
    });
});
