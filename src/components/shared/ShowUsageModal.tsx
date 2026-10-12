import { X, LayoutGrid, FileText, Server, ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useUIStore } from '../../stores/useUIStore';
import { useJournalStore } from '../../stores/useJournalStore';
import { useMemo } from 'react';
import type { CanvasGraph } from '../../types';
import { NemotoDialog } from '../ui';

interface ShowUsageModalProps {
    resourceId: string;
    resourceName: string;
    onClose: () => void;
}

export default function ShowUsageModal({ resourceId, resourceName, onClose }: ShowUsageModalProps) {
    const portfolio = usePortfolioStore(s => s.portfolio);
    const { setActiveProcess, setBreadcrumbStack, resetBreadcrumb } = useProcessSessionStore();
    const { setActiveView } = useUIStore();
    const { selectEntry } = useJournalStore();

    // Calculate usage across processes and journal
    const usage = useMemo(() => {
        const processesUsingIt: { id: string; title: string; nodePath?: string[] }[] = [];
        const nodesUsingIt: { id: string; label: string; processId: string; processTitle: string }[] = [];
        const entriesUsingIt: { id: string; title: string }[] = [];

        // Helper to recursively search graph nodes
        const searchGraph = (
            graphNodes: any[],
            process: any, // passed whole process
            processTitle: string,
            pathLabels: string[] = [],
            pathNodeIds: string[] = [],
            visitedSubGraphIds: Set<string> = new Set(),
        ) => {
            const processId = process.id;
            graphNodes.forEach((node: any) => {
                // Check if node has this resource linked
                if (node.linkedAssets?.includes(resourceId) || node.assetIds?.includes(resourceId)) {
                    nodesUsingIt.push({
                        id: node.id,
                        label: node.label || 'Unnamed Node',
                        processId,
                        processTitle: pathLabels.length > 0 ? `${processTitle} → ${pathLabels.join(' → ')}` : processTitle
                    });
                }
                // Check if this IS the resource (node with matching ID)
                if (node.id === resourceId) {
                    if (!processesUsingIt.find(p => p.id === processId && JSON.stringify(p.nodePath) === JSON.stringify(pathNodeIds))) {
                        processesUsingIt.push({
                            id: processId,
                            title: pathLabels.length > 0 ? `${processTitle} → ${pathLabels.join(' → ')}` : processTitle,
                            nodePath: pathNodeIds.length > 0 ? [...pathNodeIds] : undefined
                        });
                    }
                }
                // Recursively search subprocesses
                if (
                    node.subGraphId
                    && process.subGraphs?.[node.subGraphId]
                    && !visitedSubGraphIds.has(node.subGraphId)
                ) {
                    visitedSubGraphIds.add(node.subGraphId);
                    searchGraph(
                        process.subGraphs[node.subGraphId].nodes,
                        process,
                        processTitle,
                        [...pathLabels, node.label || 'Subprocess'],
                        [...pathNodeIds, node.id],
                        visitedSubGraphIds,
                    );
                }
            });
        };

        // Search all processes
        portfolio.processes.forEach(process => {
            searchGraph(process.graph.nodes, process, process.title);
        });

        // Search journal entries for linked context
        if (portfolio.journal?.entries) {
            portfolio.journal.entries.forEach((entry: any) => {
                const linkedIds = entry.linkedContext?.map((l: any) => l.id) || [];
                if (linkedIds.includes(resourceId)) {
                    entriesUsingIt.push({ id: entry.id, title: entry.title || 'Untitled Note' });
                }
            });
        }

        return { processes: processesUsingIt, nodes: nodesUsingIt, entries: entriesUsingIt };
    }, [resourceId, portfolio]);

    const handleNavigateToProcess = (processId: string, nodePath?: string[]) => {
        setActiveProcess(processId);
        if (nodePath && nodePath.length > 0) {
            setBreadcrumbStack(nodePath);
            // Load subprocess graph
            const process = portfolio.processes.find(p => p.id === processId);
            if (process) {
                let graph: CanvasGraph = process.graph;
                for (const nodeId of nodePath) {
                    const node = graph.nodes.find((n: any) => n.id === nodeId);
                    if (node?.subGraphId && process.subGraphs) {
                        const nextGraph = process.subGraphs[node.subGraphId];
                        if (!nextGraph) break;
                        graph = nextGraph;
                    }
                }
                // The canvas graph is loaded by the process-session synchronization.
            }
        } else {
            resetBreadcrumb();
        }
        setActiveView('designer');
        onClose();
    };

    const handleNavigateToEntry = (entryId: string) => {
        selectEntry(entryId);
        useUIStore.getState().expandJournalPanel();
        onClose();
    };

    const totalUsage = usage.processes.length + usage.nodes.length + usage.entries.length;

    return createPortal(
        <NemotoDialog
            aria-labelledby="show-usage-title"
            onClose={onClose}
            panelClassName="w-[400px] max-h-[500px] flex flex-col overflow-hidden"
        >
                {/* Header */}
                <div className="nemoto-dialog-header flex items-center justify-between px-4 py-3 border-b">
                    <div>
                        <h2 id="show-usage-title" className="text-sm font-semibold text-text-main">Usage: {resourceName}</h2>
                        <p className="text-[10px] text-text-faint mt-0.5">
                            {totalUsage === 0 ? 'Not used anywhere' : `Used in ${totalUsage} places`}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close usage dialog"
                        className="nemoto-icon-button nemoto-icon-button-sm nemoto-icon-button-ghost"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div className="nemoto-dialog-body flex-1 overflow-y-auto p-4 space-y-4">
                    {totalUsage === 0 ? (
                        <div className="text-center py-8 text-text-faint text-xs">
                            This resource is not linked to any processes or journal entries.
                        </div>
                    ) : (
                        <>
                            {/* Processes */}
                            {usage.processes.length > 0 && (
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 flex items-center gap-1.5">
                                        <LayoutGrid size={10} />
                                        Processes ({usage.processes.length})
                                    </div>
                                    <div className="space-y-1">
                                        {usage.processes.map((p, idx) => (
                                            <button
                                                key={`${p.id}-${idx}`}
                                                onClick={() => handleNavigateToProcess(p.id, p.nodePath)}
                                                className="nemoto-dialog-row w-full text-left px-3 py-2 text-xs flex items-center gap-2 group"
                                            >
                                                <LayoutGrid size={12} className="text-text-faint" />
                                                <span className="flex-1 truncate">{p.title}</span>
                                                <ChevronRight size={12} className="text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Nodes */}
                            {usage.nodes.length > 0 && (
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 flex items-center gap-1.5">
                                        <Server size={10} />
                                        Linked in Nodes ({usage.nodes.length})
                                    </div>
                                    <div className="space-y-1">
                                        {usage.nodes.map((n, idx) => (
                                            <button
                                                key={`${n.id}-${idx}`}
                                                onClick={() => handleNavigateToProcess(n.processId)}
                                                className="nemoto-dialog-row w-full text-left px-3 py-2 text-xs flex items-center gap-2 group"
                                            >
                                                <Server size={12} className="text-accent-primary" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="truncate">{n.label}</div>
                                                    <div className="text-[10px] text-text-faint truncate">in {n.processTitle}</div>
                                                </div>
                                                <ChevronRight size={12} className="text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Journal Entries */}
                            {usage.entries.length > 0 && (
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 flex items-center gap-1.5">
                                        <FileText size={10} />
                                        Journal Entries ({usage.entries.length})
                                    </div>
                                    <div className="space-y-1">
                                        {usage.entries.map(e => (
                                            <button
                                                key={e.id}
                                                onClick={() => handleNavigateToEntry(e.id)}
                                                className="nemoto-dialog-row w-full text-left px-3 py-2 text-xs flex items-center gap-2 group"
                                            >
                                                <FileText size={12} className="text-accent-warning" />
                                                <span className="flex-1 truncate">{e.title}</span>
                                                <ChevronRight size={12} className="text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="nemoto-dialog-footer px-4 py-3 border-t flex justify-end">
                    <button
                        onClick={onClose}
                        className="nemoto-button nemoto-button-sm"
                    >
                        Close
                    </button>
                </div>
        </NemotoDialog>,
        document.body,
    );
}
