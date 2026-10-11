import { useMemo } from 'react';
import { create } from 'zustand';
import { usePluginStore } from '../../stores/usePluginStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import {
    createActivePluginRuntime,
    resolveActiveComposedViewAuthority,
    type ActiveComposedViewAuthority,
} from '../../plugins/activeRuntime';
import { readPluginCollection } from '../../plugins/collectionStorage';
import { PluginViewContributionSchema, type PluginCollectionListView } from '../../plugins/contributionSchemas';
import type { InstalledPluginDocument } from '../../plugins/installedPackages';
import type { PortfolioPluginRequirement } from '../../plugins/portfolioData';
import { AXIOM_PLUGIN_API_VERSION } from '../../plugins/activation';
import { satisfiesVersionRange } from '../../plugins/versionRange';
import type { UniversalEntityReference } from '../../plugins/universalReference';
import { coreEntityReference } from '../../plugins/universalReference';
import type { Portfolio } from '../../types';

export type LegacyCanvasPluginAction = {
    readonly kind: 'legacy-contextual';
    readonly pluginId: string;
    readonly label: string;
    readonly storageView: PluginCollectionListView;
};

export type ComposedCanvasPluginAction = {
    readonly kind: 'composed-view';
    readonly pluginId: string;
    readonly label: string;
    readonly storageView: PluginCollectionListView;
    readonly authority: ActiveComposedViewAuthority;
};

export type CanvasPluginAction = LegacyCanvasPluginAction | ComposedCanvasPluginAction;

export type LegacyCapture = {
    readonly kind: 'legacy-contextual';
    readonly pluginId: string;
    readonly view: PluginCollectionListView;
    readonly nodeId: string;
    readonly processId: string;
};

export type ComposedCapture = {
    readonly kind: 'composed-view';
    readonly action: ComposedCanvasPluginAction;
    readonly reference: UniversalEntityReference;
    readonly processId: string;
};

export type Capture = LegacyCapture | ComposedCapture;
export const useRecordCapture = create<{ capture: Capture | null }>(() => ({ capture: null }));

export function createCanvasPluginCapture(
    action: CanvasPluginAction,
    nodeId: string,
    processId: string,
    graphPath: readonly string[],
): Capture {
    return action.kind === 'composed-view' ? {
        kind: 'composed-view',
        action,
        reference: coreEntityReference('core.node', nodeId, {
            processId,
            graphPath: [...graphPath],
        }),
        processId,
    } : {
        kind: 'legacy-contextual',
        pluginId: action.pluginId,
        view: action.storageView,
        nodeId,
        processId,
    };
}

const activeDocument = (
    document: InstalledPluginDocument,
    requirements: readonly PortfolioPluginRequirement[],
    hostApiVersion: string,
) => {
    const matching = requirements.filter(requirement => requirement.pluginId === document.manifest.id);
    return matching.length === 1
        && matching[0].activation === 'active'
        && satisfiesVersionRange(document.manifest.version, matching[0].version)
        && matching[0].dataVersion === document.manifest.dataVersion
        && satisfiesVersionRange(hostApiVersion, document.manifest.compatibility.axiomPluginApi);
};

/** One composed view replaces, rather than duplicates, its legacy capture action. */
export function resolveCanvasPluginActions(
    installed: readonly InstalledPluginDocument[],
    requirements: readonly PortfolioPluginRequirement[],
    hostApiVersion = AXIOM_PLUGIN_API_VERSION,
): CanvasPluginAction[] {
    const actions: CanvasPluginAction[] = [];
    const activeViews = hostApiVersion === AXIOM_PLUGIN_API_VERSION
        ? createActivePluginRuntime(installed, requirements).content.list('views')
        : null;
    for (const document of installed) {
        if (!activeDocument(document, requirements, hostApiVersion)) continue;
        const references = document.manifest.contributes.views ?? [];
        const views = activeViews
            ? activeViews
                .filter(entry => entry.registration.pluginId === document.manifest.id)
                .map(entry => entry.payload)
            : references.flatMap(reference => {
                const parsed = PluginViewContributionSchema.safeParse(document.contributions[reference.path]);
                return parsed.success && parsed.data.id === reference.id ? [parsed.data] : [];
            });
        if (!activeViews && views.length !== references.length) continue;
        const contextual = views.filter((view): view is PluginCollectionListView => (
            view.renderer === 'collection-list' && !!view.contextual
        ));
        for (const storageView of contextual) {
            const composedViews = views.filter(view => (
                view.renderer === 'composed-view' && view.storageViewId === storageView.id
            ));
            const candidates = composedViews.flatMap(view => {
                if (view.renderer !== 'composed-view') return [];
                const authority = resolveActiveComposedViewAuthority(
                    installed, requirements, view.id, hostApiVersion,
                );
                return authority ? [authority] : [];
            });
            if (composedViews.length > 0 && candidates.length !== 1) continue;
            actions.push(candidates.length === 1 ? {
                kind: 'composed-view',
                pluginId: document.manifest.id,
                label: storageView.contextual!.quickAddLabel,
                storageView,
                authority: candidates[0],
            } : {
                kind: 'legacy-contextual',
                pluginId: document.manifest.id,
                label: storageView.contextual!.quickAddLabel,
                storageView,
            });
        }
    }
    return actions.sort((left, right) => left.label.localeCompare(right.label)
        || left.pluginId.localeCompare(right.pluginId));
}

/** Core adapter discovers contributions; it has no knowledge of a product/plugin ID. */
export function useContextualContributions() {
    const installed = usePluginStore(state => state.installed);
    const requirements = usePortfolioStore(state => state.portfolio.plugins?.requirements);
    return useMemo(() => createActivePluginRuntime(installed, requirements ?? []).content.list('views')
        .flatMap(entry => entry.payload.renderer === 'collection-list' && entry.payload.contextual
            ? [{ pluginId: entry.registration.pluginId, view: entry.payload }] : []), [installed, requirements]);
}

export type ContextualContribution = ReturnType<typeof useContextualContributions>[number];

export type CanvasRecordIndicator = {
    readonly key: string;
    readonly count: number;
    readonly icon: PluginCollectionListView['navigation']['icon'];
    readonly singularLabel: string;
    readonly pluralLabel: string;
};

// Immutable namespace identity invalidates indexes on edits/import/restore.
// Weak ownership releases old Portfolio data; bounded rules prevent package
// replacements from growing the cache while a namespace remains unchanged.
const indicatorIndexes = new WeakMap<object, Map<string, ReadonlyMap<string, number>>>();
function indicatorIndex(portfolio: Portfolio, pluginId: string, view: PluginCollectionListView) {
    const declaration = view.contextual!.indicator!;
    const namespace = portfolio.extensions?.[pluginId];
    if (!namespace || typeof namespace !== 'object') return new Map<string, number>();
    let indexes = indicatorIndexes.get(namespace);
    if (!indexes) { indexes = new Map(); indicatorIndexes.set(namespace, indexes); }
    const key = JSON.stringify([view.collection.id, declaration.referenceKind, declaration.where]);
    const cached = indexes.get(key);
    if (cached) return cached;
    const counts = new Map<string, number>();
    for (const item of readPluginCollection(portfolio, pluginId, view.collection.id).items) {
        const reference = item.details?.context?.reference;
        if (!reference || reference.kind !== declaration.referenceKind
            || item.values[declaration.where.field] !== declaration.where.equals) continue;
        const referenceKey = `${reference.kind}\u0000${reference.id}`;
        counts.set(referenceKey, (counts.get(referenceKey) ?? 0) + 1);
    }
    if (indexes.size >= 32) indexes.delete(indexes.keys().next().value!);
    indexes.set(key, counts);
    return counts;
}

/**
 * Index package-declared rules once per immutable namespace/rule, then project
 * only visible references. Viewport changes do no collection scan.
 */
export function deriveCanvasRecordIndicators(
    portfolio: Portfolio,
    contributions: readonly ContextualContribution[],
    visibleReferences: readonly UniversalEntityReference[],
) {
    const visible = new Map(visibleReferences.map(reference => [`${reference.kind}\u0000${reference.id}`, reference]));
    const indicators = new Map<string, CanvasRecordIndicator[]>();
    if (visible.size === 0) return indicators;

    for (const { pluginId, view } of contributions) {
        const declaration = view.contextual?.indicator;
        if (!declaration) continue;
        const counts = indicatorIndex(portfolio, pluginId, view);
        for (const [referenceKey, reference] of visible) {
            const count = counts.get(referenceKey);
            if (!count) continue;
            const nodeId = reference.id;
            const current = indicators.get(nodeId) ?? [];
            current.push({
                key: `${pluginId}\u0000${view.id}`,
                count,
                icon: declaration.icon,
                singularLabel: declaration.label.singular,
                pluralLabel: declaration.label.plural,
            });
            indicators.set(nodeId, current);
        }
    }
    return indicators;
}

export function useCanvasPluginActions() {
    const installed = usePluginStore(state => state.installed);
    const requirements = usePortfolioStore(state => state.portfolio.plugins?.requirements);
    return useMemo(
        () => resolveCanvasPluginActions(installed, requirements ?? []),
        [installed, requirements],
    );
}

export function useCanvasRecordIndicators(
    visibleReferences: readonly UniversalEntityReference[],
    enabled: boolean,
) {
    const contributions = useContextualContributions();
    const extensions = usePortfolioStore(state => state.portfolio.extensions);
    return useMemo(() => {
        if (!enabled) return new Map<string, CanvasRecordIndicator[]>();
        return deriveCanvasRecordIndicators(
            usePortfolioStore.getState().portfolio,
            contributions,
            visibleReferences,
        );
    }, [contributions, enabled, extensions, visibleReferences]);
}
