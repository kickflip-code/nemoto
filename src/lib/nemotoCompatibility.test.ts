import { describe, expect, it } from 'vitest';
import { validateImport } from './import/validator';
import { createPortfolioEnvelope, decodePortfolioValue } from './portfolioCodec';
import { parsePluginManifest } from '../plugins/manifest';
import { createViewerProcessFragmentEnvelope } from '../export/viewer/viewerDownload';

// Synthetic, literal legacy input: this suite must also run in public Core,
// without private plugin fixtures or renamed constants supplying the old IDs.
const legacyArchive = {
    format: 'axiom',
    kind: 'portfolio',
    version: '1.0.0',
    appVersion: '0.14.0-rc.2',
    schemaVersion: 4,
    timestamp: '2026-10-01T00:00:00.000Z',
    data: {
        version: '1.0', schemaVersion: 4,
        lastModified: '2026-10-01T00:00:00.000Z',
        processes: [{
            id: 'legacy-process', title: 'Axiom user-authored title', mode: 'blank',
            createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
            graph: { nodes: [], edges: [], swimlanes: [] },
        }],
        processFolders: [], assets: [], assetCategories: [], incidents: [],
        journal: { notebooks: [], folders: [], entries: [], tags: [] },
    },
};

describe('Nemoto legacy data compatibility', () => {
    it('imports a literal old format and preserves identity and authored text on re-export', async () => {
        const imported = await validateImport(JSON.stringify(legacyArchive));
        expect(imported.success).toBe(true);
        expect(imported.sourceAppVersion).toBe('0.14.0-rc.2');
        const exported = createPortfolioEnvelope(imported.data!);
        expect(exported.format).toBe('axiom');
        expect(exported.data.processes[0]).toMatchObject({
            id: 'legacy-process', title: 'Axiom user-authored title',
        });
        expect(decodePortfolioValue(exported).portfolio).toEqual(exported.data);
    });

    it.each(['AXIOM', 'Nemoto'])('reads the %s viewer source prefix and emits a compatible fragment', source => {
        const portfolio = decodePortfolioValue(legacyArchive).portfolio;
        const envelope = createViewerProcessFragmentEnvelope({
            sourceApp: `${source} v0.14.0-rc.2`,
            exportedAt: legacyArchive.timestamp,
            rootProcessId: 'legacy-process', data: portfolio,
        });
        expect(envelope.format).toBe('axiom');
        expect(decodePortfolioValue(envelope)).toMatchObject({
            kind: 'process-fragment', sourceAppVersion: '0.14.0-rc.2',
            portfolio: { processes: [{ id: 'legacy-process' }] },
        });
    });

    it('keeps legacy plugin schema, package identity and compatibility field readable', () => {
        const manifest = parsePluginManifest({
            schema: 'axiom.plugin', schemaVersion: 1,
            id: 'org.axiom.compatibility-test', version: '1.0.0',
            name: 'Legacy package', description: 'Synthetic compatibility case',
            compatibility: { axiomPluginApi: '^1.0.0' },
            contributes: { vocabularies: [{
                id: 'org.axiom.compatibility-test/vocabulary', path: 'vocabulary.json',
            }] },
        });
        expect(manifest.schema).toBe('axiom.plugin');
        expect(manifest.id).toBe('org.axiom.compatibility-test');
        expect(manifest.compatibility).toEqual({ axiomPluginApi: '^1.0.0' });
    });
});
