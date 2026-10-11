import type { CanvasGraph, CanvasNode, Portfolio, Process } from '../types';
import { getResourceReferenceAssetId } from './resourceReferences';

export type DependencyEntityType = 'process' | 'asset' | 'entry' | 'node' | 'tag';

export type DependencyRelationType =
    | 'contains'
    | 'flow'
    | 'asset-reference'
    | 'journal-reference'
    | 'tag-membership'
    | 'tag-insight'
    | 'process-resource';

export interface DependencyEntity {
    id: string;
    type: DependencyEntityType;
    label: string;
    processId?: string;
    assetType?: string;
    categoryLabel?: string;
    categoryIcon?: string;
    categoryColor?: string;
}

export interface DependencyRelation {
    id: string;
    source: string;
    target: string;
    type: DependencyRelationType;
    processId?: string;
    count?: number;
}

interface DependencyNeighbor {
    entityId: string;
    relationId: string;
}

export interface DependencyGraphIndex {
    entities: Map<string, DependencyEntity>;
    relations: DependencyRelation[];
    relationById: Map<string, DependencyRelation>;
    neighbors: Map<string, DependencyNeighbor[]>;
    processNodeIds: Map<string, string[]>;
    danglingReferenceCount: number;
    danglingRelationCounts: Record<DependencyRelationType, number>;
}

export interface DependencyViewNode extends DependencyEntity {
    depth: number;
    isContext?: boolean;
    isFocal?: boolean;
    weight?: number;
}

export interface DependencyViewGraph {
    nodes: DependencyViewNode[];
    relations: DependencyRelation[];
    truncated: boolean;
    hiddenNodeCount: number;
    unlinkedResourceCount: number;
    danglingReferenceCount: number;
    danglingRelationCounts: Record<DependencyRelationType, number>;
    tagInsight?: {
        taggedEntryCount: number;
        referencedEntityCount: number;
        unlinkedEntryCount: number;
    };
}

export type DependencyQuery =
    | { kind: 'overview'; maxNodes?: number; includeUnlinkedResources?: boolean }
    | { kind: 'focus'; focalId: string; depth: number; maxNodes?: number }
    | { kind: 'process'; processIds?: string[]; folderId?: string | null; maxNodes?: number }
    | { kind: 'tag'; tagId: string; maxNodes?: number; includeJournalEntries?: boolean };

const DEFAULT_MAX_NODES = 350;

function emptyRelationCounts(): Record<DependencyRelationType, number> {
    return {
        contains: 0,
        flow: 0,
        'asset-reference': 0,
        'journal-reference': 0,
        'tag-membership': 0,
        'tag-insight': 0,
        'process-resource': 0,
    };
}

function relationKey(relation: Pick<DependencyRelation, 'source' | 'target' | 'type' | 'processId'>): string {
    return `${relation.type}:${relation.source}:${relation.target}:${relation.processId || ''}`;
}

function addNeighbor(
    neighbors: Map<string, DependencyNeighbor[]>,
    entityId: string,
    neighbor: DependencyNeighbor,
): void {
    const existing = neighbors.get(entityId);
    if (existing) existing.push(neighbor);
    else neighbors.set(entityId, [neighbor]);
}

function getCategory(portfolio: Portfolio, assetType: string) {
    return portfolio.assetCategories?.find(category => category.id === assetType);
}

function getNodeAssetIds(node: CanvasNode): string[] {
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

interface GraphVisit {
    graph: CanvasGraph;
    ownerNodeIds: string[];
    graphKey: string;
}

function collectProcessGraphs(process: Process): GraphVisit[] {
    const visits: GraphVisit[] = [];
    const visitedSubGraphs = new Set<string>();
    const visitBySubGraphId = new Map<string, GraphVisit>();

    const visit = (graph: CanvasGraph, graphKey: string, ownerNodeId?: string) => {
        const existingVisit = graphKey === 'root' ? undefined : visitBySubGraphId.get(graphKey);
        if (existingVisit) {
            if (ownerNodeId && !existingVisit.ownerNodeIds.includes(ownerNodeId)) {
                existingVisit.ownerNodeIds.push(ownerNodeId);
            }
            return;
        }

        const graphVisit = { graph, ownerNodeIds: ownerNodeId ? [ownerNodeId] : [], graphKey };
        visits.push(graphVisit);
        if (graphKey !== 'root') visitBySubGraphId.set(graphKey, graphVisit);
        for (const node of graph.nodes || []) {
            if (!node.subGraphId) continue;
            const childGraph = process.subGraphs?.[node.subGraphId];
            if (!childGraph) continue;
            if (visitedSubGraphs.has(node.subGraphId)) {
                const existingChildVisit = visitBySubGraphId.get(node.subGraphId);
                if (existingChildVisit && !existingChildVisit.ownerNodeIds.includes(node.id)) {
                    existingChildVisit.ownerNodeIds.push(node.id);
                }
                continue;
            }
            visitedSubGraphs.add(node.subGraphId);
            visit(childGraph, node.subGraphId, node.id);
        }
    };

    visit(process.graph, 'root');

    // Preserve older or partially migrated portfolios that contain detached subgraphs.
    for (const [subGraphId, subGraph] of Object.entries(process.subGraphs || {})) {
        if (visitedSubGraphs.has(subGraphId)) continue;
        visitedSubGraphs.add(subGraphId);
        visit(subGraph, subGraphId);
    }

    return visits;
}

export function buildDependencyGraphIndex(portfolio: Portfolio): DependencyGraphIndex {
    const entities = new Map<string, DependencyEntity>();
    const relations: DependencyRelation[] = [];
    const relationById = new Map<string, DependencyRelation>();
    const neighbors = new Map<string, DependencyNeighbor[]>();
    const processNodeIds = new Map<string, string[]>();
    const pendingRelations: DependencyRelation[] = [];
    const seenRelations = new Set<string>();

    const addEntity = (entity: DependencyEntity) => {
        if (!entity.id || entities.has(entity.id)) return;
        entities.set(entity.id, entity);
    };

    const queueRelation = (relation: DependencyRelation) => {
        const key = relationKey(relation);
        if (seenRelations.has(key)) return;
        seenRelations.add(key);
        pendingRelations.push(relation);
    };

    for (const process of portfolio.processes || []) {
        addEntity({ id: process.id, type: 'process', label: process.title || 'Untitled process' });
    }

    for (const asset of portfolio.assets || []) {
        const category = getCategory(portfolio, asset.type);
        addEntity({
            id: asset.id,
            type: 'asset',
            label: asset.name || 'Untitled resource',
            assetType: asset.type,
            categoryLabel: category?.label || asset.type || 'Resource',
            categoryIcon: category?.icon,
            categoryColor: category?.color,
        });
    }

    for (const entry of portfolio.journal?.entries || []) {
        addEntity({ id: entry.id, type: 'entry', label: entry.title || 'Untitled note' });
    }

    for (const tag of portfolio.journal?.tags || []) {
        addEntity({ id: tag.id, type: 'tag', label: tag.label || 'Untitled tag', categoryColor: tag.color });
    }

    const graphVisitsByProcess = new Map<string, GraphVisit[]>();

    for (const process of portfolio.processes || []) {
        const visits = collectProcessGraphs(process);
        graphVisitsByProcess.set(process.id, visits);
        const nodeIds: string[] = [];

        for (const { graph } of visits) {
            for (const node of graph.nodes || []) {
                addEntity({
                    id: node.id,
                    type: 'node',
                    label: node.label || 'Untitled step',
                    processId: process.id,
                });
                nodeIds.push(node.id);
            }
        }

        processNodeIds.set(process.id, nodeIds);
    }

    for (const process of portfolio.processes || []) {
        for (const { graph, ownerNodeIds, graphKey } of graphVisitsByProcess.get(process.id) || []) {
            for (const node of graph.nodes || []) {
                const containers = ownerNodeIds.length > 0 ? ownerNodeIds : [process.id];
                for (const containerId of containers) {
                    queueRelation({
                        id: `contains:${process.id}:${graphKey}:${containerId}:${node.id}`,
                        source: containerId,
                        target: node.id,
                        type: 'contains',
                        processId: process.id,
                    });
                }

                for (const assetId of getNodeAssetIds(node)) {
                    queueRelation({
                        id: `asset:${process.id}:${node.id}:${assetId}`,
                        source: node.id,
                        target: assetId,
                        type: 'asset-reference',
                        processId: process.id,
                    });
                }
            }

            for (const edge of graph.edges || []) {
                queueRelation({
                    id: `flow:${process.id}:${graphKey}:${edge.id}`,
                    source: edge.sourceId,
                    target: edge.targetId,
                    type: 'flow',
                    processId: process.id,
                });
            }
        }
    }

    for (const entry of portfolio.journal?.entries || []) {
        for (const reference of entry.linkedContext || []) {
            queueRelation({
                id: `journal:${entry.id}:${reference.type}:${reference.id}`,
                source: entry.id,
                target: reference.id,
                type: 'journal-reference',
                processId: reference.processId,
            });
        }

        for (const tagId of entry.tags || []) {
            queueRelation({
                id: `tag:${tagId}:${entry.id}`,
                source: tagId,
                target: entry.id,
                type: 'tag-membership',
            });
        }
    }

    let danglingReferenceCount = 0;
    const danglingRelationCounts = emptyRelationCounts();

    for (const pending of pendingRelations) {
        if (!entities.has(pending.source) || !entities.has(pending.target)) {
            danglingReferenceCount += 1;
            danglingRelationCounts[pending.type] += 1;
            continue;
        }

        relations.push(pending);
        relationById.set(pending.id, pending);
        addNeighbor(neighbors, pending.source, { entityId: pending.target, relationId: pending.id });
        addNeighbor(neighbors, pending.target, { entityId: pending.source, relationId: pending.id });
    }

    return {
        entities,
        relations,
        relationById,
        neighbors,
        processNodeIds,
        danglingReferenceCount,
        danglingRelationCounts,
    };
}

export function getProcessIdsForFolder(portfolio: Portfolio, folderId: string): string[] {
    const folderIds = new Set<string>();
    const queue = [folderId];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const currentId = queue[cursor];
        if (folderIds.has(currentId)) continue;
        folderIds.add(currentId);
        for (const folder of portfolio.processFolders || []) {
            if (folder.parentId === currentId) queue.push(folder.id);
        }
    }

    return (portfolio.processes || [])
        .filter(process => !!process.folderId && folderIds.has(process.folderId))
        .map(process => process.id);
}

function sortEntities(a: DependencyEntity, b: DependencyEntity): number {
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function createViewGraph(
    index: DependencyGraphIndex,
    nodes: DependencyViewNode[],
    options: { truncated?: boolean; hiddenNodeCount?: number; allowedRelationTypes?: Set<DependencyRelationType> } = {},
): DependencyViewGraph {
    const nodeIds = new Set(nodes.map(node => node.id));
    const relations = index.relations.filter(relation =>
        nodeIds.has(relation.source)
        && nodeIds.has(relation.target)
        && (!options.allowedRelationTypes || options.allowedRelationTypes.has(relation.type)),
    );

    return {
        nodes,
        relations,
        truncated: options.truncated || false,
        hiddenNodeCount: options.hiddenNodeCount || 0,
        unlinkedResourceCount: 0,
        danglingReferenceCount: index.danglingReferenceCount,
        danglingRelationCounts: index.danglingRelationCounts,
    };
}

function queryOverview(
    index: DependencyGraphIndex,
    maxNodes: number,
    includeUnlinkedResources: boolean,
): DependencyViewGraph {
    const processes = [...index.entities.values()].filter(entity => entity.type === 'process').sort(sortEntities);
    const assets = [...index.entities.values()].filter(entity => entity.type === 'asset');
    const processAssetCounts = new Map<string, Map<string, number>>();

    for (const relation of index.relations) {
        if (relation.type !== 'asset-reference') continue;
        const node = index.entities.get(relation.source);
        if (!node?.processId) continue;
        const assetsForProcess = processAssetCounts.get(node.processId) || new Map<string, number>();
        assetsForProcess.set(relation.target, (assetsForProcess.get(relation.target) || 0) + 1);
        processAssetCounts.set(node.processId, assetsForProcess);
    }

    const assetDegree = new Map<string, number>();
    for (const assetsForProcess of processAssetCounts.values()) {
        for (const assetId of assetsForProcess.keys()) {
            assetDegree.set(assetId, (assetDegree.get(assetId) || 0) + 1);
        }
    }

    assets.sort((a, b) =>
        (assetDegree.get(b.id) || 0) - (assetDegree.get(a.id) || 0)
        || sortEntities(a, b),
    );

    const connectedAssets = assets.filter(asset => (assetDegree.get(asset.id) || 0) > 0);
    const unlinkedAssets = assets.filter(asset => (assetDegree.get(asset.id) || 0) === 0);
    const candidates = [
        ...processes,
        ...connectedAssets,
        ...(includeUnlinkedResources ? unlinkedAssets : []),
    ];
    const selected = candidates.slice(0, maxNodes);
    const selectedIds = new Set(selected.map(entity => entity.id));
    const nodes = selected.map(entity => ({ ...entity, depth: entity.type === 'process' ? 0 : 1 }));
    const relations: DependencyRelation[] = [];

    for (const [processId, assetsForProcess] of processAssetCounts) {
        for (const [assetId, count] of assetsForProcess) {
            if (!selectedIds.has(processId) || !selectedIds.has(assetId)) continue;
            relations.push({
                id: `process-resource:${processId}:${assetId}`,
                source: processId,
                target: assetId,
                type: 'process-resource',
                processId,
                count,
            });
        }
    }

    return {
        nodes,
        relations,
        truncated: candidates.length > selected.length,
        hiddenNodeCount: Math.max(0, candidates.length - selected.length),
        unlinkedResourceCount: unlinkedAssets.length,
        danglingReferenceCount: index.danglingReferenceCount,
        danglingRelationCounts: index.danglingRelationCounts,
    };
}

const FOCUS_RELATION_TYPES = new Set<DependencyRelationType>([
    'contains',
    'flow',
    'asset-reference',
    'journal-reference',
]);

function queryFocus(index: DependencyGraphIndex, focalId: string, depth: number, maxNodes: number): DependencyViewGraph {
    const focal = index.entities.get(focalId);
    if (!focal) return createViewGraph(index, []);

    const clampedDepth = Math.max(1, Math.min(3, depth));
    const visited = new Map<string, number>([[focalId, 0]]);
    const queue: Array<{ id: string; depth: number }> = [{ id: focalId, depth: 0 }];
    let truncated = false;

    if (focal.type === 'process') {
        for (const nodeId of index.processNodeIds.get(focal.id) || []) {
            if (visited.size >= maxNodes) {
                truncated = true;
                break;
            }
            visited.set(nodeId, 1);
            queue.push({ id: nodeId, depth: 1 });
        }
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        if (current.depth >= clampedDepth) continue;

        for (const neighbor of index.neighbors.get(current.id) || []) {
            const relation = index.relationById.get(neighbor.relationId);
            if (!relation || relation.type === 'tag-membership' || relation.type === 'contains') continue;
            if (visited.has(neighbor.entityId)) continue;
            if (visited.size >= maxNodes) {
                truncated = true;
                continue;
            }

            const nextDepth = current.depth + 1;
            visited.set(neighbor.entityId, nextDepth);
            queue.push({ id: neighbor.entityId, depth: nextDepth });
        }
    }

    // Process context is informative but never traversed, preventing sibling-node explosions.
    for (const [entityId, entityDepth] of [...visited]) {
        const entity = index.entities.get(entityId);
        if (entity?.type !== 'node' || !entity.processId || visited.has(entity.processId)) continue;
        if (visited.size >= maxNodes) {
            truncated = true;
            break;
        }
        visited.set(entity.processId, Math.max(1, entityDepth));
    }

    const nodes = [...visited.entries()]
        .map(([entityId, entityDepth]) => {
            const entity = index.entities.get(entityId)!;
            return {
                ...entity,
                depth: entityDepth,
                isFocal: entityId === focalId,
                isContext: entity.type === 'process' && entityId !== focalId,
            };
        })
        .sort((a, b) => a.depth - b.depth || sortEntities(a, b));

    return createViewGraph(index, nodes, {
        truncated,
        allowedRelationTypes: FOCUS_RELATION_TYPES,
    });
}

function queryProcess(
    index: DependencyGraphIndex,
    portfolio: Portfolio,
    processIds: string[],
    folderId: string | null | undefined,
    maxNodes: number,
): DependencyViewGraph {
    const requestedProcessIds = new Set([
        ...processIds,
        ...(folderId ? getProcessIdsForFolder(portfolio, folderId) : []),
    ]);
    const processes = [...requestedProcessIds]
        .map(processId => index.entities.get(processId))
        .filter((entity): entity is DependencyEntity => entity?.type === 'process')
        .sort(sortEntities);
    const processAssetCounts = new Map<string, Map<string, number>>();
    const assetUsageCounts = new Map<string, number>();

    for (const relation of index.relations) {
        if (relation.type !== 'asset-reference') continue;
        const node = index.entities.get(relation.source);
        if (!node?.processId || !requestedProcessIds.has(node.processId)) continue;
        const assetsForProcess = processAssetCounts.get(node.processId) || new Map<string, number>();
        assetsForProcess.set(relation.target, (assetsForProcess.get(relation.target) || 0) + 1);
        processAssetCounts.set(node.processId, assetsForProcess);
        assetUsageCounts.set(relation.target, (assetUsageCounts.get(relation.target) || 0) + 1);
    }

    const assets = [...assetUsageCounts.keys()]
        .map(assetId => index.entities.get(assetId))
        .filter((entity): entity is DependencyEntity => entity?.type === 'asset')
        .sort((a, b) =>
            (assetUsageCounts.get(b.id) || 0) - (assetUsageCounts.get(a.id) || 0)
            || sortEntities(a, b),
        );
    const candidates = [...processes, ...assets];
    const selected = candidates.slice(0, maxNodes);
    const selectedIds = new Set(selected.map(entity => entity.id));
    const nodes = selected.map(entity => ({
        ...entity,
        depth: entity.type === 'process' ? 0 : 1,
        isFocal: requestedProcessIds.size === 1 && entity.type === 'process',
    }));
    const relations: DependencyRelation[] = [];

    for (const [processId, assetsForProcess] of processAssetCounts) {
        for (const [assetId, count] of assetsForProcess) {
            if (!selectedIds.has(processId) || !selectedIds.has(assetId)) continue;
            relations.push({
                id: `process-resource:${processId}:${assetId}`,
                source: processId,
                target: assetId,
                type: 'process-resource',
                processId,
                count,
            });
        }
    }

    return {
        nodes,
        relations,
        truncated: candidates.length > selected.length,
        hiddenNodeCount: Math.max(0, candidates.length - selected.length),
        unlinkedResourceCount: 0,
        danglingReferenceCount: index.danglingReferenceCount,
        danglingRelationCounts: index.danglingRelationCounts,
    };
}

function queryTag(
    index: DependencyGraphIndex,
    tagId: string,
    maxNodes: number,
    includeJournalEntries: boolean,
): DependencyViewGraph {
    const tag = index.entities.get(tagId);
    if (!tag || tag.type !== 'tag') return createViewGraph(index, []);

    const entryIds: string[] = [];
    for (const relation of index.relations) {
        if (relation.type !== 'tag-membership' || relation.source !== tagId) continue;
        entryIds.push(relation.target);
    }

    const targetWeights = new Map<string, number>();
    let unlinkedEntryCount = 0;
    for (const entryId of entryIds) {
        let targetCount = 0;
        for (const neighbor of index.neighbors.get(entryId) || []) {
            const relation = index.relationById.get(neighbor.relationId);
            if (!relation || relation.type !== 'journal-reference' || relation.source !== entryId) continue;
            targetWeights.set(relation.target, (targetWeights.get(relation.target) || 0) + 1);
            targetCount += 1;
        }
        if (targetCount === 0) unlinkedEntryCount += 1;
    }

    const tagInsight = {
        taggedEntryCount: entryIds.length,
        referencedEntityCount: targetWeights.size,
        unlinkedEntryCount,
    };

    if (!includeJournalEntries) {
        const selectedIds = new Set<string>([tagId]);
        const targetIds = [...targetWeights.keys()].sort((a, b) =>
            (targetWeights.get(b) || 0) - (targetWeights.get(a) || 0)
            || sortEntities(index.entities.get(a)!, index.entities.get(b)!),
        );
        let truncated = false;

        for (const targetId of targetIds) {
            if (selectedIds.size >= maxNodes) {
                truncated = true;
                break;
            }
            selectedIds.add(targetId);
        }

        const selectedTargetIds = [...selectedIds].filter(entityId => entityId !== tagId);

        const nodes = [...selectedIds]
            .map(entityId => {
                const entity = index.entities.get(entityId)!;
                return {
                    ...entity,
                    depth: entityId === tagId ? 0 : 1,
                    isFocal: entityId === tagId,
                    weight: targetWeights.get(entityId),
                };
            })
            .sort((a, b) => a.depth - b.depth || sortEntities(a, b));
        const relations: DependencyRelation[] = selectedTargetIds.map(targetId => ({
            id: `tag-insight:${tagId}:${targetId}`,
            source: tagId,
            target: targetId,
            type: 'tag-insight',
            count: targetWeights.get(targetId),
        }));

        return {
            nodes,
            relations,
            truncated,
            hiddenNodeCount: Math.max(0, targetIds.length - selectedTargetIds.length),
            unlinkedResourceCount: 0,
            danglingReferenceCount: index.danglingReferenceCount,
            danglingRelationCounts: index.danglingRelationCounts,
            tagInsight,
        };
    }

    const selectedIds = new Set<string>([tagId]);
    const depthById = new Map<string, number>([[tagId, 0]]);
    let truncated = false;
    const include = (entityId: string, depth: number) => {
        if (selectedIds.has(entityId)) return true;
        if (selectedIds.size >= maxNodes) {
            truncated = true;
            return false;
        }
        selectedIds.add(entityId);
        depthById.set(entityId, depth);
        return true;
    };

    const visibleEntryIds = entryIds.filter(entryId => include(entryId, 1));
    for (const entryId of visibleEntryIds) {
        for (const neighbor of index.neighbors.get(entryId) || []) {
            const relation = index.relationById.get(neighbor.relationId);
            if (!relation || relation.type !== 'journal-reference' || relation.source !== entryId) continue;
            include(relation.target, 2);
        }
    }
    for (const entityId of [...selectedIds]) {
        const entity = index.entities.get(entityId);
        if (entity?.type === 'node' && entity.processId) include(entity.processId, 2);
    }
    const nodes = [...selectedIds]
        .map(entityId => {
            const entity = index.entities.get(entityId)!;
            return {
                ...entity,
                depth: depthById.get(entityId) || 0,
                isFocal: entityId === tagId,
                isContext: entity.type === 'process',
                weight: targetWeights.get(entityId),
            };
        })
        .sort((a, b) => a.depth - b.depth || sortEntities(a, b));

    return {
        ...createViewGraph(index, nodes, { truncated }),
        tagInsight,
    };
}

export function queryDependencyGraph(
    index: DependencyGraphIndex,
    portfolio: Portfolio,
    query: DependencyQuery,
): DependencyViewGraph {
    const maxNodes = Math.max(1, query.maxNodes || DEFAULT_MAX_NODES);

    if (query.kind === 'overview') {
        return queryOverview(index, maxNodes, query.includeUnlinkedResources || false);
    }
    if (query.kind === 'focus') return queryFocus(index, query.focalId, query.depth, maxNodes);
    if (query.kind === 'process') {
        return queryProcess(index, portfolio, query.processIds || [], query.folderId, maxNodes);
    }
    return queryTag(index, query.tagId, maxNodes, query.includeJournalEntries || false);
}

export function getRelationPerspective(
    relation: DependencyRelation,
    entityId: string,
): { direction: 'outgoing' | 'incoming'; label: string } {
    const outgoing = relation.source === entityId;
    const labels: Record<DependencyRelationType, [string, string]> = {
        contains: ['Contains', 'Part of'],
        flow: ['Flows to', 'Comes from'],
        'asset-reference': ['Uses resource', 'Used by step'],
        'journal-reference': ['References', 'Referenced by note'],
        'tag-membership': ['Tags note', 'Tagged with'],
        'tag-insight': ['Highlights', 'Referenced by tagged notes'],
        'process-resource': ['Uses resource', 'Used by process'],
    };

    return {
        direction: outgoing ? 'outgoing' : 'incoming',
        label: labels[relation.type][outgoing ? 0 : 1],
    };
}

export function getEntityTypeLabel(type: DependencyEntityType): string {
    const labels: Record<DependencyEntityType, string> = {
        process: 'Process',
        asset: 'Resource',
        entry: 'Journal',
        node: 'Step',
        tag: 'Tag',
    };
    return labels[type];
}
