import JSZip from 'jszip';
import { createPluginCatalog } from './catalog';
import { createDeclarativePluginRuntime } from './declarativeRuntime';
import { parsePluginManifest } from './manifest';
import type { PluginCapability, PluginManifest } from './manifest';
import type { PluginComposedView, PluginCollectionListView } from './contributionSchemas';
import {
    PLUGIN_UI_MINIMUM_HOST_API,
    requiredCapabilitiesForPluginUi,
} from './pluginUiProtocol';
import { satisfiesVersionRange, versionRangeExcludesVersionsBelow } from './versionRange';
import type { InstalledPluginDocument } from './installedPackages';
import {
    MAX_PLUGIN_ENTRY_BYTES,
    MAX_PLUGIN_EXPANDED_BYTES,
    MAX_PLUGIN_PACKAGE_BYTES,
    MAX_PLUGIN_PACKAGE_ENTRIES,
} from './pluginLimits';

export {
    MAX_PLUGIN_ENTRY_BYTES,
    MAX_PLUGIN_EXPANDED_BYTES,
    MAX_PLUGIN_PACKAGE_BYTES,
    MAX_PLUGIN_PACKAGE_ENTRIES,
} from './pluginLimits';
const SUPPORTED_EXTERNAL_CAPABILITIES = new Set([
    'plugin-data.write',
    'portfolio.read-scoped',
    'workspace.navigate',
]);

export {
    requiredCapabilitiesForPluginUi,
    requiredCapabilitiesForPluginUiEffect,
} from './pluginUiProtocol';

export interface ComposedViewAdmission {
    readonly viewId: string;
    readonly operation: string;
    readonly storageViewId: string;
    readonly requiredCapabilities: readonly PluginCapability[];
}

export function validateComposedViewAdmission(
    manifest: PluginManifest,
    views: readonly (PluginComposedView | PluginCollectionListView | { id: string; renderer: string })[],
): ComposedViewAdmission[] {
    const composed = views.filter((view): view is PluginComposedView => view.renderer === 'composed-view');
    if (composed.length === 0) return [];
    if (!manifest.runtime) throw new Error('Composed views require the declared WebAssembly runtime.');
    if (!versionRangeExcludesVersionsBelow(
        manifest.compatibility.axiomPluginApi,
        PLUGIN_UI_MINIMUM_HOST_API,
    ) || !satisfiesVersionRange(PLUGIN_UI_MINIMUM_HOST_API, manifest.compatibility.axiomPluginApi)) {
        throw new Error(`Composed views require a Nemoto plugin API range beginning at ${PLUGIN_UI_MINIMUM_HOST_API}.`);
    }
    const viewsById = new Map(views.map(view => [view.id, view]));
    const operations = new Set<string>();
    return composed.map(view => {
        if (operations.has(view.operation)) throw new Error(`Composed UI operation ${view.operation} is declared more than once.`);
        operations.add(view.operation);
        const storageView = viewsById.get(view.storageViewId);
        if (!storageView || storageView.renderer !== 'collection-list') {
            throw new Error(`Composed view ${view.id} must bind an installed collection-list storage view.`);
        }
        if (!view.storageViewId.startsWith(`${manifest.id}/`)) {
            throw new Error(`Composed view ${view.id} cannot bind another plugin's storage view.`);
        }
        const requiredCapabilities = requiredCapabilitiesForPluginUi(view.ui);
        const missing = requiredCapabilities.find(capability => !manifest.capabilities.includes(capability));
        if (missing) throw new Error(`Composed view ${view.id} requires capability ${missing}.`);
        return Object.freeze({
            viewId: view.id,
            operation: view.operation,
            storageViewId: view.storageViewId,
            requiredCapabilities: Object.freeze(requiredCapabilities),
        });
    });
}
const EXECUTABLE_PACKAGE_EXTENSIONS = new Set([
    'wasm', 'js', 'mjs', 'cjs', 'exe', 'dll', 'com', 'bat', 'cmd', 'ps1', 'sh',
]);

const isExecutablePackagePath = (path: string): boolean => {
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    const extensionSeparator = fileName.lastIndexOf('.');
    if (extensionSeparator < 0) return false;
    return EXECUTABLE_PACKAGE_EXTENSIONS.has(fileName.slice(extensionSeparator + 1).toLowerCase());
};

const safePackagePath = (path: string): boolean => {
    const segments = path.split('/');
    return path.length > 0
        && path.length <= 240
        && !path.startsWith('/')
        && !path.includes('\\')
        && !/^[A-Za-z]:/.test(path)
        && segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
};

const parseJson = (bytes: Uint8Array, path: string): unknown => {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new Error(`${path} is not valid UTF-8 JSON.`);
    }
};

export async function inspectPluginPackage(
    packageBytes: ArrayBuffer | Uint8Array,
    installedAt = new Date().toISOString(),
): Promise<InstalledPluginDocument> {
    const bytes = packageBytes instanceof Uint8Array ? packageBytes : new Uint8Array(packageBytes);
    if (bytes.byteLength === 0) throw new Error('The plugin package is empty.');
    if (bytes.byteLength > MAX_PLUGIN_PACKAGE_BYTES) {
        throw new Error('The plugin package is larger than the 10 MB installation limit.');
    }

    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
    } catch {
        throw new Error('The selected file is not a valid .axiom-plugin package.');
    }

    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length === 0) throw new Error('The plugin package contains no files.');
    if (entries.length > MAX_PLUGIN_PACKAGE_ENTRIES) {
        throw new Error(`A plugin package may contain at most ${MAX_PLUGIN_PACKAGE_ENTRIES} files.`);
    }

    const fileBytes = new Map<string, Uint8Array>();
    let expandedBytes = 0;
    for (const entry of entries) {
        const originalName = entry.unsafeOriginalName || entry.name;
        if (originalName !== entry.name || !safePackagePath(entry.name)) {
            throw new Error(`Plugin package contains unsafe path: ${originalName}.`);
        }
        if (fileBytes.has(entry.name)) throw new Error(`Plugin package contains duplicate path: ${entry.name}.`);

        const content = await entry.async('uint8array');
        if (content.byteLength > MAX_PLUGIN_ENTRY_BYTES) {
            throw new Error(`${entry.name} exceeds the 5 MB per-file limit.`);
        }
        expandedBytes += content.byteLength;
        if (expandedBytes > MAX_PLUGIN_EXPANDED_BYTES) {
            throw new Error('The expanded plugin package exceeds the 25 MB limit.');
        }
        fileBytes.set(entry.name, content);
    }

    const manifestBytes = fileBytes.get('manifest.json');
    if (!manifestBytes) throw new Error('The plugin package is missing manifest.json.');
    const manifest = parsePluginManifest(parseJson(manifestBytes, 'manifest.json'));

    if (manifest.dependencies.length > 0) {
        throw new Error('External plugin dependencies are not supported in this release candidate.');
    }
    const unsupportedCapability = manifest.capabilities.find(
        capability => !SUPPORTED_EXTERNAL_CAPABILITIES.has(capability),
    );
    if (unsupportedCapability) {
        throw new Error(`Capability ${unsupportedCapability} is not available to external plugins in this release candidate.`);
    }

    const executablePath = [...fileBytes.keys()].find(isExecutablePackagePath);
    if (executablePath) {
        throw new Error(`Executable package content is not available to external plugins in this release candidate: ${executablePath}.`);
    }

    const contributions: Record<string, unknown> = {};
    Object.values(manifest.contributes).forEach(references => {
        references?.forEach(reference => {
            const content = fileBytes.get(reference.path);
            if (!content) {
                if (!reference.optional) throw new Error(`Required contribution ${reference.path} is missing.`);
                return;
            }
            contributions[reference.path] = parseJson(content, reference.path);
        });
    });

    const catalogResult = createPluginCatalog([{ manifest, source: 'local' }]);
    if (catalogResult.diagnostics.length > 0) {
        throw new Error(catalogResult.diagnostics[0].message);
    }
    const runtime = createDeclarativePluginRuntime(
        catalogResult.catalog,
        [manifest.id],
        { [manifest.id]: contributions },
    );
    if (runtime.status !== 'ready') {
        throw new Error(runtime.diagnostics[0]?.message || 'The plugin content could not be activated.');
    }
    validateComposedViewAdmission(manifest, runtime.navigationViews);
    if (runtime.navigationViews.some(view => view.renderer === 'collection-list')
        && !manifest.capabilities.includes('plugin-data.write')) {
        throw new Error('Collection list views must declare the plugin-data.write capability.');
    }
    if (runtime.navigationViews.some(view => view.renderer === 'search-results')
        && !manifest.capabilities.includes('portfolio.read-scoped')) {
        throw new Error('Search result views must declare the portfolio.read-scoped capability.');
    }
    if (runtime.navigationViews.some(view => (
        view.renderer === 'search-results' && view.openAction !== undefined
    )) && !manifest.capabilities.includes('workspace.navigate')) {
        throw new Error('Interactive search result views must declare the workspace.navigate capability.');
    }

    return {
        schema: 'axiom.installed-plugin',
        schemaVersion: 1,
        installedAt,
        manifest,
        grantedCapabilities: [...manifest.capabilities],
        approvedInteractiveOperations: [],
        contributions,
    };
}
