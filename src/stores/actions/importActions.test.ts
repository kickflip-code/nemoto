import { describe, expect, it } from 'vitest';
import { importProcessLogic, mergeImportedPortfolioLogic } from './importActions';
import type { Portfolio, Process, ImportedPortfolio, CanvasGraph, CanvasNode } from '../../types';

describe('importActions - importProcessLogic', () => {
    const existingPortfolio: Portfolio = {
        version: '1.0.0',
        lastModified: new Date().toISOString(),
        assets: [
            { id: 'central-db-id', name: 'Database', type: 'cat-sys' },
        ],
        assetCategories: [
            { id: 'cat-sys', label: 'Systems', color: '#3b82f6', icon: 'Database' },
        ],
        processFolders: [],
        incidents: [],
        processes: [],
        journal: { notebooks: [], folders: [], entries: [], tags: [] },
    };

    it('remaps node.data.assetId and node.assetIds when importing a process with matching assets', () => {
        const sourceProcess: Process = {
            id: 'ext-proc-1',
            title: 'External Flow',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            mode: 'blank',
            graph: {
                nodes: [
                    {
                        id: 'ext-res-node',
                        type: 'resource',
                        label: null,
                        position: { x: 50, y: 50 },
                        data: { assetId: 'ext-db-id' },
                        assetIds: ['ext-db-id'],
                    } as CanvasNode,
                ],
                edges: [],
                swimlanes: [],
            },
        };

        const importedPortfolio: ImportedPortfolio = {
            id: 'imp-1',
            sourceName: 'external.axiom',
            importedAt: '2026-08-01T00:00:00.000Z',
            isReadOnly: true,
            data: {
                version: '1.0.0',
                lastModified: '2026-08-01T00:00:00.000Z',
                assets: [
                    { id: 'ext-db-id', name: 'Database', type: 'cat-sys' },
                ],
                assetCategories: [],
                processFolders: [],
                incidents: [],
                processes: [sourceProcess],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
            },
        };

        const { portfolio: updatedPortfolio, result } = importProcessLogic(
            existingPortfolio,
            sourceProcess,
            importedPortfolio
        );

        expect(updatedPortfolio.assets).toHaveLength(1);
        expect(updatedPortfolio.assets[0].id).toBe('central-db-id');

        const mergedProc = updatedPortfolio.processes.find(p => p.id === result.processId);
        expect(mergedProc).toBeDefined();
        const placedNode = mergedProc!.graph.nodes.find(n => n.type === 'resource');
        expect(placedNode).toBeDefined();
        expect(placedNode?.data?.assetId).toBe('central-db-id');
        expect(placedNode?.assetIds).toEqual(['central-db-id']);
    });
});

describe('importActions - atomic portfolio merge', () => {
    const emptyTarget = (): Portfolio => ({
        version: '1.0.0',
        lastModified: '2026-08-01T00:00:00.000Z',
        assets: [],
        assetCategories: [],
        processFolders: [],
        incidents: [],
        processes: [],
        journal: { notebooks: [], folders: [], entries: [], tags: [] },
    });

    const importedSource = (): ImportedPortfolio => ({
        id: 'import-source',
        sourceName: 'source.axiom',
        importedAt: '2026-08-01T00:00:00.000Z',
        isReadOnly: true,
        data: {
            version: '1.0.0',
            lastModified: '2026-08-01T00:00:00.000Z',
            assets: [{ id: 'source-asset', name: 'Source system', type: 'systems' }],
            assetCategories: [{ id: 'systems', label: 'Systems', color: 'blue', icon: 'Database' }],
            processFolders: [],
            incidents: [],
            processes: [{
                id: 'source-process',
                title: 'Source process',
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
                mode: 'blank',
                graph: {
                    nodes: [{
                        id: 'source-node',
                        type: 'resource',
                        label: 'Source system',
                        position: { x: 0, y: 0 },
                        data: { assetId: 'source-asset' },
                        assetIds: ['source-asset'],
                    } as CanvasNode],
                    edges: [],
                    swimlanes: [],
                },
            }],
            journal: {
                notebooks: [{
                    id: 'source-notebook',
                    title: 'Imported notes',
                    createdAt: '2026-08-01T00:00:00.000Z',
                    updatedAt: '2026-08-01T00:00:00.000Z',
                }],
                folders: [],
                tags: [],
                entries: [{
                    id: 'source-entry',
                    notebookId: 'source-notebook',
                    title: 'Imported note',
                    content: '<p>Context</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [
                        { id: 'source-process', type: 'process' },
                        { id: 'source-node', type: 'node', processId: 'source-process' },
                        { id: 'source-asset', type: 'asset' },
                    ],
                    createdAt: '2026-08-01T00:00:00.000Z',
                    updatedAt: '2026-08-01T00:00:00.000Z',
                }],
            },
        },
    });

    it('builds the complete result without mutating the current portfolio', () => {
        const target = emptyTarget();
        const targetBefore = structuredClone(target);

        const result = mergeImportedPortfolioLogic(target, importedSource());

        expect(target).toEqual(targetBefore);
        expect(result.mergedItemCount).toBe(3);
        expect(result.portfolio.processes).toHaveLength(1);
        expect(result.portfolio.assets).toHaveLength(1);
        expect(result.portfolio.journal.entries).toHaveLength(1);

        const mergedProcess = result.portfolio.processes[0];
        const mergedNode = mergedProcess.graph.nodes[0];
        const mergedAsset = result.portfolio.assets[0];
        const mergedEntry = result.portfolio.journal.entries[0];
        expect(mergedEntry.notebookId).toBe(result.portfolio.journal.notebooks[0].id);
        expect(mergedEntry.linkedContext).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: mergedProcess.id, type: 'process' }),
            expect.objectContaining({ id: mergedNode.id, type: 'node' }),
            expect.objectContaining({ id: mergedAsset.id, type: 'asset' }),
        ]));
    });

    it('remaps resource hierarchy when merging a complete portfolio', () => {
        const source = importedSource();
        source.data.assets.push({
            id: 'source-child-asset',
            name: 'Child system',
            type: source.data.assets[0].type,
            parentId: source.data.assets[0].id,
        });

        const result = mergeImportedPortfolioLogic(emptyTarget(), source);
        const parent = result.portfolio.assets.find(asset => asset.name === source.data.assets[0].name);
        const child = result.portfolio.assets.find(asset => asset.name === 'Child system');

        expect(parent).toBeDefined();
        expect(child?.parentId).toBe(parent?.id);
    });

    it('throws without touching the target when any item cannot be prepared', () => {
        const target = emptyTarget();
        const targetBefore = structuredClone(target);
        const source = importedSource();
        source.data.processes[0].graph = null as unknown as CanvasGraph;

        expect(() => mergeImportedPortfolioLogic(target, source)).toThrow();
        expect(target).toEqual(targetBefore);
    });

    it('rejects a full merge whose source has ambiguous duplicate IDs', () => {
        const target = emptyTarget();
        const source = importedSource();
        source.data.assets.push({
            ...source.data.assets[0],
            name: 'Conflicting source system',
        });

        expect(() => mergeImportedPortfolioLogic(target, source)).toThrow(/reference or ID error/i);
        expect(target).toEqual(emptyTarget());
    });
});
