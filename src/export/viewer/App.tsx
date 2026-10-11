import { GRAPH_NAVIGATION } from '../../lib/graphNavigation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import pako from 'pako';
import ReactFlow, {
    Background,
    Controls,
    ReactFlowProvider,
    Node,
    Edge
} from 'reactflow';
import 'reactflow/dist/style.css';

import { ViewerSidebar } from './ViewerSidebar';
import { buildNodeLinkedContent } from '../../components/canvas/NodeLinkedContentBase';
import { ViewerNodeTypes } from './ViewerNodeTypes';
import { ViewerCustomEdge } from './ViewerCustomEdge';
import { GravityView } from './GravityView';
import { sanitizeHtml } from '../../lib/sanitize';
import { getIconComponent } from '../../lib/iconMap';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import {
    getDefaultRoutingNodeSize as getDefaultNodeSize,
} from '../../lib/edgeRouting';
import { ChevronRight, Download, HelpCircle, X as XIcon } from 'lucide-react';
import { resolveViewerRuntimeThemeId } from '../viewerTheme';
import {
    applyThemePresentationAttributes,
    parseExportedThemeBranding,
    parseExportedThemePresentationAttributes,
} from '../../theme/themePresentation';
import { toViewerEdge } from './viewerGraph';
import { createViewerProcessFragmentEnvelope } from './viewerDownload';
import {
    AxiomButton,
    AxiomDialog,
    AxiomDialogBody,
    AxiomDialogHeader,
    AxiomSegmented,
    AxiomSegmentedOption,
} from '../../components/ui';

const edgeTypes = { custom: ViewerCustomEdge };

// --- Breadcrumb entry for subprocess drill-down ---
interface BreadcrumbEntry {
    id: string;
    label: string;
    graph: any;
}

function AxiomViewer() {
    const [data, setData] = useState<any>(null);
    const [viewMode, setViewMode] = useState<'flow' | 'gravity'>('flow');
    const [selectedElement, setSelectedElement] = useState<any | null>(null);
    const [readingNote, setReadingNote] = useState<any | null>(null);
    const [readingAsset, setReadingAsset] = useState<any | null>(null);
    const [helpOpen, setHelpOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Breadcrumb stack for subprocess drill-down
    const [breadcrumbStack, setBreadcrumbStack] = useState<BreadcrumbEntry[]>([]);

    // 1. Data Inflation (Base64 -> Gzip -> JSON)
    useEffect(() => {
        try {
            const dataElement = document.getElementById('axiom-data');
            if (!dataElement) throw new Error('Data element not found');

            const base64 = dataElement.textContent || '';
            if (!base64 || base64.trim().startsWith('<!--')) {
                return;
            }

            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const inflated = pako.inflate(bytes, { to: 'string' });
            const parsed = JSON.parse(inflated);
            setData(parsed);

            // Normalize legacy preset names while preserving genuine custom theme ids.
            document.documentElement.setAttribute(
                'data-theme',
                resolveViewerRuntimeThemeId(parsed.theme, parsed.data?.customThemes || []),
            );
            applyThemePresentationAttributes(
                document.documentElement,
                parseExportedThemePresentationAttributes(parsed.themePresentation),
            );

            // Initialize breadcrumb with root process
            const rootProcess = (parsed.data?.processes || []).find(
                (p: any) => p.id === parsed.rootProcessId
            );
            if (rootProcess) {
                setBreadcrumbStack([{
                    id: rootProcess.id,
                    label: rootProcess.title,
                    graph: rootProcess.graph,
                }]);
            }
        } catch (err) {
            console.error('Inflation error:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        }
    }, []);

    // Current graph = top of the breadcrumb stack
    const currentLevel = breadcrumbStack.length > 0
        ? breadcrumbStack[breadcrumbStack.length - 1]
        : null;

    // Resolve root process details
    const rootProcess = useMemo(() => {
        if (!data) return null;
        return (data.data?.processes || []).find(
            (p: any) => p.id === data.rootProcessId
        );
    }, [data]);

    const rootOwner = useMemo(() => {
        if (!rootProcess || !data) return null;
        return rootProcess.ownerId
            ? (data.data?.assets || []).find((a: any) => a.id === rootProcess.ownerId)
            : null;
    }, [rootProcess, data]);

    const rootOwnerCategory = useMemo(() => {
        if (!rootOwner || !data) return null;
        return (data.data?.assetCategories || []).find((c: any) => c.id === rootOwner.type);
    }, [rootOwner, data]);
    const themeBrand = useMemo(() => parseExportedThemeBranding(data?.themePresentation), [data]);

    // 2. Build ReactFlow nodes and edges from the current graph level
    const dependencyViewEnabled = data?.features?.dependencyView !== false;

    useEffect(() => {
        if (!dependencyViewEnabled && viewMode === 'gravity') {
            setViewMode('flow');
        }
    }, [dependencyViewEnabled, viewMode]);

    const { nodes, edges } = useMemo<{
        nodes: Node[];
        edges: Edge[];
    }>(() => {
        if (!currentLevel || !currentLevel.graph) return { nodes: [], edges: [] };

        const graph = currentLevel.graph;
        const linkedContent = buildNodeLinkedContent(
            graph.nodes || [], data.data?.assets || [], data.data?.journal?.entries || [],
            data.rootProcessId, true,
        );
        const layout = data?.layouts?.[currentLevel.id];
        const swimlaneNodes: Node[] = [{
            id: 'swimlane-stack', type: 'division-background', position: { x: 0, y: 0 },
            data: { graph }, draggable: false, selectable: false, focusable: false, zIndex: -10,
        }];

        const rfNodes: Node[] = [
            ...swimlaneNodes,
            ...(graph.nodes || []).map((n: any) => {
                const pos = layout?.nodes?.find((ln: any) => ln.id === n.id);
                const type = n.type || 'action';
                const defaults = getDefaultNodeSize(type);
                const assetId = type === 'resource' ? getResourceReferenceAssetId(n) : undefined;
                const asset = assetId ? (data?.data?.assets || []).find((a: any) => a.id === assetId) : null;
                const category = asset ? (data?.data?.assetCategories || []).find(
                    (c: any) => c.id === asset.type || c.id === asset.categoryId,
                ) : null;

                return {
                    id: n.id,
                    type,
                    position: pos
                        ? { x: pos.x, y: pos.y }
                        : n.position
                            ? { x: n.position.x, y: n.position.y }
                            : { x: 0, y: 0 },
                    data: {
                        ...(n.data || {}),
                        id: n.id,
                        linkedContent: linkedContent.get(n.id),
                        type,
                        label: type === 'resource' && asset?.name ? asset.name : n.label,
                        ...(type === 'event' ? { event: n.event } : {}),
                        assetIds: n.assetIds,
                        ...(type === 'resource' ? { assetId } : {}),
                        subGraphId: n.subGraphId,
                        asset,
                        category: category ? {
                            ...category,
                            color: category.color,
                        } : category,
                        color: n.data?.color || n.color || undefined,
                        width: pos?.width || n.width || defaults.width,
                        height: pos?.height || n.height || defaults.height,
                        hasChildren: !!(n.subGraphId && rootProcess?.subGraphs?.[n.subGraphId]?.nodes?.length > 0),
                    },
                    style: {
                        width: pos?.width || n.width || defaults.width,
                        height: pos?.height || n.height || defaults.height,
                    },
                    zIndex: 1,
                };
            }),
        ];

        const allNodePositions = rfNodes.filter(node => node.type !== 'division-background').map(node => ({
            type: node.type, x: node.position.x, y: node.position.y,
            w: Number(node.style?.width ?? 192), h: Number(node.style?.height ?? 80),
        }));
        const rfEdges: Edge[] = (graph.edges || []).map((edge: any) => toViewerEdge(edge, allNodePositions));

        return { nodes: rfNodes, edges: rfEdges };
    }, [currentLevel, data, rootProcess]);

    // Node drill-down
    const drillIntoSubprocess = useCallback((nodeData: any) => {
        console.log('[Viewer] Attempting drill-down:', nodeData.label, 'ID:', nodeData.subGraphId);
        if (!nodeData?.subGraphId) {
            console.error('[Viewer] No subGraphId found on node');
            return;
        }

        const rootProcess = (data?.data?.processes || []).find(
            (p: any) => p.id === data?.rootProcessId
        );
        const childGraph = rootProcess?.subGraphs?.[nodeData.subGraphId];

        if (!childGraph || !childGraph.nodes?.length) {
            console.warn('[Viewer] Target subgraph not found or empty:', nodeData.subGraphId);
            return;
        }

        console.log('[Viewer] Subgraph found, transitioning...',
            childGraph.nodes.length, 'nodes,',
            childGraph.edges?.length || 0, 'edges'
        );

        setBreadcrumbStack(prev => [...prev, {
            id: nodeData.subGraphId,
            label: nodeData.label,
            graph: childGraph,
        }]);
        setSelectedElement(null);
    }, [data]);

    // Navigate back to a specific breadcrumb level
    const navigateToBreadcrumb = useCallback((index: number) => {
        setBreadcrumbStack(prev => prev.slice(0, index + 1));
        setSelectedElement(null);
    }, []);

    const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
        if (!node?.data) return;
        if (node.type === 'resource') {
            const assetId = node.data.assetId || (node.data.assetIds && node.data.assetIds[0]);
            const asset = node.data.asset || (data?.data?.assets || []).find((a: any) => a.id === assetId);
            if (asset) {
                // Keep node-linked notes reachable after closing the resource reader.
                if (node.data.linkedContent?.journal) setSelectedElement(node.data);
                setReadingAsset(asset);
                return;
            }
        }
        setSelectedElement(node.data);
    }, [data]);

    const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
        event.stopPropagation(); // Prevent ReactFlow pane from zooming
        if (!node?.data) return;
        if (node.data.hasChildren) {
            drillIntoSubprocess(node.data);
        }
    }, [drillIntoSubprocess]);

    const onPaneClick = useCallback(() => {
        setSelectedElement(null);
    }, []);

    // Download .nemoto-process process fragment from embedded data
    const downloadAxiomFile = useCallback(() => {
        if (!data?.data) return;

        const axiomPayload = createViewerProcessFragmentEnvelope(data);

        const json = JSON.stringify(axiomPayload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const safeTitle = (breadcrumbStack[0]?.label || 'axiom_export')
            .replace(/[^a-z0-9åäö]/gi, '_').toLowerCase();
        a.download = `${safeTitle}.nemoto-process`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [data, breadcrumbStack]);

    if (error) return <div className="error-screen"><h1>Export Error</h1><p>{error}</p></div>;
    if (!data) return <div className="loading-screen"><div className="spinner" /><h1>Loading Nemoto...</h1></div>;

    const rootTitle = breadcrumbStack.length > 0 ? breadcrumbStack[0].label : 'Nemoto Viewer';

    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-app-bg text-text-main">
            <header className="flex-none h-16 border-b border-app-border bg-app-header flex items-center justify-between px-8 z-50 shadow-md">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                        {themeBrand.logoDataUrl && (
                            <img
                                aria-hidden="true"
                                alt=""
                                src={themeBrand.logoDataUrl}
                                className="h-8 w-auto max-w-40 shrink-0 object-contain"
                            />
                        )}
                        {themeBrand.showDisplayName !== false && <span className="max-w-48 truncate font-black tracking-tighter text-xl text-accent-primary">
                            {themeBrand.displayName}
                        </span>}
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-accent-primary text-white border border-accent-primary/20 shadow-sm">VIEWER</span>
                    </div>
                </div>

                <h1 className="text-lg font-bold tracking-tight text-text-main">{rootTitle}</h1>

                {dependencyViewEnabled && (
                    <AxiomSegmented aria-label="Viewer mode">
                        <AxiomSegmentedOption
                            active={viewMode === 'flow'}
                            onClick={() => {
                                setViewMode('flow');
                                setSelectedElement(null);
                            }}
                        >
                            Process Map
                        </AxiomSegmentedOption>
                        <AxiomSegmentedOption
                            active={viewMode === 'gravity'}
                            onClick={() => {
                                setViewMode('gravity');
                                setSelectedElement(null);
                            }}
                        >
                            Dependency Map
                        </AxiomSegmentedOption>
                    </AxiomSegmented>
                )}

                <div className="flex items-center gap-3">
                    <AxiomButton
                        aria-label="How to use this viewer"
                        icon
                        size="sm"
                        variant="ghost"
                        onClick={() => setHelpOpen(true)}
                        title="How to use this viewer"
                    >
                        <HelpCircle size={16} />
                    </AxiomButton>
                    <AxiomButton
                        size="sm"
                        variant="ghost"
                        onClick={downloadAxiomFile}
                        className="text-[10px] uppercase tracking-wider"
                        title="Download as .nemoto-process process fragment for import into Nemoto"
                    >
                        <Download size={14} aria-hidden="true" /> Download .nemoto-process
                    </AxiomButton>
                    <span className="text-xs text-text-muted">
                        Exported {new Date(data.exportedAt).toLocaleDateString()}
                    </span>
                </div>
            </header>

            {/* Breadcrumb bar for subprocess navigation */}
            {viewMode === 'flow' && breadcrumbStack.length > 1 && (
                <div className="flex-none h-10 border-b border-app-border bg-app-sidebar/50 flex items-center px-8 gap-2 overflow-x-auto custom-scrollbar">
                    {breadcrumbStack.map((entry, index) => (
                        <span key={entry.id} className="flex items-center gap-2 text-xs whitespace-nowrap">
                            {index > 0 && <ChevronRight size={14} className="text-text-faint" aria-hidden="true" />}
                            <AxiomButton
                                size="sm"
                                variant="ghost"
                                className={index === breadcrumbStack.length - 1 ? 'min-h-0 px-1 py-0 text-accent-primary font-bold' : 'min-h-0 px-1 py-0 text-text-muted'}
                                onClick={() => navigateToBreadcrumb(index)}
                            >
                                {entry.label}
                            </AxiomButton>
                        </span>
                    ))}
                </div>
            )}

            <main className="flex-1 flex overflow-hidden min-h-0 relative">
                {viewMode === 'flow' || !dependencyViewEnabled ? (
                    <div className="flex-1 flex flex-col relative bg-app-bg overflow-hidden" style={{ WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
                        {rootProcess && (
                            <div
                                onClick={() => setSelectedElement({
                                    id: rootProcess.id,
                                    type: 'process',
                                    label: rootProcess.title,
                                    description: rootProcess.description,
                                    assetIds: rootProcess.ownerId ? [rootProcess.ownerId] : [],
                                })}
                                className="flex-shrink-0 bg-app-surface/40 border-b border-app-border px-6 py-3 flex flex-col gap-1.5 cursor-pointer hover:bg-app-surface/60 transition-colors group"
                            >
                                <div className="flex items-center gap-3">
                                    <h1 className="text-xl font-bold font-display text-text-main tracking-tight leading-tight group-hover:text-accent-primary transition-colors">
                                        {rootProcess.title || 'Untitled Process'}
                                    </h1>
                                </div>

                                {(rootOwner || (rootProcess.description && rootProcess.metaSettings?.showDescriptionInCanvas)) && (
                                    <div className="flex items-center gap-3">
                                        {rootProcess.metaSettings?.showOwnerInCanvas && rootOwner && (
                                            <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-app-surface shadow-sm border border-app-border text-[9px] font-bold uppercase tracking-[0.1em] text-text-muted transition-all duration-300 group-hover:text-text-main group-hover:bg-app-hover group-hover:border-accent-primary/30">
                                                {rootOwnerCategory?.icon && (() => {
                                                    const IconComp = getIconComponent(rootOwnerCategory.icon);
                                                    return IconComp ? <IconComp size={10} strokeWidth={2.5} className="text-accent-primary" /> : null;
                                                })()}
                                                <span>{rootOwner.name}</span>
                                            </div>
                                        )}

                                        {rootProcess.description && rootProcess.metaSettings?.showDescriptionInCanvas && (
                                            <p className="text-[11px] font-medium text-text-muted/65 leading-relaxed italic whitespace-pre-wrap max-w-2xl border-l border-accent-primary/20 pl-2.5">
                                                {rootProcess.description}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex-1 relative">
                            <ReactFlow
                            className="axiom-division-canvas"
                            {...GRAPH_NAVIGATION}
                            nodes={nodes}
                            edges={edges}
                            nodeTypes={ViewerNodeTypes}
                            edgeTypes={edgeTypes}
                            nodesDraggable={false}
                            nodesConnectable={false}
                            onNodeClick={onNodeClick}
                            onNodeDoubleClick={onNodeDoubleClick}
                            onPaneClick={onPaneClick}
                            zoomOnDoubleClick={false}
                            minZoom={0.1}
                            maxZoom={4}
                            defaultViewport={{ x: 180, y: 80, zoom: 0.8 }}
                            translateExtent={undefined}
                            nodeExtent={undefined}
                        >
                            <Background
                                className="bg-app-bg"
                                color="var(--color-app-grid)"
                                gap={24}
                                size={2}
                                variant={"dots" as any}
                            />
                            <Controls showInteractive={false} />
                        </ReactFlow>
                        </div>
                    </div>
                ) : (
                    <GravityView
                        data={data}
                        onNodeClick={setSelectedElement}
                    />
                )}

                <ViewerSidebar
                    selectedElement={selectedElement}
                    assets={data.data?.assets || []}
                    categories={data.data?.assetCategories || []}
                    journalEntries={data.data?.journal?.entries || []}
                    onReadNote={setReadingNote}
                    onViewAsset={setReadingAsset}
                    onClose={() => setSelectedElement(null)}
                />
            </main>

            <footer className="flex-none h-8 border-t border-app-border bg-app-surface flex items-center justify-end px-4 text-[10px] text-text-faint">
                <div>
                    Powered by <strong>Nemoto</strong>
                </div>
            </footer>

            {/* Asset Reader Modal */}
            {readingAsset && (
                <AxiomDialog
                    aria-labelledby="viewer-asset-title"
                    onClose={() => setReadingAsset(null)}
                    panelClassName="viewer-reader flex flex-col w-full max-w-lg max-h-[85vh] overflow-hidden"
                >
                        <AxiomDialogHeader className="shrink-0 px-6 py-5 flex items-center justify-between">
                            <div>
                                <h2 id="viewer-asset-title" className="text-xl font-bold text-text-main tracking-tight pb-1">{readingAsset.name || 'Unnamed Resource'}</h2>
                                {(() => {
                                    const category = (data.data?.assetCategories || []).find((c: any) => c.id === readingAsset.type);
                                    if (!category) return null;
                                    return (
                                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded border" style={{ borderColor: `${category.color}40`, color: category.color, backgroundColor: `${category.color}10` }}>
                                            {category.label}
                                        </span>
                                    );
                                })()}
                            </div>
                            <AxiomButton
                                aria-label="Close resource"
                                icon
                                variant="ghost"
                                onClick={() => setReadingAsset(null)}
                            >
                                <XIcon size={16} />
                            </AxiomButton>
                        </AxiomDialogHeader>

                        <AxiomDialogBody className="p-6 overflow-y-auto custom-scrollbar flex-1 min-h-0 bg-app-bg/50">
                            {readingAsset.description && (
                                <div className="mb-6">
                                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Description</h3>
                                    <p className="text-[13px] text-text-main/90 leading-relaxed whitespace-pre-wrap bg-white/5 p-3 rounded border border-white/5">
                                        {readingAsset.description}
                                    </p>
                                </div>
                            )}

                            <div>
                                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-3">Properties</h3>
                                {Object.keys(readingAsset.metadata || {}).length > 0 ? (
                                    <div className="flex flex-col gap-2">
                                        {Object.entries(readingAsset.metadata).map(([key, value]) => (
                                            <div key={key} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 p-3 rounded bg-app-surface border border-app-border">
                                                <span className="font-mono text-[11px] text-text-muted sm:w-1/3 break-all">{key}</span>
                                                <span className="text-[13px] font-medium text-text-main sm:w-2/3 whitespace-pre-wrap break-words">{String(value)}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-[13px] text-text-faint italic px-3 py-4 text-center border border-dashed border-app-border rounded">
                                        No custom properties defined.
                                    </div>
                                )}
                            </div>
                        </AxiomDialogBody>
                </AxiomDialog>
            )}

            {/* Centralized Journal Reader Modal */}
            {readingNote && (
                <AxiomDialog
                    aria-labelledby="viewer-note-title"
                    onClose={() => setReadingNote(null)}
                    panelClassName="viewer-reader flex flex-col w-full max-w-3xl max-h-[85vh] overflow-hidden"
                >
                        <AxiomDialogHeader className="shrink-0 px-8 py-6 flex items-start justify-between">
                            <div>
                                <h2 id="viewer-note-title" className="text-2xl font-bold text-text-main tracking-tight">{readingNote.title || 'Untitled Entry'}</h2>
                                <div className="text-sm text-text-muted mt-2">
                                    {new Date(readingNote.createdAt).toLocaleDateString()} {new Date(readingNote.createdAt).toLocaleTimeString()}
                                </div>
                            </div>
                            <AxiomButton
                                aria-label="Close journal entry"
                                icon
                                variant="ghost"
                                onClick={() => setReadingNote(null)}
                            >
                                <XIcon size={16} />
                            </AxiomButton>
                        </AxiomDialogHeader>

                        <AxiomDialogBody className="p-10 overflow-y-auto custom-scrollbar flex-1 min-h-0 bg-app-bg/50">
                            <div
                                className="prosemirror-content prose prose-invert max-w-none w-full text-[16px] leading-relaxed break-words
                                    prose-headings:text-text-main prose-headings:font-black prose-headings:tracking-tight
                                    prose-h1:text-3xl prose-h1:mb-8 prose-h1:text-accent-primary
                                    prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:text-accent-primary/90
                                    prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-accent-primary/80
                                    prose-p:text-text-muted/90 prose-p:mb-5
                                    prose-strong:text-text-main prose-strong:font-bold
                                    prose-blockquote:border-l-accent-primary prose-blockquote:bg-accent-primary/5 prose-blockquote:py-1 prose-blockquote:px-6 prose-blockquote:rounded-r-lg
                                    "
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(readingNote.content || '') }}
                            />
                        </AxiomDialogBody>
                </AxiomDialog>
            )}

            {/* Help Modal */}
            {helpOpen && (
                <AxiomDialog
                    aria-labelledby="viewer-help-title"
                    onClose={() => setHelpOpen(false)}
                    panelClassName="viewer-reader flex flex-col w-full max-w-xl max-h-[85vh] overflow-hidden"
                >
                        <AxiomDialogHeader className="shrink-0 px-8 py-6 flex items-center justify-between">
                            <h2 id="viewer-help-title" className="text-xl font-bold text-text-main tracking-tight">How to Use This Viewer</h2>
                            <AxiomButton aria-label="Close help" icon variant="ghost" onClick={() => setHelpOpen(false)}>
                                <XIcon size={16} />
                            </AxiomButton>
                        </AxiomDialogHeader>
                        <AxiomDialogBody className="flex-1 min-h-0 p-8 overflow-y-auto custom-scrollbar space-y-6 text-sm text-text-muted leading-relaxed">
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-accent-primary mb-2">Process Map</h3>
                                <ul className="space-y-1.5 list-disc list-inside">
                                    <li><strong className="text-text-main">Click</strong> any node to see its details, linked resources, and journal notes in the sidebar.</li>
                                    <li><strong className="text-text-main">Double-click</strong> any node marked with a layered icon to drill down into it.</li>
                                    <li>Use the <strong className="text-text-main">breadcrumb bar</strong> that appears to navigate back to parent processes.</li>
                                    <li>Pan with two-finger scrolling, the mouse wheel, or by dragging the background. Zoom with a pinch gesture or <strong className="text-text-main">Ctrl + scroll</strong>.</li>
                                </ul>
                            </section>
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-accent-primary mb-2">Dependency Map</h3>
                                <p>Switch to "Dependency Map" in the top bar to inspect directed relationships around a focal point, filter visible layers, or summarize journal tags by the entities they reference.</p>
                            </section>
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-accent-primary mb-2">Sidebar</h3>
                                <p>When a node is selected, the right panel shows its name, type, description, linked resources (with category), and any related journal notes. Click a note to read it in full. Close details hides the panel; select a node to reopen it. Select text in details, resources or notes and copy it with your browser's usual command. Long notes and resource details scroll inside their reader.</p>
                            </section>
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-accent-primary mb-2">Download</h3>
                                <p>The <strong className="text-text-main">Download .nemoto-process</strong> button exports the embedded process data as an <code className="text-accent-primary bg-app-hover px-1 rounded">.nemoto-process</code> file you can import into the full Nemoto application for editing.</p>
                            </section>
                        </AxiomDialogBody>
                </AxiomDialog>
            )}
        </div>
    );
}

export default function App() {
    return (
        <ReactFlowProvider>
            <AxiomViewer />
        </ReactFlowProvider>
    );
}
