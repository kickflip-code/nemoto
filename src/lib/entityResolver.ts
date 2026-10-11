import type { Portfolio, CanvasGraph, CanvasNode, Process } from '../types';
import type { EntityReference } from '../types/journal';

// Re-export EntityReference for convenience
export type { EntityReference } from '../types/journal';

// Entity type enum for type-safe resolution
export type EntityType = EntityReference['type'];

// Entity reference with type information (legacy, use EntityReference from journal types)
export interface EntityRef {
    id: string;
    type: EntityType;
}

// Resolved entity with display information
export interface ResolvedEntity {
    id: string;
    type: EntityType;
    displayName: string;
    icon?: string;
    color?: string;
    subtitle?: string; // Additional context (e.g., asset category, process name)
    processId?: string;
    path?: string[];
}

export interface NodeLocation {
    node: CanvasNode;
    process: Process;
    processId: string;
    path: string[];
    pathLabels: string[];
}

export interface EntityCandidate {
    reference: EntityReference;
    label: string;
    context: string;
    icon?: string;
    color?: string;
}

export interface EntityResolverIndex {
    assets: Map<string, Portfolio['assets'][number]>;
    processes: Map<string, Process>;
    journalEntries: Map<string, Portfolio['journal']['entries'][number]>;
    tags: Map<string, Portfolio['journal']['tags'][number]>;
    incidents: Map<string, Portfolio['incidents'][number]>;
    nodeLocations: Map<string, NodeLocation>;
    nodeLocationsByProcess: Map<string, Map<string, NodeLocation>>;
}

/** Build the reusable lookup tables used by bulk migration and integrity checks. */
export function createEntityResolverIndex(portfolio: Portfolio): EntityResolverIndex {
    const nodeLocations = new Map<string, NodeLocation>();
    const nodeLocationsByProcess = new Map<string, Map<string, NodeLocation>>();

    portfolio.processes.forEach(process => {
        const processLocations = new Map<string, NodeLocation>();
        nodeLocationsByProcess.set(process.id, processLocations);

        const visit = (
            nodes: CanvasNode[],
            path: string[],
            pathLabels: string[],
            visitedSubGraphs: Set<string>,
        ) => {
            nodes.forEach(node => {
                const nodePath = [...path, node.id];
                const nodeLabels = [...pathLabels, node.label || 'Untitled Node'];
                const location: NodeLocation = {
                    node,
                    process,
                    processId: process.id,
                    path: nodePath,
                    pathLabels: nodeLabels,
                };

                if (!processLocations.has(node.id)) processLocations.set(node.id, location);
                if (!nodeLocations.has(node.id)) nodeLocations.set(node.id, location);

                const childGraphId = node.subGraphId;
                const childGraph = childGraphId && process.subGraphs?.[childGraphId];
                if (childGraph && childGraphId && !visitedSubGraphs.has(childGraphId)) {
                    visit(
                        childGraph.nodes || [],
                        nodePath,
                        nodeLabels,
                        new Set([...visitedSubGraphs, childGraphId]),
                    );
                }
            });
        };

        visit(process.graph.nodes || [], [], [], new Set());
    });

    return {
        assets: new Map(portfolio.assets.map(asset => [asset.id, asset])),
        processes: new Map(portfolio.processes.map(process => [process.id, process])),
        journalEntries: new Map((portfolio.journal?.entries || []).map(entry => [entry.id, entry])),
        tags: new Map((portfolio.journal?.tags || []).map(tag => [tag.id, tag])),
        incidents: new Map((portfolio.incidents || []).map(incident => [incident.id, incident])),
        nodeLocations,
        nodeLocationsByProcess,
    };
}

function findIndexedNodeLocation(
    nodeId: string,
    index: EntityResolverIndex,
    preferredProcessId?: string,
): NodeLocation | null {
    return (preferredProcessId
        ? index.nodeLocationsByProcess.get(preferredProcessId)?.get(nodeId)
        : undefined) || index.nodeLocations.get(nodeId) || null;
}

export function getGraphAtPath(process: Process, path: string[]): CanvasGraph | null {
    let graph = process.graph;

    for (const nodeId of path) {
        const node = graph.nodes.find(candidate => candidate.id === nodeId);
        const childGraph = node?.subGraphId && process.subGraphs?.[node.subGraphId];
        if (!childGraph) return null;
        graph = childGraph;
    }

    return graph;
}

/**
 * Recursively search for a node in a process's graph structure (now flattened)
 */
export function findNodeLocationInProcess(nodeId: string, process: Process): NodeLocation | null {
    const visit = (
        nodes: CanvasNode[],
        path: string[],
        pathLabels: string[],
        visitedSubGraphs: Set<string>,
    ): NodeLocation | null => {
        for (const node of nodes) {
            const nodePath = [...path, node.id];
            const nodeLabels = [...pathLabels, node.label || 'Untitled Node'];

            if (node.id === nodeId) {
                return {
                    node,
                    process,
                    processId: process.id,
                    path: nodePath,
                    pathLabels: nodeLabels,
                };
            }

            const childGraphId = node.subGraphId;
            const childGraph = childGraphId && process.subGraphs?.[childGraphId];
            if (childGraph && childGraphId && !visitedSubGraphs.has(childGraphId)) {
                const nested = visit(
                    childGraph.nodes || [],
                    nodePath,
                    nodeLabels,
                    new Set([...visitedSubGraphs, childGraphId]),
                );
                if (nested) return nested;
            }
        }

        return null;
    };

    return visit(process.graph.nodes || [], [], [], new Set());
}

/**
 * Search for a node across all processes in portfolio
 */
export function findNodeLocationInPortfolio(
    nodeId: string,
    portfolio: Portfolio,
    preferredProcessId?: string,
): NodeLocation | null {
    const preferredProcess = preferredProcessId
        ? portfolio.processes.find(process => process.id === preferredProcessId)
        : undefined;

    if (preferredProcess) {
        const preferred = findNodeLocationInProcess(nodeId, preferredProcess);
        if (preferred) return preferred;
    }

    for (const process of portfolio.processes) {
        if (process.id === preferredProcessId) continue;
        const location = findNodeLocationInProcess(nodeId, process);
        if (location) return location;
    }
    return null;
}

/**
 * Get icon name for node type
 */
function getNodeTypeIcon(type: string): string {
    const iconMap: Record<string, string> = {
        start: 'Play',
        end: 'CheckCircle',
        action: 'Square',
        decision: 'Diamond',
        system: 'Monitor',
        event: 'CircleDot',
    };
    return iconMap[type] || 'Circle';
}

/**
 * Get icon and color for an asset based on its category
 */
function getAssetCategoryInfo(assetType: string, portfolio: Portfolio): { icon: string; color: string } {
    const category = portfolio.assetCategories?.find(c => c.id === assetType);
    return {
        icon: category?.icon || 'Box',
        color: category?.color || 'gray'
    };
}

/**
 * Core function: Resolve an entity ID to its display information
 * 
 * @param id - Entity ID to resolve
 * @param type - Entity type
 * @param portfolio - Portfolio data to resolve against
 * @returns Resolved entity or null if not found
 */
export function resolveEntity(
    id: string,
    type: EntityType,
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): ResolvedEntity | null {
    const portfolioData = portfolio;

    switch (type) {
        case 'asset': {
            const asset = index?.assets.get(id) || portfolioData.assets.find(a => a.id === id);
            if (!asset) return null;

            const categoryInfo = getAssetCategoryInfo(asset.type, portfolioData);
            const category = portfolioData.assetCategories?.find(c => c.id === asset.type);

            return {
                id: asset.id,
                type: 'asset',
                displayName: asset.name,
                icon: categoryInfo.icon,
                color: categoryInfo.color,
                subtitle: category?.label
            };
        }

        case 'node': {
            const location = index
                ? findIndexedNodeLocation(id, index)
                : findNodeLocationInPortfolio(id, portfolioData);
            if (!location) return null;
            const { node, process, processId, path, pathLabels } = location;

            return {
                id: node.id,
                type: 'node',
                displayName: node.label || 'Untitled Node',
                icon: getNodeTypeIcon(node.type),
                subtitle: `${node.type} in ${process.title}${pathLabels.length > 1 ? ` / ${pathLabels.slice(0, -1).join(' / ')}` : ''}`,
                processId,
                path,
            };
        }

        case 'process': {
            const process = index?.processes.get(id) || portfolioData.processes.find(p => p.id === id);
            if (!process) return null;

            return {
                id: process.id,
                type: 'process',
                displayName: process.title,
                icon: 'LayoutGrid',
                subtitle: `${process.graph.nodes.length} nodes`,
                processId: process.id,
                path: [],
            };
        }

        case 'journalEntry': {
            const entry = index?.journalEntries.get(id) || portfolioData.journal?.entries?.find(e => e.id === id);
            if (!entry) return null;

            return {
                id: entry.id,
                type: 'journalEntry',
                displayName: entry.title,
                icon: 'FileText',
                subtitle: 'Journal Entry'
            };
        }

        case 'tag': {
            const tag = index?.tags.get(id) || portfolioData.journal?.tags?.find(t => t.id === id);
            if (!tag) return null;

            return {
                id: tag.id,
                type: 'tag',
                displayName: tag.label,
                icon: 'Tag',
                color: tag.color
            };
        }

        case 'incident': {
            const incident = index?.incidents.get(id) || portfolioData.incidents?.find(i => i.id === id);
            if (!incident) return null;

            return {
                id: incident.id,
                type: 'incident',
                displayName: incident.title,
                icon: 'AlertTriangle',
                subtitle: `${incident.findings?.length || 0} findings`
            };
        }

        default:
            return null;
    }
}

export function normalizeEntityReference(
    reference: Omit<Partial<EntityReference>, 'type'> & { id: string; type?: string },
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): EntityReference {
    const portfolioData = portfolio;
    const legacyType = reference.type;
    let type: EntityType;

    if (legacyType === 'resource') {
        type = 'asset';
    } else if (legacyType === 'subprocess') {
        type = 'node';
    } else if (legacyType && ['process', 'node', 'asset', 'journalEntry', 'tag', 'incident'].includes(legacyType)) {
        type = legacyType as EntityType;
    } else {
        type = inferEntityType(reference.id, portfolioData);
    }

    // A legacy "process" mention may actually point to a node. Prefer the
    // concrete portfolio lookup over stale serialized type metadata.
    const processExists = index
        ? index.processes.has(reference.id)
        : portfolioData.processes.some(process => process.id === reference.id);
    if (type === 'process' && !processExists) {
        const nodeLocation = index
            ? findIndexedNodeLocation(reference.id, index, reference.processId)
            : findNodeLocationInPortfolio(reference.id, portfolioData, reference.processId);
        if (nodeLocation) type = 'node';
    }

    if (type === 'node') {
        const location = index
            ? findIndexedNodeLocation(reference.id, index, reference.processId)
            : findNodeLocationInPortfolio(reference.id, portfolioData, reference.processId);
        if (location) {
            return {
                ...reference,
                id: reference.id,
                type,
                processId: location.processId,
                path: location.path,
                source: reference.source,
            };
        }
    }

    return {
        ...reference,
        id: reference.id,
        type,
        processId: type === 'process' ? reference.id : reference.processId,
        path: reference.path,
        source: reference.source,
    };
}

export function resolveEntityReference(
    reference: EntityReference,
    portfolio: Portfolio,
    index?: EntityResolverIndex,
): ResolvedEntity | null {
    const portfolioData = portfolio;
    const normalized = normalizeEntityReference(reference, portfolioData, index);

    if (normalized.type !== 'node') {
        return resolveEntity(normalized.id, normalized.type, portfolioData, index);
    }

    const location = index
        ? findIndexedNodeLocation(normalized.id, index, normalized.processId)
        : findNodeLocationInPortfolio(normalized.id, portfolioData, normalized.processId);
    if (!location) return null;

    return {
        id: location.node.id,
        type: 'node',
        displayName: location.node.label || 'Untitled Node',
        icon: getNodeTypeIcon(location.node.type),
        subtitle: `${location.node.type} in ${location.process.title}`,
        processId: location.processId,
        path: location.path,
    };
}

export function listEntityCandidates(
    portfolio: Portfolio,
    allowedTypes?: EntityType[],
): EntityCandidate[] {
    const portfolioData = portfolio;
    const allows = (type: EntityType) => !allowedTypes || allowedTypes.includes(type);
    const candidates: EntityCandidate[] = [];

    if (allows('asset')) {
        portfolioData.assets.forEach(asset => {
            const resolved = resolveEntity(asset.id, 'asset', portfolioData);
            candidates.push({
                reference: { id: asset.id, type: 'asset' },
                label: asset.name || 'Unnamed Resource',
                context: resolved?.subtitle || 'Resource',
                icon: resolved?.icon,
                color: resolved?.color,
            });
        });
    }

    if (allows('process')) {
        portfolioData.processes.forEach(process => {
            candidates.push({
                reference: { id: process.id, type: 'process', processId: process.id, path: [] },
                label: process.title || 'Unnamed Process',
                context: 'Process',
                icon: 'LayoutGrid',
            });
        });
    }

    if (allows('node')) {
        portfolioData.processes.forEach(process => {
            const visit = (
                nodes: CanvasNode[],
                path: string[],
                pathLabels: string[],
                visitedSubGraphs: Set<string>,
            ) => {
                nodes.forEach(node => {
                    const nodePath = [...path, node.id];
                    const nodeLabels = [...pathLabels, node.label || 'Untitled Node'];

                    candidates.push({
                        reference: {
                            id: node.id,
                            type: 'node',
                            processId: process.id,
                            path: nodePath,
                        },
                        label: node.label || 'Untitled Node',
                        context: `${process.title}${nodeLabels.length > 1 ? ` / ${nodeLabels.slice(0, -1).join(' / ')}` : ''}`,
                        icon: getNodeTypeIcon(node.type),
                    });

                    const childGraphId = node.subGraphId;
                    const childGraph = childGraphId && process.subGraphs?.[childGraphId];
                    if (childGraph && childGraphId && !visitedSubGraphs.has(childGraphId)) {
                        visit(
                            childGraph.nodes || [],
                            nodePath,
                            nodeLabels,
                            new Set([...visitedSubGraphs, childGraphId]),
                        );
                    }
                });
            };

            visit(process.graph.nodes || [], [], [], new Set());
        });
    }

    if (allows('journalEntry')) {
        portfolioData.journal?.entries.forEach(entry => candidates.push({
            reference: { id: entry.id, type: 'journalEntry' },
            label: entry.title || 'Untitled Note',
            context: 'Journal Entry',
            icon: 'FileText',
        }));
    }

    if (allows('tag')) {
        portfolioData.journal?.tags.forEach(tag => candidates.push({
            reference: { id: tag.id, type: 'tag' },
            label: tag.label,
            context: 'Tag',
            icon: 'Tag',
            color: tag.color,
        }));
    }

    if (allows('incident')) {
        portfolioData.incidents?.forEach(incident => candidates.push({
            reference: { id: incident.id, type: 'incident' },
            label: incident.title,
            context: 'Incident',
            icon: 'AlertTriangle',
        }));
    }

    return candidates;
}

/**
 * Convenience function: Get just the display name
 */
export function getEntityDisplayName(id: string, type: EntityType, portfolio: Portfolio): string {
    const resolved = resolveEntity(id, type, portfolio);
    return resolved?.displayName || `Unknown ${type}`;
}

/**
 * Convenience function: Get just the icon
 */
export function getEntityIcon(id: string, type: EntityType, portfolio: Portfolio): string {
    const resolved = resolveEntity(id, type, portfolio);
    return resolved?.icon || 'HelpCircle';
}

/**
 * Convenience function: Get just the color
 */
export function getEntityColor(id: string, type: EntityType, portfolio: Portfolio): string | undefined {
    const resolved = resolveEntity(id, type, portfolio);
    return resolved?.color;
}

/**
 * Infer entity type from ID (best effort, not guaranteed)
 * Useful for migration from untyped ID arrays
 */
export function inferEntityType(id: string, portfolio: Portfolio): EntityType {
    const portfolioData = portfolio;

    // Resolve against the actual portfolio before consulting legacy prefixes.
    if (portfolioData.assets.some(a => a.id === id)) return 'asset';
    if (portfolioData.processes.some(p => p.id === id)) return 'process';
    if (portfolioData.journal?.entries?.some(e => e.id === id)) return 'journalEntry';
    if (portfolioData.journal?.tags?.some(t => t.id === id)) return 'tag';
    if (portfolioData.incidents?.some(i => i.id === id)) return 'incident';

    // Last resort: check if it's a node (expensive)
    if (findNodeLocationInPortfolio(id, portfolioData)) return 'node';

    // Prefixes are retained only as a final migration fallback for dangling IDs.
    if (id.startsWith('proc-')) return 'process';
    if (id.startsWith('node-')) return 'node';
    if (id.startsWith('res-') || id.startsWith('asset-')) return 'asset';
    if (id.startsWith('entry-') || id.startsWith('je-')) return 'journalEntry';
    if (id.startsWith('tag-')) return 'tag';
    if (id.startsWith('inc-')) return 'incident';

    // Default fallback
    return 'asset';
}
