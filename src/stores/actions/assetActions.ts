import type { Portfolio, Asset, AssetCategory, CanvasGraph } from '../../types';
import { generateId } from '../../lib/id';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';

export const setAssetsLogic = (portfolio: Portfolio, assets: Asset[]): Portfolio => ({
    ...portfolio,
    assets
});

export const addAssetLogic = (portfolio: Portfolio, asset: Asset): Portfolio => ({
    ...portfolio,
    assets: [...portfolio.assets, asset]
});

export const importResourcesLogic = (portfolio: Portfolio, resources: readonly Asset[]): Portfolio => {
    if (resources.length === 0) return portfolio;
    const categoryIds = new Set((portfolio.assetCategories || []).map(category => category.id));
    const ids = new Set((portfolio.assets || []).map(asset => asset.id));
    resources.forEach(resource => {
        if (!resource.id || ids.has(resource.id)) {
            throw new Error(`Resource import contains a duplicate ID: ${resource.id || '(empty)'}.`);
        }
        if (!resource.name.trim()) throw new Error('Resource import contains an empty name.');
        if (!categoryIds.has(resource.type)) {
            throw new Error(`Resource import references an unknown category: ${resource.type}.`);
        }
        ids.add(resource.id);
    });
    return {
        ...portfolio,
        assets: [...portfolio.assets, ...resources],
    };
};

export const updateAssetLogic = (portfolio: Portfolio, id: string, updates: Partial<Asset>): Portfolio => ({
    ...portfolio,
    assets: portfolio.assets.map(a => a.id === id ? { ...a, ...updates } : a)
});

export const purgeAssetsLogic = (portfolio: Portfolio, ids: string[]): Portfolio => {
    const idsToDelete = new Set(ids);

    // Helper to clean a graph's nodes and edges
    const cleanGraph = (graph: CanvasGraph): CanvasGraph => {
        const remainingNodes = (graph.nodes || [])
            .filter(n => {
                if (n.type === 'resource') {
                    const nodeAssetId = getResourceReferenceAssetId(n);
                    if (nodeAssetId && idsToDelete.has(nodeAssetId)) return false;
                }
                return true;
            })
            .map(n => ({
                ...n,
                assetIds: (n.assetIds || []).filter(aid => !idsToDelete.has(aid))
            }));

        const remainingNodeIds = new Set(remainingNodes.map(n => n.id));
        const remainingEdges = (graph.edges || []).filter(
            e => remainingNodeIds.has(e.sourceId) && remainingNodeIds.has(e.targetId)
        );

        return {
            ...graph,
            nodes: remainingNodes,
            edges: remainingEdges,
        };
    };

    // 1. Clean Processes
    const newProcesses = (portfolio.processes || []).map(p => {
        const newSubGraphs: Record<string, CanvasGraph> = {};
        if (p.subGraphs) {
            Object.entries(p.subGraphs).forEach(([sgId, sgGraph]) => {
                newSubGraphs[sgId] = cleanGraph(sgGraph);
            });
        }
        return {
            ...p,
            ownerId: p.ownerId && idsToDelete.has(p.ownerId) ? null : p.ownerId,
            graph: p.graph ? cleanGraph(p.graph) : p.graph,
            subGraphs: newSubGraphs
        };
    });

    // 2. Clean Journal
    const newJournal = portfolio.journal ? {
        ...portfolio.journal,
        entries: (portfolio.journal.entries || []).map(e => ({
            ...e,
            linkedContext: (e.linkedContext || []).filter(ctx => !idsToDelete.has(ctx.id))
        }))
    } : portfolio.journal;

    // 3. Delete Assets
    const newAssets = (portfolio.assets || [])
        .filter(a => !idsToDelete.has(a.id))
        .map(asset => asset.parentId && idsToDelete.has(asset.parentId)
            ? { ...asset, parentId: null }
            : asset);

    return {
        ...portfolio,
        processes: newProcesses,
        journal: newJournal!,
        assets: newAssets
    };
};

export const purgeAssetLogic = (portfolio: Portfolio, id: string): Portfolio =>
    purgeAssetsLogic(portfolio, [id]);

export const deleteAssetsLogic = (portfolio: Portfolio, ids: string[]): Portfolio =>
    purgeAssetsLogic(portfolio, ids);

export const duplicateAssetLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const original = portfolio.assets.find(a => a.id === id);
    if (!original) return portfolio;

    const newAsset: Asset = {
        ...structuredClone(original),
        id: generateId('asset'),
        name: `${original.name} (Copy)`
    };

    return {
        ...portfolio,
        assets: [...portfolio.assets, newAsset]
    };
};

export const addAssetCategoryLogic = (portfolio: Portfolio, category: AssetCategory): Portfolio => ({
    ...portfolio,
    assetCategories: [...(portfolio.assetCategories || []), category]
});

export const updateAssetCategoryLogic = (portfolio: Portfolio, id: string, updates: Partial<AssetCategory>): Portfolio => ({
    ...portfolio,
    assetCategories: (portfolio.assetCategories || []).map(c =>
        c.id === id ? { ...c, ...updates } : c
    )
});

export const deleteAssetCategoryLogic = (portfolio: Portfolio, id: string): Portfolio => {
    const categoryIsUsed = portfolio.assets.some(asset => asset.type === id);
    const uncategorizedId = 'uncategorized';
    const remainingCategories = (portfolio.assetCategories || []).filter(category => category.id !== id);
    const hasUncategorized = remainingCategories.some(category => category.id === uncategorizedId);

    return {
        ...portfolio,
        assets: categoryIsUsed
            ? portfolio.assets.map(asset => asset.type === id ? { ...asset, type: uncategorizedId } : asset)
            : portfolio.assets,
        assetCategories: categoryIsUsed && !hasUncategorized
            ? [
                ...remainingCategories,
                {
                    id: uncategorizedId,
                    label: 'Uncategorized',
                    icon: 'Box',
                    color: 'gray',
                    baseType: 'custom',
                },
            ]
            : remainingCategories,
    };
};
