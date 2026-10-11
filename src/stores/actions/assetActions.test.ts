import { describe, expect, it } from 'vitest';
import { deleteAssetCategoryLogic, importResourcesLogic, purgeAssetLogic, purgeAssetsLogic } from './assetActions';
import type { Portfolio, CanvasNode } from '../../types';

describe('assetActions - purgeAssetLogic & purgeAssetsLogic', () => {
    const mockPortfolio: Portfolio = {
        version: '1.0.0',
        lastModified: new Date().toISOString(),
        assets: [
            { id: 'res-1', name: 'Database Server', type: 'cat-sys' },
            { id: 'res-2', name: 'API Gateway', type: 'cat-sys', parentId: 'res-1' },
        ],
        assetCategories: [
            { id: 'cat-sys', label: 'Systems', color: '#3b82f6', icon: 'Database' },
        ],
        processFolders: [],
        incidents: [],
        processes: [
            {
                id: 'proc-1',
                title: 'Main Flow',
                ownerId: 'res-1',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                mode: 'blank',
                graph: {
                    nodes: [
                        {
                            id: 'node-action',
                            type: 'action',
                            label: 'Process Order',
                            position: { x: 0, y: 0 },
                            assetIds: ['res-1', 'res-2'],
                        } as CanvasNode,
                        {
                            id: 'node-res-1',
                            type: 'resource',
                            label: null,
                            position: { x: 100, y: 100 },
                            data: { assetId: 'res-1' },
                            assetIds: ['res-1'],
                        } as CanvasNode,
                        {
                            id: 'node-res-2',
                            type: 'resource',
                            label: null,
                            position: { x: 200, y: 200 },
                            data: { assetId: 'res-2' },
                            assetIds: ['res-2'],
                        } as CanvasNode,
                    ],
                    edges: [
                        { id: 'e1', sourceId: 'node-action', targetId: 'node-res-1', style: 'solid' },
                        { id: 'e2', sourceId: 'node-action', targetId: 'node-res-2', style: 'solid' },
                    ],
                    swimlanes: [],
                },
                subGraphs: {
                    'sub-1': {
                        nodes: [
                            {
                                id: 'sub-res-1',
                                type: 'resource',
                                label: null,
                                position: { x: 50, y: 50 },
                                data: { assetId: 'res-1' },
                                assetIds: ['res-1'],
                            } as CanvasNode,
                        ],
                        edges: [],
                        swimlanes: [],
                    },
                },
            },
        ],
        journal: {
            notebooks: [],
            folders: [],
            entries: [
                {
                    id: 'entry-1',
                    notebookId: 'nb-1',
                    title: 'Log',
                    content: 'Note',
                    contentFormat: 'html',
                    contentVersion: 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    tags: [],
                    linkedContext: [
                        { id: 'res-1', type: 'asset' },
                        { id: 'proc-1', type: 'process' },
                    ],
                },
            ],
            tags: [],
        },
    };

    it('removes placed resource reference nodes and cleans incident edges upon asset purge', () => {
        const updated = purgeAssetLogic(mockPortfolio, 'res-1');

        // Central assets cleaned
        expect(updated.assets.map(a => a.id)).toEqual(['res-2']);
        expect(updated.assets[0].parentId).toBeNull();

        // Process graph cleaned
        const proc = updated.processes[0];
        expect(proc.ownerId).toBeNull();
        expect(proc.graph.nodes.map(n => n.id)).toEqual(['node-action', 'node-res-2']);

        // Action node has res-1 removed from assetIds, retaining res-2
        const actionNode = proc.graph.nodes.find(n => n.id === 'node-action');
        expect(actionNode?.assetIds).toEqual(['res-2']);

        // Incident edge connected to deleted placed resource node is removed
        expect(proc.graph.edges.map(e => e.id)).toEqual(['e2']);

        // Subgraphs are cleaned
        expect(proc.subGraphs?.['sub-1'].nodes).toEqual([]);

        // Journal context is cleaned
        expect(updated.journal.entries[0].linkedContext).toEqual([
            { id: 'proc-1', type: 'process' },
        ]);
    });

    it('supports batch purging of multiple assets', () => {
        const updated = purgeAssetsLogic(mockPortfolio, ['res-1', 'res-2']);

        expect(updated.assets).toEqual([]);
        const proc = updated.processes[0];
        expect(proc.graph.nodes.map(n => n.id)).toEqual(['node-action']);
        expect(proc.graph.nodes[0].assetIds).toEqual([]);
        expect(proc.graph.edges).toEqual([]);
    });

    it('imports a validated resource batch as one immutable portfolio change', () => {
        const updated = importResourcesLogic(mockPortfolio, [
            { id: 'res-3', name: 'Laptop', type: 'cat-sys', metadata: { Owner: 'Support' } },
            { id: 'res-4', name: 'Router', type: 'cat-sys' },
        ]);

        expect(updated).not.toBe(mockPortfolio);
        expect(updated.assets.map(asset => asset.id)).toEqual(['res-1', 'res-2', 'res-3', 'res-4']);
        expect(mockPortfolio.assets).toHaveLength(2);
    });

    it('rejects the complete resource batch when one row is invalid', () => {
        expect(() => importResourcesLogic(mockPortfolio, [
            { id: 'res-3', name: 'Laptop', type: 'cat-sys' },
            { id: 'res-4', name: 'Unknown', type: 'missing-category' },
        ])).toThrow(/unknown category/i);
        expect(mockPortfolio.assets).toHaveLength(2);
    });

    it('moves resources to a valid uncategorized category when their category is deleted', () => {
        const updated = deleteAssetCategoryLogic(mockPortfolio, 'cat-sys');

        expect(updated.assets.every(asset => asset.type === 'uncategorized')).toBe(true);
        expect(updated.assetCategories).toEqual([
            expect.objectContaining({ id: 'uncategorized', label: 'Uncategorized' }),
        ]);
    });
});
