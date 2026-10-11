import { getResourceReferenceAssetId } from '../lib/resourceReferences';
import type {
    Asset,
    AssetCategory,
    CanvasEdge,
    CanvasGraph,
    CanvasNode,
    Portfolio,
    Process,
    Swimlane,
    ThemeConfig,
} from '../types';
import type {
    EntityReference,
    JournalEntry,
    JournalFolder,
    JournalNotebook,
    JournalTag,
} from '../types/journal';

export interface SharedProcessExportSummary {
    includedAssets: number;
    includedJournalEntries: number;
    excludedInternalJournalEntries: number;
}

export interface SharedProcessProjection {
    portfolio: Portfolio;
    summary: SharedProcessExportSummary;
}

const CORE_NODE_DATA_KEYS = [
    'assetId',
    'assetIds',
    'color',
    'description',
    'eyebrow',
    'rotation',
] as const;

function projectNodeData(
    data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
    if (!data) return undefined;

    const projected: Record<string, unknown> = {};
    CORE_NODE_DATA_KEYS.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(data, key)) projected[key] = data[key];
    });
    return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectNode(node: CanvasNode): CanvasNode {
    const legacyColor = (node as CanvasNode & { color?: unknown }).color;
    const projectedData = projectNodeData(node.data);
    const data = legacyColor !== undefined && projectedData?.color === undefined
        ? { ...(projectedData || {}), color: legacyColor }
        : projectedData;

    return {
        id: node.id,
        type: node.type,
        label: node.label,
        position: { x: node.position.x, y: node.position.y },
        ...(node.width != null ? { width: node.width } : {}),
        ...(node.height != null ? { height: node.height } : {}),
        ...(node.parentId != null ? { parentId: node.parentId } : {}),
        ...(data ? { data } : {}),
        ...(node.swimlaneId != null ? { swimlaneId: node.swimlaneId } : {}),
        ...(node.rowId != null ? { rowId: node.rowId } : {}),
        ...(node.columnId != null ? { columnId: node.columnId } : {}),
        ...(node.assetIds != null ? { assetIds: [...node.assetIds] } : {}),
        ...(node.subGraphId != null ? { subGraphId: node.subGraphId } : {}),
        // Event is a portable Core semantic value. Its extension fields are
        // part of that value's round-trip contract, unlike general node
        // extensions which remain outside the sharing allowlist.
        ...(node.event != null ? { event: structuredClone(node.event) } : {}),
    };
}

function projectEdge(edge: CanvasEdge): CanvasEdge {
    return {
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        style: edge.style,
        ...(edge.sourceHandleId != null ? { sourceHandleId: edge.sourceHandleId } : {}),
        ...(edge.targetHandleId != null ? { targetHandleId: edge.targetHandleId } : {}),
        ...(edge.type != null ? { type: edge.type } : {}),
        ...(edge.label != null ? { label: edge.label } : {}),
        ...(edge.labelPosition != null ? { labelPosition: edge.labelPosition } : {}),
        ...(edge.labelOrientation != null ? { labelOrientation: edge.labelOrientation } : {}),
        ...(edge.labelSize != null ? { labelSize: edge.labelSize } : {}),
        ...(edge.labelColor != null ? { labelColor: edge.labelColor } : {}),
        ...(edge.color != null ? { color: edge.color } : {}),
        ...(edge.strokeWidth != null ? { strokeWidth: edge.strokeWidth } : {}),
        ...(edge.animated != null ? { animated: edge.animated } : {}),
        ...(edge.routingPoints != null
            ? { routingPoints: edge.routingPoints.map(point => ({ x: point.x, y: point.y })) }
            : {}),
        ...(edge.routingMode != null ? { routingMode: edge.routingMode } : {}),
        ...(edge.routingManual != null ? { routingManual: edge.routingManual } : {}),
        ...(edge.routingMargin != null ? { routingMargin: edge.routingMargin } : {}),
    };
}

function projectSwimlane(swimlane: Swimlane): Swimlane {
    return {
        id: swimlane.id,
        ...(swimlane.axis ? { axis: swimlane.axis } : {}),
        label: swimlane.label,
        color: swimlane.color,
        order: swimlane.order,
        height: swimlane.height,
        ...(swimlane.width != null ? { width: swimlane.width } : {}),
    };
}

function projectGraph(graph: CanvasGraph): CanvasGraph {
    return {
        nodes: (graph.nodes || []).map(projectNode),
        edges: (graph.edges || []).map(projectEdge),
        swimlanes: (graph.swimlanes || []).map(projectSwimlane),
        ...(graph.mode ? { mode: graph.mode } : {}),
        ...(graph.division ? { division: { ...graph.division } } : {}),
        ...(graph.viewport
            ? { viewport: { x: graph.viewport.x, y: graph.viewport.y, zoom: graph.viewport.zoom } }
            : {}),
    };
}

function collectReachableGraphs(process: Process): Array<{ id: string | null; graph: CanvasGraph }> {
    const graphs: Array<{ id: string | null; graph: CanvasGraph }> = [{ id: null, graph: process.graph }];
    const visitedSubGraphs = new Set<string>();

    for (let index = 0; index < graphs.length; index += 1) {
        for (const node of graphs[index].graph.nodes || []) {
            const subGraphId = node.subGraphId;
            if (!subGraphId || visitedSubGraphs.has(subGraphId)) continue;
            const childGraph = process.subGraphs?.[subGraphId];
            if (!childGraph) continue;
            visitedSubGraphs.add(subGraphId);
            graphs.push({ id: subGraphId, graph: childGraph });
        }
    }

    return graphs;
}

function projectProcess(process: Process, reachableGraphs: Array<{ id: string | null; graph: CanvasGraph }>): Process {
    const projectedSubGraphs: Record<string, CanvasGraph> = {};
    reachableGraphs.forEach(({ id, graph }) => {
        if (id) projectedSubGraphs[id] = projectGraph(graph);
    });

    return {
        id: process.id,
        title: process.title,
        ...(process.description != null ? { description: process.description } : {}),
        ...(process.ownerId != null ? { ownerId: process.ownerId } : {}),
        ...(process.metaSettings
            ? {
                metaSettings: {
                    ...(process.metaSettings.showOwnerInCanvas != null
                        ? { showOwnerInCanvas: process.metaSettings.showOwnerInCanvas }
                        : {}),
                    ...(process.metaSettings.showDescriptionInCanvas != null
                        ? { showDescriptionInCanvas: process.metaSettings.showDescriptionInCanvas }
                        : {}),
                },
            }
            : {}),
        createdAt: process.createdAt,
        updatedAt: process.updatedAt,
        graph: projectGraph(process.graph),
        subGraphs: projectedSubGraphs,
        mode: process.mode,
    };
}

function collectNodeAssetIds(node: CanvasNode): string[] {
    const legacyAssetIds = Array.isArray(node.data?.assetIds)
        ? node.data.assetIds.filter((value): value is string => typeof value === 'string')
        : [];
    const placedResourceId = getResourceReferenceAssetId(node);
    return [...new Set([
        ...(node.assetIds || []),
        ...legacyAssetIds,
        ...(placedResourceId ? [placedResourceId] : []),
    ])];
}

function projectAsset(asset: Asset): Asset {
    const description = (asset as Asset & { description?: unknown }).description;
    return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        ...(asset.parentId != null ? { parentId: asset.parentId } : {}),
        ...(asset.metadata != null ? { metadata: structuredClone(asset.metadata) } : {}),
        ...(typeof description === 'string' ? { description } : {}),
    } as Asset;
}

function projectCategory(category: AssetCategory): AssetCategory {
    return {
        id: category.id,
        label: category.label,
        icon: category.icon,
        color: category.color,
        ...(category.baseType ? { baseType: category.baseType } : {}),
    };
}

function projectReference(reference: EntityReference): EntityReference {
    return {
        id: reference.id,
        type: reference.type,
        ...(reference.processId ? { processId: reference.processId } : {}),
        ...(reference.path ? { path: [...reference.path] } : {}),
        ...(reference.source ? { source: reference.source } : {}),
    };
}

function projectEntry(entry: JournalEntry, linkedContext: EntityReference[]): JournalEntry {
    return {
        id: entry.id,
        notebookId: entry.notebookId,
        title: entry.title,
        content: entry.content,
        contentFormat: entry.contentFormat,
        contentVersion: entry.contentVersion,
        tags: [...(entry.tags || [])],
        linkedContext: linkedContext.map(projectReference),
        sharePolicy: 'shareable',
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    };
}

function projectNotebook(notebook: JournalNotebook): JournalNotebook {
    return {
        id: notebook.id,
        title: notebook.title,
        ...(notebook.folderId != null ? { folderId: notebook.folderId } : {}),
        createdAt: notebook.createdAt,
        updatedAt: notebook.updatedAt,
    };
}

function projectFolder(folder: JournalFolder): JournalFolder {
    return {
        id: folder.id,
        title: folder.title,
        ...(folder.parentId != null ? { parentId: folder.parentId } : {}),
        createdAt: folder.createdAt,
    };
}

function projectTag(tag: JournalTag): JournalTag {
    return {
        id: tag.id,
        label: tag.label,
        color: tag.color,
        ...(tag.archived != null ? { archived: tag.archived } : {}),
    };
}

export function projectThemeForSharing(theme: ThemeConfig): ThemeConfig {
    return {
        id: theme.id,
        label: theme.label,
        ...(theme.basePresetId != null ? { basePresetId: theme.basePresetId } : {}),
        colors: { ...theme.colors },
        ...(theme.tokens ? { tokens: { ...theme.tokens } } : {}),
        ...(theme.brand
            ? {
                brand: {
                    ...(theme.brand.logoUrl ? { logoUrl: theme.brand.logoUrl } : {}),
                    ...(theme.brand.showDisplayName === false ? { showDisplayName: false } : {}),
                    ...(theme.brand.displayName ? { displayName: theme.brand.displayName } : {}),
                    ...(theme.brand.fontFamily ? { fontFamily: theme.brand.fontFamily } : {}),
                },
            }
            : {}),
    };
}

export function createSharedProcessProjection(
    portfolio: Portfolio,
    processId: string,
    withDependencies = true,
): SharedProcessProjection {
    const process = portfolio.processes.find(candidate => candidate.id === processId);
    if (!process) throw new Error('Process not found');

    const reachableGraphs = collectReachableGraphs(process);
    const projectedProcess = projectProcess(process, reachableGraphs);
    const nodeIds = new Set<string>();
    const subGraphIds = new Set<string>();
    const assetIds = new Set<string>();

    reachableGraphs.forEach(({ id, graph }) => {
        if (id) subGraphIds.add(id);
        (graph.nodes || []).forEach(node => {
            nodeIds.add(node.id);
            collectNodeAssetIds(node).forEach(assetId => assetIds.add(assetId));
        });
    });
    if (process.ownerId) assetIds.add(process.ownerId);

    const linkedAssets = withDependencies
        ? (portfolio.assets || []).filter(asset => assetIds.has(asset.id)).map(projectAsset)
        : [];
    const categoryIds = new Set(linkedAssets.map(asset => asset.type));
    const linkedCategories = withDependencies
        ? (portfolio.assetCategories || [])
            .filter(category => categoryIds.has(category.id))
            .map(projectCategory)
        : [];

    const includedReference = (reference: EntityReference): boolean => {
        const referenceType = reference.type as string;
        return (referenceType === 'process' && reference.id === processId)
            || ((referenceType === 'node' || referenceType === 'subprocess') && nodeIds.has(reference.id))
            || (referenceType === 'subprocess' && subGraphIds.has(reference.id))
            || ((referenceType === 'asset' || referenceType === 'resource') && assetIds.has(reference.id));
    };

    const linkedCandidates = withDependencies
        ? (portfolio.journal?.entries || []).map(entry => ({
            entry,
            linkedContext: (entry.linkedContext || []).filter(includedReference),
        })).filter(candidate => candidate.linkedContext.length > 0)
        : [];
    const shareableCandidates = linkedCandidates.filter(candidate => candidate.entry.sharePolicy !== 'internal');
    const linkedJournalEntries = shareableCandidates.map(candidate => (
        projectEntry(candidate.entry, candidate.linkedContext)
    ));

    const notebookIds = new Set(linkedJournalEntries.map(entry => entry.notebookId));
    const linkedNotebooks = (portfolio.journal?.notebooks || [])
        .filter(notebook => notebookIds.has(notebook.id))
        .map(projectNotebook);
    const folderIds = new Set<string>();
    const journalFolders = portfolio.journal?.folders || [];
    const includeFolderChain = (folderId?: string | null) => {
        let currentId = folderId;
        while (currentId && !folderIds.has(currentId)) {
            folderIds.add(currentId);
            currentId = journalFolders.find(folder => folder.id === currentId)?.parentId || null;
        }
    };
    linkedNotebooks.forEach(notebook => includeFolderChain(notebook.folderId));
    const linkedFolders = journalFolders.filter(folder => folderIds.has(folder.id)).map(projectFolder);

    const tagIds = new Set<string>();
    linkedJournalEntries.forEach(entry => entry.tags?.forEach(tagId => tagIds.add(tagId)));
    const linkedTags = (portfolio.journal?.tags || [])
        .filter(tag => tagIds.has(tag.id))
        .map(projectTag);

    return {
        portfolio: {
            ...(portfolio.schemaVersion != null ? { schemaVersion: portfolio.schemaVersion } : {}),
            version: portfolio.version,
            lastModified: portfolio.lastModified,
            processes: [projectedProcess],
            processFolders: [],
            assets: linkedAssets,
            assetCategories: linkedCategories,
            incidents: [],
            journal: {
                notebooks: linkedNotebooks,
                folders: linkedFolders,
                entries: linkedJournalEntries,
                tags: linkedTags,
            },
            // The HTML builder adds the one actually rendered custom theme.
            // Process fragments do not need unrelated portfolio theme documents.
            customThemes: [],
            activeThemeId: null,
        },
        summary: {
            includedAssets: linkedAssets.length,
            includedJournalEntries: linkedJournalEntries.length,
            excludedInternalJournalEntries: linkedCandidates.length - shareableCandidates.length,
        },
    };
}
