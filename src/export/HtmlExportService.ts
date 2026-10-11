import pako from 'pako';
import { isTauri } from '@tauri-apps/api/core';
import { BackupService } from '../services/BackupService';
import { useSettingsStore } from '../stores/useSettingsStore';
import { getBuiltInThemeIdForPreset } from '../theme/presets';
import { getThemeBasePresetId, getThemeConfigTokens } from '../theme/themeFiles';
import {
    createThemeFontFaceCss,
    resolveThemePresentation,
} from '../theme/themePresentation';
import {
    appendViewerThemeStyles,
    captureRenderedThemeTokens,
    createCustomViewerThemeCss,
    resolveViewerThemeId,
} from './viewerTheme';
import { loadBundledViewerTemplate } from './viewerTemplate';
import { projectThemeForSharing } from './shareablePortfolio';
import { resolveRoutingNodeSize } from '../lib/edgeRouting';
import { APP_VERSION } from '../lib/appVersion';

export interface ExportOptions {
    includeJournal: boolean;
    includeAssets: boolean;
    includeDependencyView: boolean;
}

export class HtmlExportService {
    /**
     * Generates a single-file HTML export for a specific process.
     */
    static async generate(
        processId: string,
        options: ExportOptions
    ): Promise<string> {
        const exportOptions = {
            includeJournal: options?.includeJournal ?? true,
            includeAssets: options?.includeAssets ?? true,
            includeDependencyView: options?.includeDependencyView ?? true,
        };
        const withDependencies = exportOptions.includeJournal || exportOptions.includeAssets || exportOptions.includeDependencyView;
        const snapshot = BackupService.createPartialExport(processId, withDependencies);

        // Theme Studio owns its own webview. Refresh the native-backed theme
        // projection before export so a recently applied theme cannot leave the
        // main window exporting a stale in-memory baseline.
        if (isTauri()) {
            try {
                await useSettingsStore.getState().reloadThemeLibrary();
            } catch (error) {
                const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
                throw new Error(`Could not load the active theme for HTML export.${detail}`);
            }
        }

        const settings = useSettingsStore.getState();
        const currentTheme = settings.theme || 'void';

        // 1.5 Load active custom theme if available from global SettingsStore
        const activeThemeId = settings.activeThemeId;
        const customThemes = settings.customThemes || [];
        const activeCustomTheme = customThemes.find(t => t.id === activeThemeId);
        const themePresentation = resolveThemePresentation(activeCustomTheme);
        const renderedTheme = document.documentElement.getAttribute('data-theme');
        const activeCustomBaseTheme = activeCustomTheme
            ? getBuiltInThemeIdForPreset(getThemeBasePresetId(activeCustomTheme.basePresetId))
            : null;
        const viewerTheme = resolveViewerThemeId(activeCustomBaseTheme, renderedTheme, currentTheme);
        const renderedThemeTokens = {
            ...captureRenderedThemeTokens(window.getComputedStyle(document.documentElement)),
            // The installed document is authoritative for public values. The
            // computed snapshot still contributes Core-owned art direction
            // variables, but must not replace custom tokens with its baseline.
            ...(activeCustomTheme ? getThemeConfigTokens(activeCustomTheme) : {}),
            ...themePresentation.variables,
        };

        const exportPortfolio = this.applyExportOptions(snapshot.data, exportOptions);
        if (activeCustomTheme) {
            const existingThemes = exportPortfolio.customThemes || [];
            exportPortfolio.customThemes = [
                ...existingThemes.filter((theme: any) => theme.id !== activeCustomTheme.id),
                projectThemeForSharing(activeCustomTheme),
            ];
            exportPortfolio.activeThemeId = activeCustomTheme.id;
        }

        // 2. Prepare Export Data
        const exportData = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            sourceApp: `Nemoto v${APP_VERSION}`,
            theme: viewerTheme,
            themePresentation: {
                displayName: themePresentation.displayName,
                ...(themePresentation.showDisplayName === false ? { showDisplayName: false } : {}),
                ...(themePresentation.logoDataUrl ? { logoDataUrl: themePresentation.logoDataUrl } : {}),
                ...(themePresentation.attributes['data-theme-surface-style']
                    ? { surfaceStyle: themePresentation.attributes['data-theme-surface-style'] }
                    : {}),
                ...(themePresentation.attributes['data-theme-node-style']
                    ? { nodeStyle: themePresentation.attributes['data-theme-node-style'] }
                    : {}),
            },
            features: {
                journal: exportOptions.includeJournal,
                assets: exportOptions.includeAssets,
                dependencyView: exportOptions.includeDependencyView,
            },
            rootProcessId: processId,
            data: exportPortfolio,
            // Pre-computed layouts (freeze positions)
            layouts: this.captureLayouts(exportPortfolio.processes)
        };

        // 3. Compress Data
        const jsonStr = JSON.stringify(exportData);
        const compressed = pako.gzip(jsonStr);
        const base64 = this.uint8ToBase64(compressed);

        // 4. Load the pre-built viewer shell from its emitted static asset.
        // The final export remains a standalone file; only the app's internal
        // transport avoids wrapping the complete HTML document in JavaScript.
        const viewerTemplate = await loadBundledViewerTemplate();

        const processTitle = snapshot.data.processes[0].title;

        // The viewer bundle already contains the same shared structural and
        // art-direction CSS as the app. Only the rendered token snapshot is
        // injected, avoiding a second set of export-only theme rules.
        const dynamicCss = `\n/* EXPORTED RENDERED THEME */\n${createCustomViewerThemeCss(
            viewerTheme,
            renderedThemeTokens,
        )}\n${createThemeFontFaceCss(themePresentation)}\n`;

        // Define defensive CSP for the exported HTML viewer
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline';">`;

        const escapeHtmlText = (value: string): string => value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const viewerTitle = `${processTitle} - ${themePresentation.displayName} Viewer`;

        const html = appendViewerThemeStyles(viewerTemplate as string, dynamicCss)
            .replace('<head>', `<head>\n    ${csp}`)
            .replace('<!--AXIOM_DATA-->', base64)
            .replace('Nemoto Viewer', escapeHtmlText(viewerTitle));

        return html;
    }

    private static applyExportOptions(data: any, options: ExportOptions): any {
        return {
            ...data,
            assets: options.includeAssets ? (data.assets || []) : [],
            assetCategories: options.includeAssets ? (data.assetCategories || []) : [],
            journal: options.includeJournal
                ? {
                    notebooks: data.journal?.notebooks || [],
                    folders: data.journal?.folders || [],
                    entries: data.journal?.entries || [],
                    tags: data.journal?.tags || [],
                }
                : { notebooks: [], folders: [], entries: [], tags: [] },
        };
    }

    private static uint8ToBase64(bytes: Uint8Array): string {
        const chunkSize = 0x8000;
        let binary = '';

        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode(...Array.from(chunk));
        }

        return btoa(binary);
    }

    private static captureLayouts(processes: any[]): Record<string, any> {
        const layouts: Record<string, any> = {};
        const visitedGraphIds = new Set<string>();

        const captureGraph = (id: string, graph: any, process?: any) => {
            if (!graph || !graph.nodes || visitedGraphIds.has(id)) return;
            visitedGraphIds.add(id);
            layouts[id] = {
                nodes: graph.nodes.map((n: any) => {
                    const { width, height } = resolveRoutingNodeSize(n);

                    return {
                        id: n.id,
                        x: n.position?.x || 0,
                        y: n.position?.y || 0,
                        width,
                        height,
                    };
                }),
                viewport: { x: 0, y: 0, zoom: 1 }
            };
            // Recursively capture subprocess children layouts
            graph.nodes.forEach((n: any) => {
                if (n.subGraphId && process?.subGraphs && process.subGraphs[n.subGraphId]) {
                    captureGraph(n.subGraphId, process.subGraphs[n.subGraphId], process);
                }
            });
        };

        processes.forEach(p => captureGraph(p.id, p.graph, p));
        return layouts;
    }

    /**
     * Triggers the download of the HTML export using native file dialog.
     */
    static async downloadHtmlExport(processId: string, options: ExportOptions) {
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            const { backupPath } = useSettingsStore.getState();
            // Dynamically import the store to avoid circular issues
            const { usePortfolioStore } = await import('../stores/usePortfolioStore');

            const html = await this.generate(processId, options);

            const portfolio = usePortfolioStore.getState().portfolio;
            const process = portfolio.processes.find(p => p.id === processId);
            const rawTitle = process?.title || 'axiom_process';
            const safeTitle = rawTitle.replace(/[^a-z0-9åäö]/gi, '_').toLowerCase();

            const defaultFilename = `${safeTitle}_viewer.html`;

            const path = await save({
                filters: [{ name: 'Nemoto HTML Viewer', extensions: ['html'] }],
                defaultPath: backupPath ? `${backupPath}/${defaultFilename}` : defaultFilename
            });
            if (path) {
                await writeTextFile(path, html);
                return true;
            }
            return false;
        } catch (err: any) {
            console.error('HTML Export failed', err);
            throw err;
        }
    }
}
