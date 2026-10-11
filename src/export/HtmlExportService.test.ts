import { beforeEach, describe, expect, it, vi } from 'vitest';
import pako from 'pako';

const { createPartialExport } = vi.hoisted(() => ({
    createPartialExport: vi.fn(),
}));

vi.mock('../services/BackupService', () => ({
    BackupService: { createPartialExport },
}));

vi.mock('../stores/useSettingsStore', () => ({
    useSettingsStore: {
        getState: () => ({
            theme: 'soft',
            activeThemeId: null,
            customThemes: [],
            backupPath: null,
        }),
    },
}));

import { HtmlExportService } from './HtmlExportService';
import { APP_VERSION } from '../lib/appVersion';

const decodeEmbeddedPayload = (html: string): any => {
    const embeddedData = html.match(
        /<script id="axiom-data" type="application\/json">([^<]+)<\/script>/,
    )?.[1];
    if (!embeddedData) throw new Error('Embedded Axiom payload not found');

    const compressed = Uint8Array.from(atob(embeddedData), character => character.charCodeAt(0));
    return JSON.parse(pako.inflate(compressed, { to: 'string' }));
};

describe('standalone HTML export', () => {
    beforeEach(() => {
        document.documentElement.setAttribute('data-theme', 'soft');
        createPartialExport.mockReturnValue({
            timestamp: '2026-09-01T00:00:00.000Z',
            data: {
                version: '1.0.0',
                lastModified: '2026-09-01T00:00:00.000Z',
                processes: [{
                    id: 'process-1',
                    title: 'Standalone export check',
                    graph: { nodes: [], edges: [] },
                    subGraphs: {},
                }],
                processFolders: [],
                assets: [],
                assetCategories: [],
                incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
                customThemes: [],
                activeThemeId: null,
            },
        });
    });

    it('embeds executable viewer code and data without Vite development references', async () => {
        const html = await HtmlExportService.generate('process-1', {
            includeJournal: true,
            includeAssets: true,
            includeDependencyView: true,
        });

        expect(html).toContain('<div id="root"></div>');
        expect(html).toContain('<script type="module" crossorigin>');
        expect(html).not.toContain('<!--AXIOM_DATA-->');
        expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=|\/@vite\/|html-proxy/i);

        const payload = decodeEmbeddedPayload(html);
        expect(payload.rootProcessId).toBe('process-1');
        expect(payload.data.processes[0].title).toBe('Standalone export check');
        expect(payload.sourceApp).toBe(`Nemoto v${APP_VERSION}`);
        expect(payload.themePresentation).toEqual({ displayName: 'Nemoto' });
    });

    it('escapes portfolio and brand text used in the HTML title', async () => {
        createPartialExport.mockReturnValue({
            timestamp: '2026-09-01T00:00:00.000Z',
            data: {
                version: '1.0.0',
                lastModified: '2026-09-01T00:00:00.000Z',
                processes: [{ id: 'process-1', title: '</title><script>unsafe()</script>', graph: { nodes: [], edges: [] }, subGraphs: {} }],
                processFolders: [], assets: [], assetCategories: [], incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
                customThemes: [], activeThemeId: null,
            },
        });

        const html = await HtmlExportService.generate('process-1', {
            includeJournal: false,
            includeAssets: false,
            includeDependencyView: false,
        });

        expect(html).toContain('&lt;/title&gt;&lt;script&gt;unsafe()&lt;/script&gt; - Nemoto Viewer');
        expect(html).not.toContain('<title></title><script>unsafe()</script>');
    });

    it('normalizes dimensions retained from a node\'s previous built-in shape', async () => {
        createPartialExport.mockReturnValue({
            timestamp: '2026-09-01T00:00:00.000Z',
            data: {
                version: '1.0.0',
                lastModified: '2026-09-01T00:00:00.000Z',
                processes: [{
                    id: 'process-1',
                    title: 'Node dimensions',
                    graph: {
                        nodes: [
                            {
                                id: 'stale-system',
                                type: 'system',
                                label: 'Plexus identifierar produkt',
                                position: { x: 100, y: 100 },
                                width: 224,
                                height: 160,
                            },
                            {
                                id: 'custom-system',
                                type: 'system',
                                label: 'Imported custom size',
                                position: { x: 100, y: 300 },
                                width: 280,
                                height: 140,
                            },
                        ],
                        edges: [],
                        swimlanes: [],
                    },
                    subGraphs: {},
                }],
                processFolders: [],
                assets: [],
                assetCategories: [],
                incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
                customThemes: [],
                activeThemeId: null,
            },
        });

        const payload = decodeEmbeddedPayload(await HtmlExportService.generate('process-1', {
            includeJournal: true,
            includeAssets: true,
            includeDependencyView: true,
        }));
        const sizes = Object.fromEntries(
            payload.layouts['process-1'].nodes.map((node: any) => [node.id, {
                width: node.width,
                height: node.height,
            }]),
        );

        expect(sizes['stale-system']).toEqual({ width: 224, height: 96 });
        expect(sizes['custom-system']).toEqual({ width: 280, height: 140 });
    });

    it('captures each layout once when subprocess references contain a cycle', async () => {
        createPartialExport.mockReturnValue({
            timestamp: '2026-09-01T00:00:00.000Z',
            data: {
                version: '1.0.0',
                lastModified: '2026-09-01T00:00:00.000Z',
                processes: [{
                    id: 'process-1',
                    title: 'Cyclic subprocess export',
                    graph: {
                        nodes: [{ id: 'root-to-a', type: 'action', label: 'A', position: { x: 0, y: 0 }, subGraphId: 'sub-a' }],
                        edges: [],
                        swimlanes: [],
                    },
                    subGraphs: {
                        'sub-a': {
                            nodes: [{ id: 'a-to-b', type: 'action', label: 'B', position: { x: 0, y: 0 }, subGraphId: 'sub-b' }],
                            edges: [],
                            swimlanes: [],
                        },
                        'sub-b': {
                            nodes: [{ id: 'b-to-a', type: 'action', label: 'A', position: { x: 0, y: 0 }, subGraphId: 'sub-a' }],
                            edges: [],
                            swimlanes: [],
                        },
                    },
                }],
                processFolders: [],
                assets: [],
                assetCategories: [],
                incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
                customThemes: [],
                activeThemeId: null,
            },
        });

        const payload = decodeEmbeddedPayload(await HtmlExportService.generate('process-1', {
            includeJournal: false,
            includeAssets: false,
            includeDependencyView: false,
        }));

        expect(Object.keys(payload.layouts).sort()).toEqual(['process-1', 'sub-a', 'sub-b']);
    });

    it('embeds complete Event semantics and the Event layout baseline for the offline viewer', async () => {
        const event = {
            kind: 'milestone',
            behavior: 'neutral',
            timing: {
                start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                end: { kind: 'date', precision: 'day', value: '2026-09-07' },
                allDay: true,
            },
            extensions: { 'org.example.process': { id: 'release-42' } },
        };
        createPartialExport.mockReturnValue({
            timestamp: '2026-09-01T00:00:00.000Z',
            data: {
                version: '1.0.0',
                lastModified: '2026-09-01T00:00:00.000Z',
                processes: [{
                    id: 'process-1',
                    title: 'Event export',
                    graph: {
                        nodes: [{ id: 'event-1', type: 'event', label: 'Release', position: { x: 10, y: 20 }, event }],
                        edges: [],
                        swimlanes: [],
                    },
                    subGraphs: {},
                }],
                processFolders: [], assets: [], assetCategories: [], incidents: [],
                journal: { notebooks: [], folders: [], entries: [], tags: [] },
                customThemes: [], activeThemeId: null,
            },
        });

        const payload = decodeEmbeddedPayload(await HtmlExportService.generate('process-1', {
            includeJournal: false,
            includeAssets: false,
            includeDependencyView: false,
        }));

        expect(payload.data.processes[0].graph.nodes[0].event).toEqual(event);
        expect(payload.layouts['process-1'].nodes[0]).toMatchObject({ width: 240, height: 112 });
    });
});
