import { generateId } from '../../lib/id';
import { cloneProcessForMerge } from '../../lib/import/merge';
import { isGraphStructurallyEmpty, resolveDrilldownNodeAtPath } from '../../lib/drilldownGraph';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import type { Portfolio, Process, CanvasGraph } from '../../types';

// Helper to create a new graph based on the mode
export const createGraphForMode = (currentGraph: CanvasGraph, mode: string): CanvasGraph => {
    let newGraph = { ...currentGraph, mode: mode as any };

    if (mode === 'blank') {
        newGraph.swimlanes = [];
    } else {
        if (mode === 'blank' || newGraph.swimlanes.length === 0) {
            newGraph.swimlanes = [
                { id: generateId('lane'), label: 'End User', color: 'blue', order: 0, height: 300, width: 300 },
                { id: generateId('lane'), label: 'System', color: 'purple', order: 1, height: 300, width: 300 },
                { id: generateId('lane'), label: 'Backend', color: 'green', order: 2, height: 300, width: 300 }
            ];
        }
    }
    return newGraph;
};


export const addProcessLogic = (
    portfolio: Portfolio,
    process: Process
): Portfolio => ({
    ...portfolio,
    processes: [...portfolio.processes, process],
});

export const updateProcessLogic = (
    portfolio: Portfolio,
    id: string,
    updates: Partial<Process>
): Portfolio => {
    return {
        ...portfolio,
        processes: portfolio.processes.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
        ),
    };
};

export const deleteProcessLogic = (
    portfolio: Portfolio,
    ids: string[],
    currentActiveProcessId: string | null,
    deleteOrphanedAssets: boolean = false
): { portfolio: Portfolio, activeProcessId: string | null } => {

    let assetIdsToDelete = new Set<string>();
    let journalEntryIdsToDelete = new Set<string>();

    if (deleteOrphanedAssets) {
        // 1. Assets
        const assetsInDeletedProcesses = new Set<string>();
        portfolio.processes.filter(p => ids.includes(p.id)).forEach(p => {
            if (p.ownerId) assetsInDeletedProcesses.add(p.ownerId);
            p.graph.nodes.forEach(n => {
                n.assetIds?.forEach(id => assetsInDeletedProcesses.add(id));
                const resourceId = getResourceReferenceAssetId(n);
                if (resourceId) assetsInDeletedProcesses.add(resourceId);
            });
            if (p.subGraphs) {
                Object.values(p.subGraphs).forEach(sg => {
                    sg.nodes.forEach(n => {
                        n.assetIds?.forEach(id => assetsInDeletedProcesses.add(id));
                        const resourceId = getResourceReferenceAssetId(n);
                        if (resourceId) assetsInDeletedProcesses.add(resourceId);
                    });
                });
            }
        });

        const assetsInKeptProcessesAndJournal = new Set<string>();
        portfolio.processes.filter(p => !ids.includes(p.id)).forEach(p => {
            if (p.ownerId) assetsInKeptProcessesAndJournal.add(p.ownerId);
            p.graph.nodes.forEach(n => {
                n.assetIds?.forEach(id => assetsInKeptProcessesAndJournal.add(id));
                const resourceId = getResourceReferenceAssetId(n);
                if (resourceId) assetsInKeptProcessesAndJournal.add(resourceId);
            });
            if (p.subGraphs) {
                Object.values(p.subGraphs).forEach(sg => {
                    sg.nodes.forEach(n => {
                        n.assetIds?.forEach(id => assetsInKeptProcessesAndJournal.add(id));
                        const resourceId = getResourceReferenceAssetId(n);
                        if (resourceId) assetsInKeptProcessesAndJournal.add(resourceId);
                    });
                });
            }
        });

        portfolio.assets.forEach(asset => {
            if (asset.parentId) assetsInKeptProcessesAndJournal.add(asset.parentId);
        });

        portfolio.journal?.entries.forEach(entry => {
            entry.linkedContext?.forEach(ctx => {
                if (ctx.type === 'asset') {
                    assetsInKeptProcessesAndJournal.add(ctx.id);
                }
            });
        });

        for (const assetId of assetsInDeletedProcesses) {
            if (!assetsInKeptProcessesAndJournal.has(assetId)) {
                assetIdsToDelete.add(assetId);
            }
        }

        // 2. Journal Entries
        // A journal entry is orphaned if it ONLY links to the processes being deleted,
        // (and it ACTUALLY links to at least one of them), and links to nothing else.
        portfolio.journal?.entries.forEach(entry => {
            if (!entry.linkedContext || entry.linkedContext.length === 0) return;

            let linksToDeletedProcess = false;
            let linksToSomethingElse = false;

            entry.linkedContext.forEach(ctx => {
                if (ctx.type === 'process' && ids.includes(ctx.id)) {
                    linksToDeletedProcess = true;
                } else {
                    linksToSomethingElse = true;
                }
            });

            if (linksToDeletedProcess && !linksToSomethingElse) {
                journalEntryIdsToDelete.add(entry.id);
            }
        });
    }

    // 2. Filter out processes
    const newProcesses = portfolio.processes.filter((p) => !ids.includes(p.id));

    // 3. Filter out orphaned assets
    let newAssets = portfolio.assets;
    if (assetIdsToDelete.size > 0) {
        newAssets = portfolio.assets.filter(a => !assetIdsToDelete.has(a.id));
    }

    // 4. Clean up Journal (Filter out deleted entries AND remove dead links from survivors)
    let newJournal = portfolio.journal;
    if (portfolio.journal) {
        const survivingEntries = portfolio.journal.entries
            .filter(e => !journalEntryIdsToDelete.has(e.id))
            .map(e => ({
                ...e,
                linkedContext: e.linkedContext?.filter(ctx => !(ctx.type === 'process' && ids.includes(ctx.id))) || []
            }));

        newJournal = {
            ...portfolio.journal,
            entries: survivingEntries
        };
    }

    return {
        portfolio: {
            ...portfolio,
            processes: newProcesses,
            assets: newAssets,
            journal: newJournal
        },
        activeProcessId: currentActiveProcessId && ids.includes(currentActiveProcessId)
            ? (newProcesses.length > 0 ? newProcesses[0].id : null)
            : currentActiveProcessId,
    };
};

export const duplicateProcessLogic = (
    portfolio: Portfolio,
    id: string
): Portfolio => {
    const original = portfolio.processes.find(p => p.id === id);
    if (!original) return portfolio;

    const idMap = {
        processIds: new Map<string, string>(),
        assetIds: new Map<string, string>(),
        nodeIds: new Map<string, string>(),
        swimlaneIds: new Map<string, string>(),
        subGraphIds: new Map<string, string>(),
    };
    const duplicated = cloneProcessForMerge(original, idMap);
    const now = new Date().toISOString();
    const newProcess: Process = {
        ...duplicated,
        title: `${original.title} (Copy)`,
        folderId: original.folderId,
        createdAt: now,
        updatedAt: now,
    };

    return {
        ...portfolio,
        processes: [...portfolio.processes, newProcess]
    };
};

export const updateProcessGraphLogic = (
    portfolio: Portfolio,
    processId: string,
    graph: CanvasGraph,
    breadcrumbStack: string[]
): Portfolio => {
    const process = portfolio.processes.find(p => p.id === processId);
    if (!process) return portfolio;

    if (breadcrumbStack.length === 0) {
        // Updating root process graph
        return {
            ...portfolio,
            processes: portfolio.processes.map((p) =>
                p.id === processId ? { ...p, graph, updatedAt: new Date().toISOString() } : p
            ),
        };
    } else {
        const location = resolveDrilldownNodeAtPath(process, breadcrumbStack);
        if (!location) return portfolio;

        let targetSubGraphId = location.node.subGraphId || undefined;
        const isDraft = !targetSubGraphId || !process.subGraphs?.[targetSubGraphId];

        // Opening, panning, or closing an untouched draft is not a portfolio
        // edit. The link is materialized only after structural content exists.
        if (isDraft && isGraphStructurallyEmpty(graph)) return portfolio;

        if (targetSubGraphId && location.ancestorSubGraphIds.includes(targetSubGraphId)) {
            // Never write through a cycle, even if malformed imported data or a
            // prior bug left one in the portfolio.
            return portfolio;
        }

        if (!targetSubGraphId) {
            do {
                targetSubGraphId = generateId('sg');
            } while (process.subGraphs?.[targetSubGraphId]);
        }

        const newSubGraphs: Record<string, CanvasGraph> = {
            ...(process.subGraphs || {}),
            [targetSubGraphId]: graph,
        };
        let newMainGraph = process.graph;

        if (!location.node.subGraphId) {
            const linkedContainingGraph: CanvasGraph = {
                ...location.graph,
                nodes: location.graph.nodes.map(node => (
                    node.id === location.node.id ? { ...node, subGraphId: targetSubGraphId } : node
                )),
            };

            if (location.graphId === null) {
                newMainGraph = linkedContainingGraph;
            } else {
                newSubGraphs[location.graphId] = linkedContainingGraph;
            }
        }

        return {
            ...portfolio,
            processes: portfolio.processes.map((candidate) => (
                candidate.id === processId
                    ? {
                        ...candidate,
                        graph: newMainGraph,
                        subGraphs: newSubGraphs,
                        updatedAt: new Date().toISOString(),
                    }
                    : candidate
            )),
        };
    }
};

export const convertProcessLogic = (
    portfolio: Portfolio,
    id: string,
    newMode: 'swimlane' | 'swimlane-vertical' | 'blank',
    subprocessNodeId: string | undefined, // Renamed to clarify it's a node ID
    currentActiveProcessId: string | null,
    breadcrumbStack: string[]
): { portfolio: Portfolio, syncGraph?: CanvasGraph } | null => {
    const process = portfolio.processes.find(p => p.id === id);
    if (!process) return null;

    // Helper to check if we need to update the active canvas
    const getSyncGraph = (targetGraph: CanvasGraph, targetSubGraphId: string | undefined): CanvasGraph | undefined => {
        if (currentActiveProcessId !== id) return undefined;

        if (!targetSubGraphId && breadcrumbStack.length === 0) {
            return targetGraph;
        } else if (targetSubGraphId && breadcrumbStack.length > 0) {
            const currentId = breadcrumbStack[breadcrumbStack.length - 1];
            if (currentId === targetSubGraphId) return targetGraph;
        }
        return undefined;
    };

    if (!subprocessNodeId) {
        if (process.mode === newMode) return null;
        const newGraph = createGraphForMode(process.graph, newMode);
        return {
            portfolio: {
                ...portfolio,
                processes: portfolio.processes.map(p =>
                    p.id === id ? { ...p, mode: newMode, graph: newGraph, updatedAt: new Date().toISOString() } : p
                )
            },
            syncGraph: getSyncGraph(newGraph, undefined)
        };
    }

    // We need to find the node across the main graph and all subgraphs
    let targetNode: any = null;
    let containingGraphId: string | null = null; // null means main process.graph

    const findNode = (graph: CanvasGraph, graphId: string | null) => {
        const node = graph.nodes.find(n => n.id === subprocessNodeId);
        if (node) {
            targetNode = node;
            containingGraphId = graphId;
            return true;
        }
        return false;
    };

    if (!findNode(process.graph, null)) {
        if (process.subGraphs) {
            Object.entries(process.subGraphs).some(([sgId, sgGraph]) => findNode(sgGraph, sgId));
        }
    }

    if (!targetNode) return null; // Node not found

    let targetSubGraphId = targetNode.subGraphId;
    let oldSubGraph = targetSubGraphId && process.subGraphs ? process.subGraphs[targetSubGraphId] : undefined;

    // Create new graph or update existing
    const updatedGraph = createGraphForMode(
        oldSubGraph || { nodes: [], edges: [], swimlanes: [], mode: 'swimlane' },
        newMode
    );

    targetSubGraphId = targetSubGraphId || generateId('sg');
    const newSubGraphs: Record<string, CanvasGraph> = { ...(process.subGraphs || {}), [targetSubGraphId]: updatedGraph };

    // We also need to update the node to ensure it has the subGraphId
    // since we use immutable state, we must clone the containing graph
    const updateContainingGraph = (graph: CanvasGraph): CanvasGraph => ({
        ...graph,
        nodes: graph.nodes.map(n => n.id === subprocessNodeId ? { ...n, subGraphId: targetSubGraphId } : n)
    });

    let newMainGraph = process.graph;
    if (containingGraphId === null) {
        newMainGraph = updateContainingGraph(process.graph);
    } else {
        newSubGraphs[containingGraphId as string] = updateContainingGraph(newSubGraphs[containingGraphId as string]);
    }

    return {
        portfolio: {
            ...portfolio,
            processes: portfolio.processes.map(p =>
                p.id === id
                    ? { ...p, graph: newMainGraph, subGraphs: newSubGraphs, updatedAt: new Date().toISOString() }
                    : p
            )
        },
        syncGraph: getSyncGraph(updatedGraph, targetSubGraphId)
    };
};
