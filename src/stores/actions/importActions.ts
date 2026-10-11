import { toast } from 'sonner';
import { generateId } from '../../lib/id';
import {
    JOURNAL_CONTENT_FORMAT,
    JOURNAL_CONTENT_VERSION,
    normalizeJournalContent,
} from '../../lib/journalContent';
import {
    buildMentionHtml,
    normalizeJournalMentions,
    reconcileLinkedContext,
} from '../../lib/journalMentions';
import { listEntityCandidates, normalizeEntityReference } from '../../lib/entityResolver';
import { cloneProcessForMerge, cloneAssetForMerge } from '../../lib/import/merge';
import { canonicalizeResourceReferenceNode, getResourceReferenceAssetId } from '../../lib/resourceReferences';
import type { Portfolio, Process, Asset, AssetCategory, CanvasGraph, ImportedPortfolio } from '../../types';
import type { JournalNotebook, JournalTag, JournalEntry } from '../../types/journal';
import { assertPortfolioIntegrity } from '../../lib/portfolioCodec';
import { mergeContextualRecords, mergeDetachedContextualRecords } from '../../plugins/contextualRecordPortability';
import { PluginDataEnvelopeSchema } from '../../plugins/collectionStorage';
import { mergePortableRecordDocuments, type PluginImportReviewRow } from '../../plugins/portableRecordImport';

interface ImportLogicOptions {
    fullMerge?: boolean;
    pluginReview?: PluginImportReviewRow[];
    notify?: boolean;
    throwOnError?: boolean;
    assetIdMap?: Map<string, string>;
}

export const importProcessLogic = (
    portfolio: Portfolio,
    process: Process,
    source: ImportedPortfolio,
    options: ImportLogicOptions = {},
): { portfolio: Portfolio, result: { processId: string, nodeMap: Map<string, string>, edgeMap?: Map<string, string>, laneMap?: Map<string, string> } } => {
    const { notify = true, throwOnError = false } = options;
    const idMap = {
        processIds: new Map<string, string>(),
        assetIds: new Map(options.assetIdMap),
        nodeIds: new Map<string, string>(),
        edgeIds: new Map<string, string>(),
        swimlaneIds: new Map<string, string>()
    };

    try {
        if (!options.fullMerge && Object.values(source.data.extensions ?? {}).some(raw => {
            const parsed = PluginDataEnvelopeSchema.safeParse(raw);
            return !parsed.success || Object.keys(parsed.data.documents).length > 0;
        })) throw new Error('This source contains plugin documents. Use Merge content to review their references and exclusions.');
        const mergedProcess = cloneProcessForMerge(process, idMap);

        // Resolve Assets
        const requiredAssetIds = new Set<string>();
        if (process.ownerId) requiredAssetIds.add(process.ownerId);
        const collectAssetRefs = (graph: CanvasGraph) => {
            (graph.nodes || []).forEach(node => {
                node.assetIds?.forEach(id => requiredAssetIds.add(id));
                const resourceAssetId = getResourceReferenceAssetId(node);
                if (resourceAssetId) requiredAssetIds.add(resourceAssetId);
                if (node.data?.assetId && typeof node.data.assetId === 'string') {
                    requiredAssetIds.add(node.data.assetId);
                }
                if (Array.isArray(node.data?.assetIds)) {
                    (node.data.assetIds as string[]).forEach(id => requiredAssetIds.add(id));
                }
            });
        };
        collectAssetRefs(process.graph);
        Object.values(process.subGraphs || {}).forEach(collectAssetRefs);
        const requiredAssets = (source.data.assets || []).filter(asset => requiredAssetIds.has(asset.id));

        const importedAssets: Asset[] = [];
        const existingAssets = portfolio.assets;

        requiredAssets.forEach(sourceAsset => {
            if (idMap.assetIds.has(sourceAsset.id)) return;
            const duplicate = existingAssets.find(a =>
                a.name === sourceAsset.name &&
                a.type === sourceAsset.type
            );

            if (duplicate) {
                idMap.assetIds.set(sourceAsset.id, duplicate.id);
            } else {
                const newAsset = cloneAssetForMerge(sourceAsset, idMap);
                importedAssets.push(newAsset);
            }
        });

        // Update asset references in the merged process
        const updateAssetRefs = (graph: CanvasGraph) => {
            (graph.nodes || []).forEach((rawNode, index) => {
                let n = rawNode;
                if (n.assetIds) {
                    n.assetIds = n.assetIds.map(oldId => idMap.assetIds.get(oldId) || oldId);
                }
                if (n.data?.assetId && typeof n.data.assetId === 'string' && idMap.assetIds.has(n.data.assetId)) {
                    n.data = { ...n.data, assetId: idMap.assetIds.get(n.data.assetId) };
                }
                if (Array.isArray(n.data?.assetIds)) {
                    n.data = {
                        ...n.data,
                        assetIds: (n.data.assetIds as string[]).map(oldId => idMap.assetIds.get(oldId) || oldId)
                    };
                }
                const canonicalNode = canonicalizeResourceReferenceNode(n);
                if (canonicalNode !== n) {
                    graph.nodes[index] = canonicalNode;
                }
            });
        };
        updateAssetRefs(mergedProcess.graph);
        Object.values(mergedProcess.subGraphs || {}).forEach(updateAssetRefs);
        if (mergedProcess.ownerId) {
            mergedProcess.ownerId = idMap.assetIds.get(mergedProcess.ownerId) || mergedProcess.ownerId;
        }

        const candidate = mergeContextualRecords({
                ...portfolio,
                processes: [...portfolio.processes, mergedProcess],
                assets: [...portfolio.assets, ...importedAssets]
            }, source.data, process.id, mergedProcess.id, idMap.nodeIds, options.pluginReview);
        if (notify) toast.success(`Imported "${mergedProcess.title}"`);
        return {
            portfolio: candidate,
            result: { processId: mergedProcess.id, nodeMap: idMap.nodeIds, edgeMap: idMap.edgeIds, laneMap: idMap.swimlaneIds }
        };
    } catch (error) {
        if (throwOnError) throw error;
        console.error('[Import] Failed to import process:', error);
        if (notify) toast.error(error instanceof Error ? error.message : 'Failed to import process');
        return { portfolio, result: { processId: '', nodeMap: new Map() } };
    }
};

export const importAssetLogic = (
    portfolio: Portfolio,
    asset: Asset,
    options: ImportLogicOptions = {},
): { portfolio: Portfolio, newAssetId: string } => {
    const { notify = true } = options;
    // Check for duplicates
    const existing = portfolio.assets.find(a => a.name === asset.name && a.type === asset.type);
    if (existing) {
        if (notify) toast.success(`Resource "${asset.name}" already exists, reused.`);
        return { portfolio, newAssetId: existing.id };
    }

    const idMap = {
        processIds: new Map<string, string>(),
        assetIds: new Map<string, string>(),
        nodeIds: new Map<string, string>()
    };
    const newAsset = cloneAssetForMerge(asset, idMap);

    if (notify) toast.success(`Imported resource "${newAsset.name}"`);

    return {
        portfolio: {
            ...portfolio,
            assets: [...portfolio.assets, newAsset]
        },
        newAssetId: newAsset.id
    };
};

export const importAssetCategoryLogic = (
    portfolio: Portfolio,
    category: AssetCategory
): Portfolio => {
    const existing = portfolio.assetCategories.find(c => c.id === category.id);
    if (existing) return portfolio;

    return {
        ...portfolio,
        assetCategories: [...portfolio.assetCategories, category]
    };
};

export const importNotebookLogic = (portfolio: Portfolio, notebook: { id: string, title: string, [key: string]: any }): Portfolio => {
    const currentJournal = portfolio.journal || { notebooks: [], entries: [], folders: [], tags: [] };
    const notebooks = currentJournal.notebooks || [];
    const existing = notebooks.find(nb => nb.title === notebook.title);

    if (existing) return portfolio;

    const newNotebook: JournalNotebook = {
        id: generateId('nb'),
        title: notebook.title,
        folderId: undefined, // Always import to root
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    return {
        ...portfolio,
        journal: {
            ...currentJournal,
            notebooks: [...notebooks, newNotebook],
        }
    };
};

export const importJournalTagLogic = (
    portfolio: Portfolio,
    tag: { id: string, label: string, color: string, [key: string]: any }
): { portfolio: Portfolio, newTagId: string } => {
    const currentJournal = portfolio.journal || { notebooks: [], entries: [], folders: [], tags: [] };
    const tags = currentJournal.tags || [];

    const existing = tags.find(t => t.label.toLowerCase() === tag.label.toLowerCase());
    if (existing) return { portfolio, newTagId: existing.id };

    const newTag: JournalTag = {
        id: generateId('tag'),
        label: tag.label,
        color: tag.color,
        archived: false
    };

    return {
        portfolio: {
            ...portfolio,
            journal: {
                ...currentJournal,
                tags: [...tags, newTag]
            }
        },
        newTagId: newTag.id
    };
};

export const importJournalEntryLogic = (
    portfolio: Portfolio,
    entry: JournalEntry,
    source: ImportedPortfolio | undefined
): Portfolio => {
    const currentJournal = portfolio.journal || { notebooks: [], entries: [], folders: [], tags: [] };

    // 1. Ensure Notebook Exists
    let targetNotebookId = entry.notebookId;
    const notebooks = [...(currentJournal.notebooks || [])];
    let notebook = notebooks.find(nb => nb.id === targetNotebookId);

    if (!notebook) {
        const quickNotes = notebooks.find(nb => nb.title === 'Quick Notes');
        if (quickNotes) {
            targetNotebookId = quickNotes.id;
        } else if (notebooks.length > 0) {
            targetNotebookId = notebooks[0].id;
        } else {
            const newNotebook = {
                id: generateId('nb'),
                title: 'Quick Notes',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            notebooks.push(newNotebook);
            targetNotebookId = newNotebook.id;
        }
    }
    currentJournal.notebooks = notebooks;

    // 1.5. Remap Tags
    let remappedTags = entry.tags || [];
    if (source && entry.tags) {
        const sourceTags = source.data.journal?.tags || [];
        const updatedTags = [...(currentJournal.tags || [])];

        remappedTags = entry.tags.map((oldId: string) => {
            const sourceTag = sourceTags.find(t => t.id === oldId);
            if (!sourceTag) return oldId;

            const existing = updatedTags.find(t => t.label.toLowerCase() === sourceTag.label.toLowerCase());
            if (existing) return existing.id;

            const newTag = {
                ...sourceTag,
                id: generateId('tag'),
                archived: false
            };
            updatedTags.push(newTag);
            return newTag.id;
        });
        currentJournal.tags = updatedTags;
    }

    // 2. Prepare new entry
    const existingLinks = entry.linkedContext || [];
    const newEntry = {
        ...entry,
        id: generateId('je'),
        notebookId: targetNotebookId,
        tags: remappedTags,
        linkedContext: [...existingLinks]
    };

    // 3. Scan content for mentions
    const linkedIds = new Set(newEntry.linkedContext.map((c: any) => c.id));
    newEntry.content = (newEntry.content || '').replace(/@\[(.*?)\]/g, (match: string, name: string) => {
        let found = portfolio.assets.find(a => a.name === name || a.name === `${name} (Imported)`);
        let contextType = 'asset';
        let id = found?.id;
        let label = found?.name;

        if (!found) {
            let p = portfolio.processes.find(p => p.title === name);
            if (p) {
                found = p as any;
                contextType = 'process';
                id = p.id;
                label = p.title;
            } else {
                const nodeCandidate = listEntityCandidates(portfolio, ['node'])
                    .find(candidate => candidate.label === name);
                if (nodeCandidate) {
                    found = nodeCandidate as any;
                    contextType = 'node';
                    id = nodeCandidate.reference.id;
                    label = nodeCandidate.label;
                }
            }
        }

        if (found && id && label) {
            const reference = normalizeEntityReference({
                id,
                type: contextType,
                source: 'inline',
            }, portfolio);
            if (!linkedIds.has(id)) {
                newEntry.linkedContext.push(reference);
                linkedIds.add(id);
            }
            return buildMentionHtml(reference, label);
        }
        return match;
    });
    newEntry.content = normalizeJournalContent(newEntry.content);
    const mentionState = normalizeJournalMentions(newEntry.content, portfolio);
    newEntry.content = mentionState.content;
    newEntry.linkedContext = reconcileLinkedContext(
        newEntry.linkedContext,
        mentionState.inlineReferences,
        portfolio,
    );
    newEntry.contentFormat = JOURNAL_CONTENT_FORMAT;
    newEntry.contentVersion = JOURNAL_CONTENT_VERSION;

    return {
        ...portfolio,
        journal: {
            ...currentJournal,
            entries: [...(currentJournal.entries || []), newEntry]
        }
    };
};

export interface MergeImportedPortfolioResult {
    portfolio: Portfolio;
    mergedItemCount: number;
    pluginReview: PluginImportReviewRow[];
}

/**
 * Builds a complete merge in isolated memory. The caller commits the returned
 * portfolio with one store update, so a failure cannot leave a partial import.
 */
export const mergeImportedPortfolioLogic = (
    currentPortfolio: Portfolio,
    source: ImportedPortfolio,
): MergeImportedPortfolioResult => {
    assertPortfolioIntegrity(source.data);
    let portfolio = structuredClone(currentPortfolio);
    const notebookIdMap = new Map<string, string>();
    const processIdMap = new Map<string, string>();
    const nodeIdMap = new Map<string, string>();
    const assetIdMap = new Map<string, string>();
    const edgeIdMap = new Map<string, string>();
    const laneIdMap = new Map<string, string>();
    const entryIdMap = new Map<string, string>();
    const pluginReview: PluginImportReviewRow[] = [];
    // Unknown namespaces remain in the source and are explicitly reported below.
    const contextualSource = { ...source, data: { ...source.data, extensions: Object.fromEntries(
        Object.entries(source.data.extensions ?? {}).filter(([, raw]) => PluginDataEnvelopeSchema.safeParse(raw).success),
    ) } };

    for (const category of source.data.assetCategories || []) {
        portfolio = importAssetCategoryLogic(portfolio, structuredClone(category));
    }

    for (const notebook of source.data.journal?.notebooks || []) {
        const existing = portfolio.journal?.notebooks?.find(item => item.title === notebook.title);
        if (existing) {
            notebookIdMap.set(notebook.id, existing.id);
            continue;
        }

        portfolio = importNotebookLogic(portfolio, notebook);
        const created = portfolio.journal?.notebooks?.find(item => item.title === notebook.title);
        if (!created) throw new Error(`Could not create notebook "${notebook.title}"`);
        notebookIdMap.set(notebook.id, created.id);
    }

    const assetMatchKey = (asset: Pick<Asset, 'name' | 'type'>) => `${asset.type}\u0000${asset.name}`;
    const assetsByMatchKey = new Map(portfolio.assets.map(asset => [assetMatchKey(asset), asset]));
    const createdAssetIds = new Set<string>();

    for (const asset of source.data.assets || []) {
        const existing = assetsByMatchKey.get(assetMatchKey(asset));
        if (existing) {
            assetIdMap.set(asset.id, existing.id);
            continue;
        }

        const newAsset = cloneAssetForMerge(asset, {
            processIds: new Map(),
            assetIds: assetIdMap,
            nodeIds: new Map(),
        });
        portfolio.assets.push(newAsset);
        assetsByMatchKey.set(assetMatchKey(asset), newAsset);
        createdAssetIds.add(newAsset.id);
    }

    if (createdAssetIds.size > 0) {
        portfolio.assets = portfolio.assets.map(asset => {
            if (!createdAssetIds.has(asset.id) || !asset.parentId) return asset;
            return {
                ...asset,
                parentId: assetIdMap.get(asset.parentId) || asset.parentId,
            };
        });
    }

    for (const process of source.data.processes || []) {
        const result = importProcessLogic(portfolio, process, contextualSource, {
            fullMerge: true,
            pluginReview,
            notify: false,
            throwOnError: true,
            assetIdMap,
        });
        if (!result.result.processId) throw new Error(`Could not merge process "${process.title}"`);

        portfolio = result.portfolio;
        processIdMap.set(process.id, result.result.processId);
        result.result.nodeMap.forEach((newId, oldId) => nodeIdMap.set(oldId, newId));
        result.result.edgeMap?.forEach((newId, oldId) => edgeIdMap.set(oldId, newId));
        result.result.laneMap?.forEach((newId, oldId) => laneIdMap.set(oldId, newId));
    }

    const processTitleMap = new Map(
        (source.data.processes || []).map(process => [process.id, process.title]),
    );

    for (const entry of source.data.journal?.entries || []) {
        const remappedEntry = structuredClone(entry);
        if (remappedEntry.notebookId && notebookIdMap.has(remappedEntry.notebookId)) {
            remappedEntry.notebookId = notebookIdMap.get(remappedEntry.notebookId)!;
        } else if (!remappedEntry.notebookId && notebookIdMap.size === 1) {
            remappedEntry.notebookId = notebookIdMap.values().next().value!;
        }

        remappedEntry.linkedContext = (remappedEntry.linkedContext || []).map(context => {
            const oldId = context.id;
            let newId = oldId;

            if (context.type === 'asset' && assetIdMap.has(oldId)) {
                newId = assetIdMap.get(oldId)!;
            } else if (context.type === 'process' && processIdMap.has(oldId)) {
                newId = processIdMap.get(oldId)!;
            } else if (context.type === 'node' && nodeIdMap.has(oldId)) {
                newId = nodeIdMap.get(oldId)!;
            } else if (context.type === 'process') {
                const title = processTitleMap.get(oldId);
                const existing = portfolio.processes.find(process => process.title === title || process.id === oldId);
                if (existing) newId = existing.id;
            }

            return { ...context, id: newId };
        });

        portfolio = importJournalEntryLogic(portfolio, remappedEntry, source);
        entryIdMap.set(entry.id, portfolio.journal.entries[portfolio.journal.entries.length - 1].id);
    }

    portfolio = mergeDetachedContextualRecords(portfolio, contextualSource.data, processIdMap, nodeIdMap, pluginReview);
    portfolio = mergePortableRecordDocuments(portfolio, source.data, new Map([
        ['core.process', processIdMap], ['core.node', nodeIdMap], ['core.edge', edgeIdMap],
        ['core.swimlane', laneIdMap], ['core.asset', assetIdMap], ['core.journal-entry', entryIdMap],
        ['core.journal-notebook', notebookIdMap],
    ]), pluginReview);
    assertPortfolioIntegrity(portfolio);
    return {
        portfolio,
        pluginReview,
        mergedItemCount: (source.data.processes || []).length
            + (source.data.assets || []).length
            + (source.data.journal?.entries || []).length,
    };
};
