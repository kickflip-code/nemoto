import {
    NEMOTO_PLUGIN_DIAGNOSTIC_BUNDLE_SCHEMA,
    CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    type SanitizedPluginDiagnosticBundle,
} from '../plugins/developerDiagnostics';

export const MAX_PLUGIN_DIAGNOSTIC_BUNDLE_EXPORT_BYTES = 4 * 1024 * 1024;

export interface PreparedPluginDiagnosticBundleExport {
    readonly json: string;
    readonly byteLength: number;
    readonly suggestedFileName: string;
    readonly generatedAt: string;
    readonly schemaVersion: number;
    readonly packageCount: number;
    readonly entryCount: number;
}

interface PluginDiagnosticBundleExportDependencies {
    readonly save: (options: {
        defaultPath: string;
        filters: {
            name: string;
            extensions: string[];
        }[];
    }) => Promise<string | null>;
    readonly writeTextFile: (path: string, contents: string) => Promise<void>;
}

const PLUGIN_ALIAS_PATTERN = /^plugin-[1-9]\d*$/;
const CONTRIBUTION_ALIAS_PATTERN = /^contribution-[1-9]\d*$/;

const assertSupportRedactionProfile = (bundle: SanitizedPluginDiagnosticBundle): void => {
    const hasExpectedEnvelope = bundle.schema === NEMOTO_PLUGIN_DIAGNOSTIC_BUNDLE_SCHEMA
        && bundle.schemaVersion === CURRENT_PLUGIN_DIAGNOSTIC_SCHEMA_VERSION
        && bundle.redaction.profile === 'support-default'
        && bundle.redaction.identifiers === 'aliased'
        && bundle.redaction.context === 'allowlisted';
    const hasOnlyAliasedPluginIds = bundle.packages.every(item => PLUGIN_ALIAS_PATTERN.test(item.pluginId))
        && bundle.entries.every(entry => !entry.pluginId || PLUGIN_ALIAS_PATTERN.test(entry.pluginId));
    const hasOnlyAliasedContributionIds = bundle.entries.every(
        entry => !entry.contributionId || CONTRIBUTION_ALIAS_PATTERN.test(entry.contributionId),
    );

    if (!hasExpectedEnvelope || !hasOnlyAliasedPluginIds || !hasOnlyAliasedContributionIds) {
        throw new Error('The diagnostic bundle does not use the required support redaction profile.');
    }
};

const createSuggestedFileName = (generatedAt: string): string => {
    const safeTimestamp = generatedAt.replace(/[^0-9A-Za-z-]/g, '-');
    return `nemoto-plugin-diagnostics-${safeTimestamp}.json`;
};

export function preparePluginDiagnosticBundleExport(
    bundle: SanitizedPluginDiagnosticBundle,
): PreparedPluginDiagnosticBundleExport {
    assertSupportRedactionProfile(bundle);
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (byteLength > MAX_PLUGIN_DIAGNOSTIC_BUNDLE_EXPORT_BYTES) {
        throw new Error('The diagnostic bundle is too large to preview or export.');
    }

    return Object.freeze({
        json,
        byteLength,
        suggestedFileName: createSuggestedFileName(bundle.generatedAt),
        generatedAt: bundle.generatedAt,
        schemaVersion: bundle.schemaVersion,
        packageCount: bundle.packages.length,
        entryCount: bundle.entries.length,
    });
}

const loadExportDependencies = async (): Promise<PluginDiagnosticBundleExportDependencies> => {
    const [{ save }, { writeTextFile }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/plugin-fs'),
    ]);
    return { save, writeTextFile };
};

export async function writePreparedPluginDiagnosticBundleExport(
    prepared: PreparedPluginDiagnosticBundleExport,
    dependencies?: PluginDiagnosticBundleExportDependencies,
): Promise<boolean> {
    const { save, writeTextFile } = dependencies || await loadExportDependencies();
    const path = await save({
        defaultPath: prepared.suggestedFileName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return false;

    await writeTextFile(path, prepared.json);
    return true;
}
