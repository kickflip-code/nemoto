import { beforeEach, describe, expect, it, vi } from 'vitest';
import pako from 'pako';
import { createEmptyPortfolioPluginState } from '../plugins/portfolioData';
import { usePortfolioStore } from '../stores/usePortfolioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { Portfolio } from '../types';
import { HtmlExportService } from './HtmlExportService';

const tauriMocks = vi.hoisted(() => ({
    isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: tauriMocks.isTauri }));

const timestamp = '2026-09-03T00:00:00.000Z';
const originalReloadThemeLibrary = useSettingsStore.getState().reloadThemeLibrary;

function decodeEmbeddedPayload(html: string): any {
    const base64 = html.match(
        /<script id="nemoto-data" type="application\/json">([^<]+)<\/script>/,
    )?.[1];
    if (!base64) throw new Error('Embedded Axiom payload not found');

    const compressed = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    return JSON.parse(pako.inflate(compressed, { to: 'string' }));
}

function shareFixture(): Portfolio {
    return {
        schemaVersion: 2,
        version: '1.0.0',
        lastModified: timestamp,
        processes: [{
            id: 'process-1',
            title: 'Share-safe HTML',
            createdAt: timestamp,
            updatedAt: timestamp,
            mode: 'blank',
            graph: { nodes: [], edges: [], swimlanes: [], mode: 'blank' },
            subGraphs: {},
        }],
        processFolders: [],
        assets: [],
        assetCategories: [],
        incidents: [],
        journal: {
            notebooks: [{
                id: 'notebook-1',
                title: 'Notebook',
                createdAt: timestamp,
                updatedAt: timestamp,
            }],
            folders: [],
            tags: [],
            entries: [
                {
                    id: 'entry-shareable',
                    notebookId: 'notebook-1',
                    title: 'Visible note',
                    content: '<p>Visible export content</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [{ id: 'process-1', type: 'process' }],
                    sharePolicy: 'shareable',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                {
                    id: 'entry-internal',
                    notebookId: 'notebook-1',
                    title: 'Internal note',
                    content: '<p>HTML_INTERNAL_SECRET</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [{ id: 'process-1', type: 'process' }],
                    sharePolicy: 'internal',
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            ],
        },
        plugins: createEmptyPortfolioPluginState(),
        extensions: { private: 'HTML_PORTFOLIO_SECRET' },
    };
}

describe('share-safe standalone HTML export', () => {
    beforeEach(() => {
        tauriMocks.isTauri.mockReturnValue(false);
        usePortfolioStore.getState().hydratePortfolio(shareFixture(), false);
        useSettingsStore.setState({
            theme: 'soft',
            activeThemeId: null,
            customThemes: [],
            reloadThemeLibrary: originalReloadThemeLibrary,
        });
        document.documentElement.setAttribute('data-theme', 'soft');
    });

    it('physically omits internal notes and portfolio-wide private payloads', async () => {
        const html = await HtmlExportService.generate('process-1', {
            includeJournal: true,
            includeAssets: true,
            includeDependencyView: true,
        });
        const payload = decodeEmbeddedPayload(html);
        const serializedPayload = JSON.stringify(payload);

        expect(payload.data.journal.entries.map((entry: any) => entry.id)).toEqual(['entry-shareable']);
        expect(payload.data.plugins).toBeUndefined();
        expect(payload.data.extensions).toBeUndefined();
        expect(serializedPayload).toContain('Visible export content');
        expect(serializedPayload).not.toContain('HTML_INTERNAL_SECRET');
        expect(serializedPayload).not.toContain('HTML_PORTFOLIO_SECRET');
    });

    it('includes only the active custom theme fields needed by the viewer', async () => {
        useSettingsStore.setState({
            theme: 'soft',
            activeThemeId: 'theme-active',
            customThemes: [{
                id: 'theme-active',
                label: 'Active theme',
                colors: { '--color-app-bg': '#ffffff' },
                extensions: { private: 'THEME_PRIVATE_VALUE' },
            }],
        });

        const payload = decodeEmbeddedPayload(await HtmlExportService.generate('process-1', {
            includeJournal: true,
            includeAssets: true,
            includeDependencyView: true,
        }));

        expect(payload.data.customThemes).toEqual([{
            id: 'theme-active',
            label: 'Active theme',
            colors: { '--color-app-bg': '#ffffff' },
        }]);
        expect(JSON.stringify(payload)).not.toContain('THEME_PRIVATE_VALUE');
    });

    it('embeds the active offline logo, WOFF2 font and Core recipe variables', async () => {
        useSettingsStore.setState({
            theme: 'void',
            activeThemeId: 'theme-brand',
            customThemes: [{
                id: 'theme-brand',
                label: 'Brand theme',
                basePresetId: 'void',
                colors: { '--color-app-bg': '#101010' },
                brand: { displayName: 'Example Co', logoAssetId: 'brand-logo' },
                typography: { fontFamily: 'Example Sans', regularAssetId: 'brand-font' },
                assets: {
                    'brand-logo': { mediaType: 'image/png', data: 'iVBORw0KGgo=', sha256: '0'.repeat(64) },
                    'brand-font': { mediaType: 'font/woff2', data: 'd09GMgA=', sha256: '1'.repeat(64) },
                },
                recipes: {
                    density: 'compact',
                    elevation: 'flat',
                    surfaceStyle: 'translucent',
                    nodeStyle: 'graphic',
                },
                extensions: { 'org.example.private': 'THEME_PRIVATE_VALUE' },
            }],
        });

        const html = await HtmlExportService.generate('process-1', {
            includeJournal: true,
            includeAssets: true,
            includeDependencyView: true,
        });
        const payload = decodeEmbeddedPayload(html);

        expect(payload.themePresentation).toEqual({
            displayName: 'Example Co',
            logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            surfaceStyle: 'translucent',
            nodeStyle: 'graphic',
        });
        expect(html).toContain("format('woff2')");
        expect(html).toContain('data:font/woff2;base64,d09GMgA=');
        expect(html).toContain('--color-app-bg: #101010;');
        expect(html).toContain('--theme-control-size-base: 1.75rem;');
        expect(html).toContain('--app-shadow-lg: none;');
        expect(JSON.stringify(payload.data)).not.toContain('THEME_PRIVATE_VALUE');
    });

    it('refreshes the native theme library before resolving HTML appearance', async () => {
        tauriMocks.isTauri.mockReturnValue(true);
        const reloadThemeLibrary = vi.fn(async () => {
            useSettingsStore.setState({
                theme: 'void',
                activeThemeId: 'theme-refreshed',
                customThemes: [{
                    id: 'theme-refreshed',
                    label: 'Refreshed theme',
                    basePresetId: 'void',
                    colors: { '--color-app-bg': '#123456' },
                    brand: { displayName: 'Refreshed Brand', logoAssetId: 'brand-logo' },
                    assets: {
                        'brand-logo': { mediaType: 'image/png', data: 'iVBORw0KGgo=', sha256: '0'.repeat(64) },
                    },
                }],
            });
        });
        useSettingsStore.setState({
            activeThemeId: null,
            customThemes: [],
            reloadThemeLibrary,
        });

        const html = await HtmlExportService.generate('process-1', {
            includeJournal: true,
            includeAssets: true,
            includeDependencyView: true,
        });
        const payload = decodeEmbeddedPayload(html);

        expect(reloadThemeLibrary).toHaveBeenCalledOnce();
        expect(payload.themePresentation).toMatchObject({
            displayName: 'Refreshed Brand',
            logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        });
        expect(html).toContain('--color-app-bg: #123456;');
    });
});
