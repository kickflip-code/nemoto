import { describe, expect, it } from 'vitest';
import type { CanvasGraph, CanvasNode, Portfolio, Process } from '../types';
import {
    buildDependencyGraphIndex,
    getProcessIdsForFolder,
    queryDependencyGraph,
} from './dependencyGraph';

const timestamp = '2026-08-10T00:00:00.000Z';

function node(id: string, assetIds: string[] = [], subGraphId?: string): CanvasNode {
    return {
        id,
        type: 'action',
        label: id.toUpperCase(),
        position: { x: 0, y: 0 },
        assetIds,
        subGraphId,
    };
}

function graph(nodes: CanvasNode[], edgePairs: Array<[string, string]> = []): CanvasGraph {
    return {
        nodes,
        edges: edgePairs.map(([sourceId, targetId], index) => ({
            id: `edge-${sourceId}-${targetId}-${index}`,
            sourceId,
            targetId,
            style: 'solid',
        })),
        swimlanes: [],
        mode: 'blank',
    };
}

function process(
    id: string,
    processGraph: CanvasGraph,
    folderId?: string,
    subGraphs: Record<string, CanvasGraph> = {},
): Process {
    return {
        id,
        title: id.toUpperCase(),
        createdAt: timestamp,
        updatedAt: timestamp,
        graph: processGraph,
        subGraphs,
        folderId,
        mode: 'blank',
    };
}

function createPortfolio(): Portfolio {
    const p1 = process(
        'p1',
        graph(
            [node('n1', ['a1']), node('n2', ['a1']), node('n3', [], 'sg1')],
            [['n1', 'n2'], ['n2', 'n3'], ['n1', 'n3']],
        ),
        'folder-child',
        { sg1: graph([node('n4', ['a2'])]) },
    );
    const p2 = process('p2', graph([node('n5', ['a1'])]), 'folder-other');

    return {
        version: '1.0.0',
        lastModified: timestamp,
        processes: [p1, p2],
        processFolders: [
            { id: 'folder-root', title: 'Root' },
            { id: 'folder-child', title: 'Child', parentId: 'folder-root' },
            { id: 'folder-other', title: 'Other' },
        ],
        assets: [
            { id: 'a1', name: 'Asset One', type: 'system' },
            { id: 'a2', name: 'Asset Two', type: 'document' },
        ],
        assetCategories: [
            { id: 'system', label: 'System', icon: 'database', color: 'blue' },
            { id: 'document', label: 'Document', icon: 'file', color: 'amber' },
        ],
        incidents: [],
        journal: {
            notebooks: [{ id: 'book', title: 'Book', createdAt: timestamp, updatedAt: timestamp }],
            folders: [],
            tags: [{ id: 't1', label: 'Critical', color: 'red' }],
            entries: [
                {
                    id: 'j1',
                    notebookId: 'book',
                    title: 'Journal One',
                    content: '<p>One</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: ['t1'],
                    linkedContext: [
                        { id: 'n1', type: 'node', processId: 'p1' },
                        { id: 'a1', type: 'asset' },
                    ],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                {
                    id: 'j2',
                    notebookId: 'book',
                    title: 'Journal Two',
                    content: '<p>Two</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: ['t1'],
                    linkedContext: [{ id: 'n4', type: 'node', processId: 'p1' }],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            ],
        },
    };
}

describe('dependency graph index', () => {
    it('preserves relation direction and indexes reachable subgraphs', () => {
        const index = buildDependencyGraphIndex(createPortfolio());

        expect(index.entities.get('n4')).toMatchObject({ type: 'node', processId: 'p1' });
        expect(index.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'n1', target: 'n2', type: 'flow' }),
            expect.objectContaining({ source: 'n1', target: 'a1', type: 'asset-reference' }),
            expect.objectContaining({ source: 'n3', target: 'n4', type: 'contains' }),
            expect.objectContaining({ source: 'j1', target: 'n1', type: 'journal-reference' }),
            expect.objectContaining({ source: 't1', target: 'j1', type: 'tag-membership' }),
        ]));
        expect(index.danglingReferenceCount).toBe(0);
    });

    it('keeps every parent relation when a subgraph is deliberately shared', () => {
        const portfolio = createPortfolio();
        portfolio.processes[0].graph.nodes.push(node('n6', [], 'sg1'));

        const index = buildDependencyGraphIndex(portfolio);

        expect(index.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'n3', target: 'n4', type: 'contains' }),
            expect.objectContaining({ source: 'n6', target: 'n4', type: 'contains' }),
        ]));
        expect(index.relations.filter(relation => (
            relation.type === 'asset-reference' && relation.source === 'n4' && relation.target === 'a2'
        ))).toHaveLength(1);
    });

    it('returns every relation induced by the focused nodes, not only the BFS discovery tree', () => {
        const portfolio = createPortfolio();
        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, {
            kind: 'focus',
            focalId: 'n1',
            depth: 1,
        });

        expect(view.nodes.map(item => item.id)).toEqual(expect.arrayContaining(['n1', 'n2', 'n3', 'a1', 'j1', 'p1']));
        expect(view.relations.filter(relation => relation.type === 'flow')).toHaveLength(3);
        expect(view.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'n2', target: 'a1', type: 'asset-reference' }),
        ]));
    });

    it('resolves nested folders and summarizes resources used in reachable subgraphs', () => {
        const portfolio = createPortfolio();
        const index = buildDependencyGraphIndex(portfolio);

        expect(getProcessIdsForFolder(portfolio, 'folder-root')).toEqual(['p1']);

        const view = queryDependencyGraph(index, portfolio, {
            kind: 'process',
            folderId: 'folder-root',
        });

        expect(view.nodes.map(item => item.id)).toEqual(['p1', 'a1', 'a2']);
        expect(view.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'p1', target: 'a1', type: 'process-resource', count: 2 }),
            expect.objectContaining({ source: 'p1', target: 'a2', type: 'process-resource', count: 1 }),
        ]));
        expect(view.nodes.map(item => item.id)).not.toEqual(expect.arrayContaining(['p2', 'n1', 'n4', 'j1']));
    });

    it('reads legacy resource references stored inside node data', () => {
        const portfolio = createPortfolio();
        portfolio.processes[0].graph.nodes[0].assetIds = [];
        portfolio.processes[0].graph.nodes[0].data = { assetIds: ['a2', 'a2', 42] };

        const index = buildDependencyGraphIndex(portfolio);

        expect(index.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'n1', target: 'a2', type: 'asset-reference' }),
        ]));
        expect(index.relations.filter(relation => relation.source === 'n1' && relation.target === 'a2')).toHaveLength(1);
    });

    it('summarizes tag insight by referenced entity instead of exposing every note', () => {
        const portfolio = createPortfolio();
        portfolio.journal!.entries[1].linkedContext!.push({ id: 'n1', type: 'node', processId: 'p1' });
        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, { kind: 'tag', tagId: 't1' });

        expect(view.nodes.map(item => item.id)).toEqual(expect.arrayContaining([
            't1', 'n1', 'n4', 'a1',
        ]));
        expect(view.nodes.map(item => item.id)).not.toContain('p1');
        expect(view.nodes.map(item => item.id)).not.toEqual(expect.arrayContaining(['j1', 'j2']));
        expect(view.relations).toHaveLength(3);
        expect(view.relations.every(relation => relation.type === 'tag-insight')).toBe(true);
        expect(view.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 't1', target: 'n1', count: 2 }),
            expect.objectContaining({ source: 't1', target: 'n4', count: 1 }),
            expect.objectContaining({ source: 't1', target: 'a1', count: 1 }),
        ]));
        expect(view.tagInsight).toEqual({
            taggedEntryCount: 2,
            referencedEntityCount: 3,
            unlinkedEntryCount: 0,
        });
    });

    it('reports tagged notes that do not point to a valid entity', () => {
        const portfolio = createPortfolio();
        portfolio.journal!.entries.push({
            id: 'j3',
            notebookId: 'book',
            title: 'Unlinked note',
            content: '<p>Three</p>',
            contentFormat: 'html',
            contentVersion: 1,
            tags: ['t1'],
            linkedContext: [],
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, { kind: 'tag', tagId: 't1' });

        expect(view.tagInsight).toEqual({
            taggedEntryCount: 3,
            referencedEntityCount: 3,
            unlinkedEntryCount: 1,
        });
    });

    it('keeps individual tagged notes available as an explicit detail view', () => {
        const portfolio = createPortfolio();
        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, {
            kind: 'tag',
            tagId: 't1',
            includeJournalEntries: true,
        });

        expect(view.nodes.map(item => item.id)).toEqual(expect.arrayContaining([
            't1', 'j1', 'j2', 'n1', 'n4', 'a1', 'p1',
        ]));
        expect(view.relations.filter(relation => relation.type === 'tag-membership')).toHaveLength(2);
        expect(view.relations.filter(relation => relation.type === 'journal-reference')).toHaveLength(3);
        expect(new Set(view.relations.map(relation => relation.id)).size).toBe(view.relations.length);
    });

    it('aggregates process-to-resource relations for the default overview', () => {
        const portfolio = createPortfolio();
        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, { kind: 'overview' });

        expect(view.nodes.map(item => item.id)).toEqual(expect.arrayContaining(['p1', 'p2', 'a1', 'a2']));
        expect(view.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'p1', target: 'a1', type: 'process-resource', count: 2 }),
            expect.objectContaining({ source: 'p1', target: 'a2', type: 'process-resource', count: 1 }),
            expect.objectContaining({ source: 'p2', target: 'a1', type: 'process-resource', count: 1 }),
        ]));
    });

    it('aggregates process and resource IDs containing colons without losing relations', () => {
        const portfolio = createPortfolio();
        portfolio.processes[0].id = 'process:one';
        portfolio.processes[0].title = 'Process with colon';
        portfolio.assets[0].id = 'asset:one';
        portfolio.processes[0].graph.nodes[0].assetIds = ['asset:one'];
        portfolio.processes[0].graph.nodes[1].assetIds = ['asset:one'];
        portfolio.processes[1].graph.nodes[0].assetIds = ['asset:one'];

        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, { kind: 'overview' });

        expect(view.relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ source: 'process:one', target: 'asset:one', count: 2 }),
            expect.objectContaining({ source: 'p2', target: 'asset:one', count: 1 }),
        ]));
    });

    it('summarizes unlinked resources out of the overview until explicitly requested', () => {
        const portfolio = createPortfolio();
        portfolio.assets.push({ id: 'a3', name: 'Unused Asset', type: 'system' });
        const index = buildDependencyGraphIndex(portfolio);

        const summarized = queryDependencyGraph(index, portfolio, { kind: 'overview' });
        const expanded = queryDependencyGraph(index, portfolio, {
            kind: 'overview',
            includeUnlinkedResources: true,
        });

        expect(summarized.nodes.map(item => item.id)).not.toContain('a3');
        expect(summarized.unlinkedResourceCount).toBe(1);
        expect(expanded.nodes.map(item => item.id)).toContain('a3');
        expect(expanded.unlinkedResourceCount).toBe(1);
    });

    it('classifies dangling references so data issues can be explained', () => {
        const portfolio = createPortfolio();
        portfolio.journal!.entries[0].linkedContext!.push({ id: 'missing-asset', type: 'asset' });
        const index = buildDependencyGraphIndex(portfolio);

        expect(index.danglingReferenceCount).toBe(1);
        expect(index.danglingRelationCounts['journal-reference']).toBe(1);
        expect(index.danglingRelationCounts.flow).toBe(0);
    });

    it('reports truncation instead of attempting to render an unbounded focus graph', () => {
        const portfolio = createPortfolio();
        const index = buildDependencyGraphIndex(portfolio);
        const view = queryDependencyGraph(index, portfolio, {
            kind: 'focus',
            focalId: 'n1',
            depth: 3,
            maxNodes: 3,
        });

        expect(view.truncated).toBe(true);
        expect(view.nodes).toHaveLength(3);
    });
});
