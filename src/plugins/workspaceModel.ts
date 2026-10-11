import type { Portfolio } from '../types';
import { AXIOM_PLUGIN_API_VERSION } from './activation';
import { CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION } from './contributionSchemas';
import { createPluginEntitySnapshot } from './entityReadModel';
import {
    findGraphEntityLocation,
    graphLocationHint,
} from './graphLocations';
import type { InstalledPluginDocument } from './installedPackages';
import { PluginCapabilitySchema } from './manifest';
import { CoreEntityKindSchema, coreEntityReference } from './universalReference';
import {
    MAX_PLUGIN_WORKSPACE_SELECTIONS,
    PLUGIN_KNOWN_CORE_RELATION_KINDS,
    PLUGIN_NAVIGABLE_CORE_ENTITY_KINDS,
    PluginHostDescriptorSchema,
    PluginNavigationResultSchema,
    PluginWorkspaceContextSchema,
    parsePluginNavigationIntent,
    type PluginHostDescriptor,
    type PluginNavigationResult,
    type PluginWorkspaceContext,
    type PluginWorkspaceSurface,
} from './workspaceContracts';
import type { UniversalEntityReference } from './universalReference';

const AVAILABLE_PUBLIC_CAPABILITIES = new Set([
    'portfolio.read-scoped',
    'proposal.create',
    'plugin-data.write',
    'plugin-device-settings.write',
    'plugin-secrets.use',
    'workspace.navigate',
]);

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

export const createPluginHostDescriptor = (
    document: InstalledPluginDocument,
): PluginHostDescriptor => {
    const declared = new Set<string>(document.manifest.capabilities);
    const granted = new Set<string>(document.grantedCapabilities);
    return deepFreeze(PluginHostDescriptorSchema.parse({
        schema: 'axiom.plugin-host-descriptor',
        schemaVersion: 1,
        hostApiVersion: AXIOM_PLUGIN_API_VERSION,
        contracts: {
            entityReference: [1],
            entityRead: [1],
            relationQuery: [1],
            storage: [1],
            proposal: [1, 2, 3],
            contribution: [CURRENT_PLUGIN_CONTRIBUTION_SCHEMA_VERSION],
            workspace: [1],
            deviceStorage: [1],
            runtimeTransport: [1],
            composedUi: [1],
            portableRecord: [1],
        },
        capabilities: PluginCapabilitySchema.options.map(id => {
            const available = AVAILABLE_PUBLIC_CAPABILITIES.has(id);
            const isDeclared = declared.has(id);
            const isGranted = granted.has(id);
            return {
                id,
                available,
                declared: isDeclared,
                granted: isGranted,
                effective: available && isDeclared && isGranted,
            };
        }),
        coreEntityKinds: [...CoreEntityKindSchema.options],
        coreRelationKinds: [...PLUGIN_KNOWN_CORE_RELATION_KINDS],
        supportedContributionFamilies: [
            'vocabularies',
            'questionSets',
            'templates',
            'aiProfiles',
            'views',
            'commands',
        ],
        storageScopes: ['portfolio'],
        navigation: {
            capability: 'workspace.navigate',
            actions: ['reveal', 'inspect'],
            coreEntityKinds: [...PLUGIN_NAVIGABLE_CORE_ENTITY_KINDS],
        },
        deviceStorage: {
            settingsCapability: 'plugin-device-settings.write',
            secretsCapability: 'plugin-secrets.use',
            settingsScope: 'device-settings',
            secretsScope: 'device-secrets',
            secretsProvider: 'os-credential-store',
            exportedWithPortfolio: false,
            backedUpByAxiom: false,
        },
    }));
};

export interface PluginWorkspaceContextSource {
    readonly activeView: string;
    readonly activeProcessId: string | null;
    readonly selectedNodeIds?: readonly string[];
    readonly selectedEdgeIds?: readonly string[];
    readonly selectedAssetId?: string | null;
    readonly selectedSwimlaneId?: string | null;
    readonly selectedJournalEntryId?: string | null;
    readonly journalPanelExpanded?: boolean;
    readonly rightPanelMode?: 'inspector' | 'journal';
    readonly explicitSelections?: readonly UniversalEntityReference[];
}

const workspaceSurface = (activeView: string): PluginWorkspaceSurface => {
    if (activeView === 'designer' || activeView === 'journal' || activeView === 'dependency') {
        return activeView;
    }
    if (activeView.includes('/')) return 'plugin-view';
    return 'other';
};

export function createPluginWorkspaceContext(
    portfolio: Portfolio,
    pluginId: string,
    source: PluginWorkspaceContextSource,
    portfolioRevision: number,
): PluginWorkspaceContext {
    const selections: UniversalEntityReference[] = [];
    let selectionOverflow = false;
    const add = (reference: UniversalEntityReference | null): void => {
        if (!reference || selections.some(candidate => (
            candidate.kind === reference.kind && candidate.id === reference.id
        ))) return;
        if (selections.length >= MAX_PLUGIN_WORKSPACE_SELECTIONS) {
            selectionOverflow = true;
            return;
        }
        selections.push(reference);
    };
    const canonical = (reference: UniversalEntityReference): UniversalEntityReference | null => (
        createPluginEntitySnapshot(portfolio, reference, portfolioRevision)?.reference || null
    );

    if (source.explicitSelections) {
        source.explicitSelections.forEach(reference => add(canonical(reference)));
    } else if (source.activeView === 'designer' || source.activeView.startsWith(`${pluginId}/`)) {
        const asset = source.selectedAssetId && portfolio.assets.some(value => value.id === source.selectedAssetId)
            ? coreEntityReference('core.asset', source.selectedAssetId)
            : null;
        add(asset);
        if (!asset && source.selectedSwimlaneId) {
            const located = findGraphEntityLocation(
                portfolio,
                'core.swimlane',
                source.selectedSwimlaneId,
                source.activeProcessId || undefined,
            );
            add(located ? coreEntityReference(
                'core.swimlane',
                source.selectedSwimlaneId,
                graphLocationHint(located),
            ) : null);
        }
        if (!asset && !source.selectedSwimlaneId) {
            source.selectedNodeIds?.forEach(id => {
                const located = findGraphEntityLocation(
                    portfolio,
                    'core.node',
                    id,
                    source.activeProcessId || undefined,
                );
                add(located ? coreEntityReference('core.node', id, graphLocationHint(located)) : null);
            });
            source.selectedEdgeIds?.forEach(id => {
                const located = findGraphEntityLocation(
                    portfolio,
                    'core.edge',
                    id,
                    source.activeProcessId || undefined,
                );
                add(located ? coreEntityReference('core.edge', id, graphLocationHint(located)) : null);
            });
        }
    }

    let journalReference: UniversalEntityReference | null = null;
    if (
        source.selectedJournalEntryId
        && (source.activeView === 'journal' || source.journalPanelExpanded)
        && portfolio.journal.entries.some(entry => entry.id === source.selectedJournalEntryId)
    ) {
        journalReference = coreEntityReference('core.journal-entry', source.selectedJournalEntryId);
        add(journalReference);
    }

    const activeProcess = source.activeProcessId
        && portfolio.processes.some(process => process.id === source.activeProcessId)
        ? coreEntityReference('core.process', source.activeProcessId)
        : null;
    const truncated = selectionOverflow;
    const boundedSelections = selections;
    const primarySelection = source.rightPanelMode === 'journal' && journalReference
        ? journalReference
        : boundedSelections[0] || null;
    const surface = workspaceSurface(source.activeView);
    const activeContributionId = surface === 'plugin-view'
        && source.activeView.startsWith(`${pluginId}/`)
        ? source.activeView
        : undefined;

    return deepFreeze(PluginWorkspaceContextSchema.parse({
        schema: 'axiom.plugin-workspace-context',
        schemaVersion: 1,
        portfolioRevision,
        surface,
        ...(activeContributionId ? { activeContributionId } : {}),
        activeProcess,
        primarySelection,
        selections: boundedSelections,
        truncated,
    }));
}

export function resolvePluginNavigationIntent(
    portfolio: Portfolio,
    input: unknown,
): PluginNavigationResult {
    const intent = parsePluginNavigationIntent(input);
    if (!PLUGIN_NAVIGABLE_CORE_ENTITY_KINDS.includes(
        intent.reference.kind as typeof PLUGIN_NAVIGABLE_CORE_ENTITY_KINDS[number],
    )) {
        return deepFreeze(PluginNavigationResultSchema.parse({
            schema: 'axiom.plugin-navigation-result',
            schemaVersion: 1,
            status: 'unsupported',
            reference: intent.reference,
        }));
    }
    const snapshot = createPluginEntitySnapshot(portfolio, intent.reference, 0);
    if (!snapshot) {
        return deepFreeze(PluginNavigationResultSchema.parse({
            schema: 'axiom.plugin-navigation-result',
            schemaVersion: 1,
            status: 'not-found',
            reference: intent.reference,
        }));
    }
    if (
        (snapshot.reference.kind === 'core.node'
            || snapshot.reference.kind === 'core.edge'
            || snapshot.reference.kind === 'core.swimlane')
        && !findGraphEntityLocation(
            portfolio,
            snapshot.reference.kind,
            snapshot.reference.id,
            snapshot.reference.location?.processId,
        )?.graphPath
    ) {
        return deepFreeze(PluginNavigationResultSchema.parse({
            schema: 'axiom.plugin-navigation-result',
            schemaVersion: 1,
            status: 'unsupported',
            reference: snapshot.reference,
        }));
    }
    return deepFreeze(PluginNavigationResultSchema.parse({
        schema: 'axiom.plugin-navigation-result',
        schemaVersion: 1,
        status: 'opened',
        reference: snapshot.reference,
    }));
}
