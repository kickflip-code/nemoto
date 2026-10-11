import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Box, Book, Server, Command, ArrowRight, X, GitMerge } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';

import { useJournalStore } from '../../stores/useJournalStore';
import { useReactFlow } from 'reactflow';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { motion } from 'framer-motion';
import {
    dialogOverlayMotion,
    dialogPanelMotion,
    getMotionDurationMs,
    motionDurationMs,
} from '../../lib/motion';
import type { DeclarativePluginRuntime } from '../../plugins/declarativeRuntime';
import { searchPluginCommands } from '../../plugins/commandSearch';
import { executePluginCommand } from '../../host/pluginCommands';
import { ExecutableProposalCommandContextError } from '../../host/pluginExecutableProposalCommands';
import { usePluginHostServices } from '../plugins/PluginHostServicesContext';
import { toast } from 'sonner';
import type { CanvasGraph } from '../../types';

const MAX_SEARCH_VALUE_DEPTH = 12;

const normalize = (
    value: unknown,
    seen: WeakSet<object> = new WeakSet<object>(),
    depth = 0,
): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
        if (depth >= MAX_SEARCH_VALUE_DEPTH || seen.has(value)) return '';
        seen.add(value);

        if (Array.isArray(value)) {
            return value
                .map(item => normalize(item, seen, depth + 1))
                .filter(Boolean)
                .join(' ');
        }

        return Object.entries(value as Record<string, unknown>)
            .map(([key, item]) => `${key} ${normalize(item, seen, depth + 1)}`)
            .filter(Boolean)
            .join(' ');
    }
    return '';
};

const matches = (query: string, ...values: unknown[]) =>
    values.some(value => normalize(value).toLowerCase().includes(query));

const metadataMatchLabel = (metadata: Record<string, unknown> | null | undefined, query: string): string | undefined => {
    if (!metadata) return undefined;
    for (const [key, value] of Object.entries(metadata)) {
        if (matches(query, key, value)) {
            const normalizedValue = normalize(value);
            return normalizedValue ? `${key}: ${normalizedValue}` : key;
        }
    }
    return undefined;
};

interface OmniboxProps {
    pluginRuntime?: DeclarativePluginRuntime;
}

export default function Omnibox({ pluginRuntime }: OmniboxProps) {
    const { omniboxOpen, closeOmnibox, setActiveView, selectAsset, expandJournalPanel, linkingTarget, setLinkingTarget } = useUIStore();
    const portfolio = usePortfolioStore(s => s.portfolio);
    const { setActiveProcess, resetBreadcrumb, setBreadcrumbStack } = useProcessSessionStore();

    const { selectEntry, linkContext } = useJournalStore();
    const { setCenter } = useReactFlow();
    const pluginHost = usePluginHostServices();

    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter Logic
    const results = useMemo(() => {
        if (!query.trim()) return [];
        const lower = query.toLowerCase();

        const journalMatches = (portfolio.journal?.entries || [])
            .filter(e => matches(lower, e.title, e.content, e.tags))
            .map(e => ({ type: 'note', id: e.id, label: e.title, sub: 'Journal entry', icon: Book }));

        // Linking mode is deliberately note-only. Apart from being clearer for the
        // user, this avoids doing unrelated portfolio-wide work on every keystroke.
        if (linkingTarget) return journalMatches.slice(0, 12);

        const processMatches = (portfolio.processes || [])
            .filter(p => matches(lower, p.title, p.description))
            .map(p => ({
                type: 'process',
                id: p.id,
                label: p.title,
                sub: 'Process',
                processId: p.id,
                icon: GitMerge
            }));

        const nodeMatches = (portfolio.processes || []).flatMap(process => {
            const results: any[] = [];
            const visitedSubGraphs = new Set<string>();
            const graphsToVisit: Array<{
                graph: CanvasGraph;
                breadcrumbPath: string[];
                pathLabel: string;
            }> = [{ graph: process.graph, breadcrumbPath: [], pathLabel: process.title }];

            for (let graphIndex = 0; graphIndex < graphsToVisit.length; graphIndex += 1) {
                const { graph, breadcrumbPath, pathLabel } = graphsToVisit[graphIndex];
                (graph?.nodes || []).forEach(node => {
                    const nodeText = [node.label, node.type, node.data?.description, node.data?.eyebrow, node.data];
                    if (matches(lower, ...nodeText)) {
                        results.push({
                            type: 'node',
                            id: node.id,
                            label: node.label || 'Untitled node',
                            sub: breadcrumbPath.length ? `Node in ${pathLabel}` : `Node in ${process.title}`,
                            processId: process.id,
                            breadcrumbPath,
                            icon: Box
                        });
                    }

                    const subGraphId = node.subGraphId;
                    const subGraph = subGraphId ? process.subGraphs?.[subGraphId] : undefined;
                    if (subGraphId && subGraph && !visitedSubGraphs.has(subGraphId)) {
                        visitedSubGraphs.add(subGraphId);
                        graphsToVisit.push({
                            graph: subGraph,
                            breadcrumbPath: [...breadcrumbPath, node.id],
                            pathLabel: `${pathLabel} / ${node.label || 'Drilldown'}`,
                        });
                    }
                });
            }

            return results;
        });

        const assetMatches = (portfolio.assets || [])
            .map(asset => {
                const category = portfolio.assetCategories?.find(c => c.id === asset.type);
                const metadataLabel = metadataMatchLabel(asset.metadata, lower);
                const isMatch = matches(lower, asset.name, asset.type, category?.label, category?.baseType, asset.metadata);
                if (!isMatch) return null;
                return {
                    type: 'asset',
                    id: asset.id,
                    label: asset.name,
                    sub: metadataLabel ? `Resource metadata · ${metadataLabel}` : `Resource · ${category?.label || asset.type}`,
                    icon: Server
                };
            })
            .filter(Boolean);

        const commandMatches = pluginRuntime?.status !== 'ready'
            ? []
            : searchPluginCommands(pluginRuntime.commands, query).map(command => ({
                type: 'plugin-command',
                id: command.id,
                label: command.title,
                sub: `Command · ${command.pluginId}`,
                icon: Command,
            }));

        return [
            ...commandMatches,
            ...processMatches,
            ...nodeMatches,
            ...assetMatches,
            ...journalMatches,
        ].slice(0, 12);
    }, [linkingTarget, pluginRuntime, query, portfolio]);

    // Keyboard Handling
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!omniboxOpen) return;

            if (e.key === 'Escape') closeOmnibox();
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(prev => (prev + 1) % Math.max(results.length, 1));
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
            }
            if (e.key === 'Enter' && results[selectedIndex]) {
                void handleSelect(results[selectedIndex]);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [omniboxOpen, results, selectedIndex, closeOmnibox]);

    // Focus input on open
    useEffect(() => {
        if (omniboxOpen) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [omniboxOpen]);

    const handleSelect = async (result: any) => {
        if (linkingTarget) {
            if (result.type === 'note') {
                linkContext(result.id, { id: linkingTarget.id, type: linkingTarget.type });
                setLinkingTarget(null);
                closeOmnibox();
                return;
            }
        }

        if (result.type === 'plugin-command' && pluginRuntime) {
            try {
                const execution = await executePluginCommand(
                    pluginRuntime.commands,
                    result.id,
                    pluginHost,
                );
                closeOmnibox();
                if (execution.action === 'compute.propose') {
                    toast.success('Plugin proposal sent to review.');
                }
            } catch (error) {
                console.error('[Omnibox] Plugin command failed:', error);
                toast.error(error instanceof ExecutableProposalCommandContextError
                    ? error.message
                    : 'The command could not be run.');
            }
            return;
        }

        if (result.type === 'process') {
            setActiveProcess(result.id);
            resetBreadcrumb();
            setActiveView('designer');
        } else if (result.type === 'node') {
            setActiveProcess(result.processId);
            setBreadcrumbStack(result.breadcrumbPath || []);
            const process = portfolio.processes.find(p => p.id === result.processId);
            if (process) {
                let graph = process.graph;
                for (const nodeId of result.breadcrumbPath || []) {
                    const parentNode = graph.nodes.find(n => n.id === nodeId);
                    if (parentNode?.subGraphId && process.subGraphs?.[parentNode.subGraphId]) {
                        graph = process.subGraphs[parentNode.subGraphId];
                    }
                }
                useCanvasStore.getState().loadGraph(graph);
            }
            setActiveView('designer');
            setTimeout(() => {
                const targetProcess = portfolio.processes.find(p => p.id === result.processId);
                let graph = targetProcess?.graph;
                for (const nodeId of result.breadcrumbPath || []) {
                    const parentNode = graph?.nodes.find(n => n.id === nodeId);
                    if (parentNode?.subGraphId && targetProcess?.subGraphs?.[parentNode.subGraphId]) {
                        graph = targetProcess.subGraphs[parentNode.subGraphId];
                    }
                }
                const node = graph?.nodes.find(n => n.id === result.id);
                if (node) {
                    setCenter(node.position.x, node.position.y, {
                        zoom: 1.5,
                        duration: getMotionDurationMs(motionDurationMs.camera),
                    });
                }
            }, 100);
        } else if (result.type === 'note') {
            selectEntry(result.id);
            expandJournalPanel();
        } else if (result.type === 'asset') {
            selectAsset(result.id);
        }
        closeOmnibox();
    };

    return createPortal(
        <motion.div
            {...dialogOverlayMotion}
            className="fixed inset-0 z-[10100] flex items-start justify-center pt-[15vh] px-4"
        >
            {/* Backdrop */}
            <div className="axiom-dialog-backdrop absolute inset-0" onClick={closeOmnibox} />

            {/* Modal Container */}
            <motion.div
                {...dialogPanelMotion}
                className="axiom-omnibox-modal w-full max-w-2xl overflow-hidden flex flex-col relative z-10"
            >

                {/* Search Header */}
                <div className="relative group flex items-center">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-text-faint group-focus-within:text-accent-primary transition-colors" />
                    <input
                        ref={inputRef}
                        type="text"
                        aria-label={linkingTarget ? `Search notes to link to ${linkingTarget.name}` : 'Search Nemoto'}
                        placeholder={linkingTarget ? 'Search notes to link...' : 'Search Nemoto...'}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="axiom-omnibox-input min-w-0 flex-1 bg-transparent border-none py-6 pl-[4.5rem] pr-3 text-lg placeholder-text-faint/30 outline-none"
                    />
                    <div role="group" aria-label="Omnibox controls" className="flex shrink-0 items-center gap-2 pr-6">
                        {linkingTarget && (
                            <div className="axiom-omnibox-chip axiom-omnibox-chip-accent hidden sm:flex items-center gap-1.5 px-2 py-1 mr-2">
                                <span className="text-[10px] text-accent-primary font-bold uppercase tracking-widest">Linking Mode</span>
                                <button
                                    type="button"
                                    aria-label="Exit linking mode"
                                    onClick={() => setLinkingTarget(null)}
                                    className="axiom-panel-icon-button axiom-icon-button-sm axiom-omnibox-chip-close"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        )}
                        <div className="axiom-omnibox-kbd flex items-center gap-1.5 px-2 py-1">
                            <span className="text-[10px] text-text-faint font-mono">ESC</span>
                        </div>
                    </div>
                </div>

                {/* Results List */}
                {results.length > 0 ? (
                    <div className="axiom-omnibox-results max-h-[60vh] overflow-y-auto border-t px-3 py-3 flex flex-col gap-1 custom-scrollbar">
                        {results.map((r, i) => (
                            <div
                                key={`${r.type}-${r.id}`}
                                onMouseEnter={() => setSelectedIndex(i)}
                                onClick={() => { void handleSelect(r); }}
                                className={`
                                    axiom-omnibox-result flex items-center gap-4 px-4 py-3.5 cursor-pointer axiom-transition-interactive
                                    ${i === selectedIndex
                                        ? 'axiom-omnibox-result-active'
                                        : ''}
                                `}
                            >
                                <div className="axiom-omnibox-result-icon p-2 rounded-sm">
                                    <r.icon size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold tracking-tight truncate">{r.label || 'Untitled'}</div>
                                    <div className="text-[10px] uppercase font-bold tracking-widest opacity-50">{r.sub || r.type}</div>
                                </div>
                                {i === selectedIndex && (
                                    <div className="flex items-center gap-2 text-accent-primary axiom-motion-feedback-top">
                                        <span className="text-[10px] font-bold uppercase tracking-widest">
                                            {linkingTarget && r.type === 'note'
                                                ? 'Link Entry'
                                                : r.type === 'plugin-command' ? 'Run' : 'Navigate'}
                                        </span>
                                        <ArrowRight size={14} />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : query.trim() ? (
                    <div className="axiom-omnibox-empty p-12 text-center border-t">
                        <div className="text-4xl mb-4 opacity-10">🔍</div>
                        <div className="text-sm text-text-faint font-medium">No matches found for "<span className="text-text-muted">{query}</span>"</div>
                    </div>
                ) : (
                    <div className="axiom-omnibox-footer px-6 py-6 border-t flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2 text-text-faint">
                                <Command size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-widest">Global Search Active</span>
                            </div>
                        </div>
                        <div className="text-[10px] text-text-faint font-mono">
                            Use ↑↓ to navigate
                        </div>
                    </div>
                )}
            </motion.div>
        </motion.div>,
        document.body
    );
}
