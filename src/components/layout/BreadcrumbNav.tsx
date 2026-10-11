import { ChevronRight, Folder, GitBranch } from 'lucide-react';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import type { CanvasNode, CanvasGraph } from '../../types';

export default function BreadcrumbNav() {
    const breadcrumbStack = useProcessSessionStore((s) => s.breadcrumbStack);
    const activeProcessId = useProcessSessionStore((s) => s.activeProcessId);
    const portfolio = usePortfolioStore((s) => s.portfolio);
    const resetBreadcrumb = useProcessSessionStore((s) => s.resetBreadcrumb);
    const setBreadcrumbStack = useProcessSessionStore((s) => s.setBreadcrumbStack);

    // Don't render if we're at root level (or optionally show just the process name)
    if (breadcrumbStack.length === 0) return null;

    // Get the active process
    const activeProcess = portfolio.processes.find(p => p.id === activeProcessId);
    if (!activeProcess) return null;

    // Build breadcrumb labels from node IDs
    const crumbs: { id: string; label: string }[] = [];
    let currentGraph: CanvasGraph = activeProcess.graph;

    for (const nodeId of breadcrumbStack) {
        const node = currentGraph.nodes.find((n: CanvasNode) => n.id === nodeId);
        if (node) {
            crumbs.push({ id: nodeId, label: node.label ?? '' });
            if (node.subGraphId && activeProcess.subGraphs) {
                const nextGraph = activeProcess.subGraphs[node.subGraphId];
                if (!nextGraph) break;
                currentGraph = nextGraph;
            }
        } else break;
    }

    // Navigate to a specific level
    const navigateToLevel = (levelIndex: number) => {
        if (levelIndex === -1) {
            resetBreadcrumb();
            useCanvasStore.getState().loadGraph(activeProcess.graph);
            return;
        }

        const newStack = breadcrumbStack.slice(0, levelIndex + 1);
        setBreadcrumbStack(newStack);

        let graph: CanvasGraph = activeProcess.graph;
        for (let i = 0; i < newStack.length; i++) {
            const node = graph.nodes.find((n: CanvasNode) => n.id === newStack[i]);
            if (node?.subGraphId && activeProcess.subGraphs) {
                const nextGraph = activeProcess.subGraphs[node.subGraphId];
                if (!nextGraph) break;
                graph = nextGraph;
            }
        }
        useCanvasStore.getState().loadGraph(graph);
    };

    const goBack = () => {
        if (breadcrumbStack.length <= 1) {
            navigateToLevel(-1);
        } else {
            navigateToLevel(breadcrumbStack.length - 2);
        }
    };

    return (
        <div className="flex w-max items-center gap-1.5 px-3 py-1 bg-app-surface/40 rounded-md text-[11px]">
            {/* Back Arrow */}
            <button
                onClick={goBack}
                className="mr-2 text-text-faint hover:text-text-main transition-colors"
                title="Go back"
                aria-label="Go back"
            >
                ←
            </button>

            {/* Root / Home */}
            <button
                onClick={() => navigateToLevel(-1)}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-app-hover text-text-muted hover:text-text-main axiom-transition-interactive group"
            >
                <Folder size={12} className="text-text-faint group-hover:text-text-main transition-colors" />
                <span className="font-medium tracking-tight">{activeProcess.title}</span>
            </button>

            {/* Crumbs */}
            {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1;
                return (
                    <div key={`${crumb.id}-${index}`} className="flex items-center">
                        <ChevronRight size={12} className="text-text-faint/30 mx-0.5" />
                        <button
                            onClick={() => navigateToLevel(index)}
                            disabled={isLast}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded axiom-transition-interactive ${isLast
                                ? 'text-accent-primary font-bold bg-accent-primary/10 shadow-glow-primary'
                                : 'text-text-muted hover:bg-app-hover hover:text-text-main group'
                                }`}
                        >
                            {!isLast && <GitBranch size={12} className="text-text-faint group-hover:text-text-main transition-colors" />}
                            <span className="tracking-tight">{crumb.label}</span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
