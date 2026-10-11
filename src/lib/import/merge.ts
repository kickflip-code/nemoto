import { generateId } from '../../lib/id';
import { Process, Asset, CanvasGraph } from '../../types';

interface IDMap {
    edgeIds?: Map<string, string>;
    processIds: Map<string, string>;
    assetIds: Map<string, string>;
    nodeIds: Map<string, string>;
    swimlaneIds?: Map<string, string>;
    subGraphIds?: Map<string, string>;
}

/**
 * Deep clones a process and remaps all IDs (Process ID, Node IDs, Edge IDs)
 * ensuring it can be safely merged into the target portfolio without collisions.
 */
export function cloneProcessForMerge(
    process: Process,
    idMap: IDMap
): Process {
    // 1. Generate new Process ID
    const newProcessId = generateId('process');
    idMap.processIds.set(process.id, newProcessId);

    if (!idMap.subGraphIds) idMap.subGraphIds = new Map();
    const newSubGraphs: Record<string, CanvasGraph> = {};

    if (process.subGraphs) {
        // First pass: generate ID mapping
        Object.keys(process.subGraphs).forEach(sgId => {
            idMap.subGraphIds!.set(sgId, generateId('sg'));
        });

        // Second pass: clone graphs themselves
        Object.entries(process.subGraphs).forEach(([sgId, sgGraph]) => {
            const newSgId = idMap.subGraphIds!.get(sgId)!;
            newSubGraphs[newSgId] = cloneGraphForMerge(sgGraph, idMap);
        });
    }

    // 2. Clone Graph
    const newGraph = cloneGraphForMerge(process.graph, idMap);

    return {
        ...process,
        id: newProcessId,
        title: `${process.title} (Imported)`,
        updatedAt: new Date().toISOString(),
        graph: newGraph,
        subGraphs: newSubGraphs,
        // Reset folderId so it appears at root (otherwise it might point to a non-existent folder and be hidden)
        folderId: undefined,
        // Reset mode or keep it? Keep it.
    };
}

interface IDMap {
    processIds: Map<string, string>;
    assetIds: Map<string, string>;
    nodeIds: Map<string, string>;
    swimlaneIds?: Map<string, string>; // Add swimlane map
    subGraphIds?: Map<string, string>;
}

function cloneGraphForMerge(graph: CanvasGraph, idMap: IDMap): CanvasGraph {
    // 0. Initialize Swimlane Map if needed (for recursion)
    if (!idMap.swimlaneIds) idMap.swimlaneIds = new Map();

    // Safety checks for malformed graphs
    const sourceSwimlanes = graph.swimlanes || [];
    const sourceNodes = graph.nodes || [];
    const sourceEdges = graph.edges || [];

    // 1. Remap Swimlanes First (so nodes can find their new parentId)
    const newSwimlanes = sourceSwimlanes.map(s => {
        const newLaneId = generateId('lane');
        idMap.swimlaneIds?.set(s.id, newLaneId);
        return { ...s, id: newLaneId };
    });

    // 2. Remap Nodes
    const newNodes = sourceNodes.map(node => {
        const newNodeId = generateId('node');
        idMap.nodeIds.set(node.id, newNodeId);

        let newSubGraphId = node.subGraphId;
        if (newSubGraphId && idMap.subGraphIds?.has(newSubGraphId)) {
            newSubGraphId = idMap.subGraphIds.get(newSubGraphId);
        }

        const newNode = {
            ...node,
            id: newNodeId,
            subGraphId: newSubGraphId,
        };

        // Remove old children property if it accidentally exists
        if ('children' in newNode) {
            delete (newNode as any).children;
        }

        return newNode;
    });

    // 3. Second pass for parentId Remapping
    newNodes.forEach(node => {
        if (node.parentId) {
            // Check Node IDs (groups)
            if (idMap.nodeIds.has(node.parentId)) {
                node.parentId = idMap.nodeIds.get(node.parentId);
            }
            // Check Swimlane IDs
            else if (idMap.swimlaneIds?.has(node.parentId)) {
                node.parentId = idMap.swimlaneIds?.get(node.parentId);
            }
        }

        for (const key of ['rowId', 'columnId'] as const) {
            if (node[key]) node[key] = idMap.swimlaneIds?.get(node[key]!) ?? null;
        }
        // Remap direct swimlaneId property (Legacy/Dual support)
        if (node.swimlaneId && idMap.swimlaneIds?.has(node.swimlaneId)) {
            node.swimlaneId = idMap.swimlaneIds?.get(node.swimlaneId);
        }
    });

    // 4. Remap Edges
    const newEdges = sourceEdges.map(edge => {
        const newEdgeId = generateId('edge');
        idMap.edgeIds?.set(edge.id, newEdgeId);
        const rawSource = edge.sourceHandleId || (edge as any).sourceHandle;
        const rawTarget = edge.targetHandleId || (edge as any).targetHandle;

        const normalize = (val: string | undefined, prefix: 's' | 't') => {
            if (!val) return undefined;
            if (val.startsWith(prefix + '-')) return val; // Already has prefix
            if (['top', 'right', 'bottom', 'left'].includes(val)) return `${prefix}-${val}`; // Add prefix
            return val;
        };

        const sourceHandleId = normalize(rawSource, 's');
        const targetHandleId = normalize(rawTarget, 't');

        return {
            ...edge,
            id: newEdgeId,
            sourceId: idMap.nodeIds.get(edge.sourceId) || edge.sourceId,
            targetId: idMap.nodeIds.get(edge.targetId) || edge.targetId,
            sourceHandle: sourceHandleId,
            targetHandle: targetHandleId,
            sourceHandleId,
            targetHandleId
        };
    });

    return {
        ...graph,
        nodes: newNodes,
        edges: newEdges,
        swimlanes: newSwimlanes
    };
}

export function cloneAssetForMerge(asset: Asset, idMap: IDMap): Asset {
    const newId = generateId('asset');
    idMap.assetIds.set(asset.id, newId);

    return {
        ...asset,
        id: newId,
        // Parent ID (folder/category?) No, asset parentId is for hierarchy.
        // If parent is also being imported, we need to remap.
        // If not, we keep it? 
        // This requires knowing if parent is in the import set.
        // For now, assume flat or handle later.
    };
}
export function resolveJournalContent(content: string, assetNameMap: Map<string, string>): string {
    let resolvedContent = content;
    assetNameMap.forEach((newName, oldName) => {
        // Replace @[Old Name] with @[New Name]
        // Use global regex with escaped brackets
        const regex = new RegExp(`@\\[${escapeRegExp(oldName)}\\]`, 'g');
        resolvedContent = resolvedContent.replace(regex, `@[${newName}]`);
    });
    return resolvedContent;
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
