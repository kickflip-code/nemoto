import type { Portfolio } from '../../types';

function sourceAppVersion(sourceApp: unknown): string {
    if (typeof sourceApp !== 'string' || !sourceApp.trim()) return 'unknown';
    return sourceApp.trim().replace(/^(?:AXIOM|NEMOTO)\s+v?/i, '');
}

export function createViewerProcessFragmentEnvelope(viewerData: any) {
    const source = (viewerData?.data || {}) as Partial<Portfolio>;
    const portfolio = {
        ...source,
        processes: source.processes || [],
        processFolders: source.processFolders || [],
        assets: source.assets || [],
        assetCategories: source.assetCategories || [],
        incidents: source.incidents || [],
        journal: source.journal || { notebooks: [], folders: [], entries: [], tags: [] },
        customThemes: source.customThemes || [],
        activeThemeId: source.activeThemeId || null,
    };
    const schemaVersion = Number.isInteger(source.schemaVersion) ? source.schemaVersion as number : 0;

    return {
        format: 'axiom' as const,
        kind: 'process-fragment' as const,
        schemaVersion,
        version: '1.0.0',
        appVersion: sourceAppVersion(viewerData?.sourceApp),
        timestamp: viewerData?.exportedAt || new Date().toISOString(),
        type: 'partial' as const,
        sourceId: viewerData?.rootProcessId,
        data: portfolio,
    };
}
