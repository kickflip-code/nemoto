import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
    Background,
    BackgroundVariant,
    Edge,
    MarkerType,
    Node,
    Position,
    useEdgesState,
    useNodesState,
} from 'reactflow';
import { Info, RefreshCw, Search } from 'lucide-react';
import type { Portfolio } from '../../types';
import {
    buildDependencyGraphIndex,
    DependencyEntity,
    DependencyEntityType,
    DependencyQuery,
    DependencyRelationType,
    getEntityTypeLabel,
    getRelationPerspective,
    queryDependencyGraph,
} from '../../lib/dependencyGraph';
import { layoutDependencyGraph, layoutFocusedDependencyGraph } from '../../lib/dependencyLayout';
import { getDependencyEdgeStroke } from '../../lib/dependencyEdgeStyles';
import { getPaletteColor } from '../../constants/palette';
import { GravityNode } from '../../components/views/GravityNode';
import {
    NemotoButton,
    NemotoInput,
    NemotoPanelRowButton,
    NemotoRange,
    NemotoSegmented,
    NemotoSegmentedOption,
    NemotoSelect,
    NemotoToggleCard,
} from '../../components/ui';
import { getMotionDurationMs, motionDurationMs } from '../../lib/motion';

const MAX_RENDERED_NODES = 350;
const NODE_TYPES = { dependency: GravityNode };

type VisibleLayers = Record<Exclude<DependencyEntityType, 'tag'>, boolean>;
type RelationLayer = 'flow' | 'resource' | 'journal' | 'contains' | 'tagged';
type VisibleRelations = Record<RelationLayer, boolean>;
type RelationDirection = 'both' | 'incoming' | 'outgoing';

const LAYER_LABELS: Record<keyof VisibleLayers, string> = {
    process: 'Processes',
    asset: 'Resources',
    entry: 'Journal',
    node: 'Steps',
};

const RELATION_LABELS: Record<DependencyRelationType, string> = {
    contains: 'Contains',
    flow: 'Process flow',
    'asset-reference': 'Uses resource',
    'journal-reference': 'Journal reference',
    'tag-membership': 'Tagged note',
    'tag-insight': 'Tag insight',
    'process-resource': 'Process uses resource',
};

const RELATION_DASHES: Partial<Record<DependencyRelationType, string>> = {
    contains: '7 7',
    'journal-reference': '3 6',
    'tag-membership': '2 5',
};

const RELATION_FILTERS: Array<{
    id: RelationLayer;
    label: string;
    sampleType: DependencyRelationType;
}> = [
    { id: 'flow', label: 'Process flow', sampleType: 'flow' },
    { id: 'resource', label: 'Uses resource', sampleType: 'asset-reference' },
    { id: 'journal', label: 'Journal reference', sampleType: 'journal-reference' },
    { id: 'contains', label: 'Contains', sampleType: 'contains' },
    { id: 'tagged', label: 'Tag insight', sampleType: 'tag-insight' },
];

interface GravityViewProps {
    data: any;
    onNodeClick: (node: any | null) => void;
}

function getRelationLayer(type: DependencyRelationType): RelationLayer {
    if (type === 'process-resource' || type === 'asset-reference') return 'resource';
    if (type === 'journal-reference') return 'journal';
    if (type === 'tag-membership' || type === 'tag-insight') return 'tagged';
    return type;
}

function entityColor(entity: DependencyEntity): string {
    if (entity.type === 'asset') return getPaletteColor(entity.categoryColor);
    if (entity.type === 'entry') return 'var(--color-accent-warning)';
    if (entity.type === 'tag') return 'var(--color-accent-purple)';
    if (entity.type === 'node') return 'var(--color-accent-primary)';
    return 'var(--color-text-main)';
}

function entitySubtitle(entity: DependencyEntity): string {
    if (entity.type === 'asset') return entity.categoryLabel || 'Resource';
    return getEntityTypeLabel(entity.type);
}

function selectHandles(
    source: { position: { x: number; y: number }; width: number; height: number },
    target: { position: { x: number; y: number }; width: number; height: number },
): { sourceHandle: string; targetHandle: string } {
    const sourceX = source.position.x + source.width / 2;
    const sourceY = source.position.y + source.height / 2;
    const targetX = target.position.x + target.width / 2;
    const targetY = target.position.y + target.height / 2;
    const dx = targetX - sourceX;
    const dy = targetY - sourceY;

    if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0
            ? { sourceHandle: 'source-r', targetHandle: 'target-l' }
            : { sourceHandle: 'source-l', targetHandle: 'target-r' };
    }
    return dy > 0
        ? { sourceHandle: 'source-b', targetHandle: 'target-t' }
        : { sourceHandle: 'source-t', targetHandle: 'target-b' };
}

function buildSourceEntityMap(portfolio: Portfolio): Map<string, any> {
    const sourceById = new Map<string, any>();

    for (const process of portfolio.processes || []) {
        sourceById.set(process.id, { ...process, label: process.title, type: 'process' });
        const addGraph = (graph: any) => {
            for (const node of graph?.nodes || []) {
                sourceById.set(node.id, { ...node, label: node.label, type: 'node', processId: process.id });
            }
        };
        addGraph(process.graph);
        for (const graph of Object.values(process.subGraphs || {})) addGraph(graph);
    }
    for (const asset of portfolio.assets || []) {
        sourceById.set(asset.id, { ...asset, label: asset.name, type: 'asset' });
    }
    for (const entry of portfolio.journal?.entries || []) {
        sourceById.set(entry.id, { ...entry, label: entry.title, type: 'entry' });
    }
    for (const tag of portfolio.journal?.tags || []) {
        sourceById.set(tag.id, { ...tag, label: tag.label, type: 'tag' });
    }
    return sourceById;
}

function Toggle({
    label,
    count,
    color,
    dashed,
    enabled,
    onClick,
}: {
    label: string;
    count: number;
    color: string;
    dashed?: boolean;
    enabled: boolean;
    onClick: () => void;
}) {
    return (
        <NemotoToggleCard
            active={enabled}
            onClick={onClick}
            className="px-2.5"
        >
            <span className="flex min-w-0 items-center gap-2">
                <span
                    className="block h-0 w-5 shrink-0 border-t-2"
                    style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }}
                />
                <span className="truncate">{label}</span>
            </span>
            <span className="font-mono text-[10px] text-text-muted">{count}</span>
        </NemotoToggleCard>
    );
}

export const GravityView = ({ data, onNodeClick }: GravityViewProps) => {
    const portfolio = useMemo(() => (data?.data || {
        version: '1.0',
        lastModified: '',
        processes: [],
        processFolders: [],
        assets: [],
        assetCategories: [],
        incidents: [],
    }) as Portfolio, [data]);
    const graphIndex = useMemo(() => buildDependencyGraphIndex(portfolio), [portfolio]);
    const sourceById = useMemo(() => buildSourceEntityMap(portfolio), [portfolio]);
    const [focalNodeId, setFocalNodeId] = useState<string | null>(null);
    const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
    const [includeTaggedEntries, setIncludeTaggedEntries] = useState(false);
    const [depth, setDepth] = useState(1);
    const [search, setSearch] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [relationDirection, setRelationDirection] = useState<RelationDirection>('both');
    const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
        process: true,
        asset: true,
        entry: true,
        node: true,
    });
    const [visibleRelations, setVisibleRelations] = useState<VisibleRelations>({
        flow: true,
        resource: true,
        journal: true,
        contains: false,
        tagged: true,
    });
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges] = useEdgesState([]);
    const reactFlowInstance = useRef<any>(null);

    const query = useMemo<DependencyQuery>(() => {
        if (selectedTagId) {
            return {
                kind: 'tag',
                tagId: selectedTagId,
                includeJournalEntries: includeTaggedEntries,
                maxNodes: MAX_RENDERED_NODES,
            };
        }
        if (focalNodeId) {
            return { kind: 'focus', focalId: focalNodeId, depth, maxNodes: MAX_RENDERED_NODES };
        }
        return { kind: 'overview', maxNodes: MAX_RENDERED_NODES };
    }, [depth, focalNodeId, includeTaggedEntries, selectedTagId]);

    const viewGraph = useMemo(
        () => queryDependencyGraph(graphIndex, portfolio, query),
        [graphIndex, portfolio, query],
    );

    const relationCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const relation of viewGraph.relations) {
            counts.set(relation.source, (counts.get(relation.source) || 0) + 1);
            counts.set(relation.target, (counts.get(relation.target) || 0) + 1);
        }
        return counts;
    }, [viewGraph.relations]);

    const nodeLayouts = useMemo(
        () => query.kind === 'focus'
            ? layoutFocusedDependencyGraph(viewGraph.nodes, viewGraph.relations)
            : layoutDependencyGraph(viewGraph.nodes),
        [query.kind, viewGraph.nodes, viewGraph.relations],
    );

    const baseNodes = useMemo<Node[]>(() => {
        const layoutById = new Map(nodeLayouts.map(item => [item.id, item]));
        return viewGraph.nodes.map(entity => {
            const layout = layoutById.get(entity.id)!;
            const processContext = entity.type === 'node' && entity.processId
                ? graphIndex.entities.get(entity.processId)?.label
                : null;
            const subtitle = query.kind === 'tag' && processContext
                ? `Step · ${processContext}`
                : entitySubtitle(entity);
            return {
                id: entity.id,
                type: 'dependency',
                position: layout.position,
                width: layout.width,
                height: layout.height,
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                ariaLabel: `${entity.label}, ${subtitle}`,
                data: {
                    id: entity.id,
                    label: entity.label,
                    type: entity.type,
                    subtitle,
                    color: entityColor(entity),
                    icon: entity.categoryIcon,
                    isFocal: entity.isFocal,
                    isContext: entity.isContext,
                    isMassive: viewGraph.nodes.length > 150,
                    relationCount: relationCounts.get(entity.id) || 0,
                    weight: entity.weight,
                },
                style: { width: layout.width, height: layout.height },
            };
        });
    }, [graphIndex.entities, nodeLayouts, query.kind, relationCounts, viewGraph.nodes]);

    const baseEdges = useMemo<Edge[]>(() => {
        const layoutById = new Map(nodeLayouts.map(item => [item.id, item]));
        return viewGraph.relations.flatMap(relation => {
            const source = layoutById.get(relation.source);
            const target = layoutById.get(relation.target);
            if (!source || !target) return [];
            const stroke = getDependencyEdgeStroke(relation.type);
            const handles = selectHandles(source, target);
            return [{
                id: relation.id,
                source: relation.source,
                target: relation.target,
                sourceHandle: handles.sourceHandle,
                targetHandle: handles.targetHandle,
                type: query.kind === 'overview' || query.kind === 'focus' ? 'smoothstep' : 'default',
                ariaLabel: RELATION_LABELS[relation.type],
                label: relation.count && relation.count > 1 ? String(relation.count) : undefined,
                labelStyle: { fill: 'var(--color-text-main)', fontSize: 10, fontWeight: 700 },
                labelBgStyle: { fill: 'var(--color-app-surface)', fillOpacity: 0.92 },
                labelBgPadding: [5, 3],
                labelBgBorderRadius: 4,
                markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
                data: { relationType: relation.type },
                style: {
                    stroke,
                    strokeWidth: relation.count ? Math.min(1.5 + relation.count * 0.35, 5) : 1.7,
                    strokeDasharray: RELATION_DASHES[relation.type],
                    opacity: 0.76,
                },
            }];
        });
    }, [nodeLayouts, query.kind, viewGraph.relations]);

    useEffect(() => {
        setNodes(baseNodes);
        setEdges(baseEdges);
        const timer = window.setTimeout(() => {
            reactFlowInstance.current?.fitView({
                padding: 0.2,
                duration: getMotionDurationMs(motionDurationMs.slow),
            });
        }, 30);
        return () => window.clearTimeout(timer);
    }, [baseEdges, baseNodes, setEdges, setNodes]);

    useEffect(() => {
        if (selectedNodeId && !viewGraph.nodes.some(node => node.id === selectedNodeId)) {
            setSelectedNodeId(null);
        }
    }, [selectedNodeId, viewGraph.nodes]);

    const layerCounts = useMemo(() => {
        const counts: Record<keyof VisibleLayers, number> = { process: 0, asset: 0, entry: 0, node: 0 };
        for (const node of viewGraph.nodes) if (node.type !== 'tag') counts[node.type] += 1;
        return counts;
    }, [viewGraph.nodes]);

    const relationLayerCounts = useMemo(() => {
        const counts: Record<RelationLayer, number> = { flow: 0, resource: 0, journal: 0, contains: 0, tagged: 0 };
        for (const relation of viewGraph.relations) counts[getRelationLayer(relation.type)] += 1;
        return counts;
    }, [viewGraph.relations]);

    const layerVisibleNodeIds = useMemo(() => new Set(nodes
        .filter(node => node.data?.isFocal || node.data?.type === 'tag' || visibleLayers[node.data?.type as keyof VisibleLayers])
        .map(node => node.id)), [nodes, visibleLayers]);

    const relationVisibleEdges = useMemo(() => edges.filter(edge => {
        if (!layerVisibleNodeIds.has(edge.source) || !layerVisibleNodeIds.has(edge.target)) return false;
        const relationType = edge.data?.relationType as DependencyRelationType | undefined;
        if (relationType && !visibleRelations[getRelationLayer(relationType)]) return false;
        if (query.kind !== 'focus' || relationDirection === 'both' || !focalNodeId) return true;
        return relationDirection === 'incoming' ? edge.target === focalNodeId : edge.source === focalNodeId;
    }), [edges, focalNodeId, layerVisibleNodeIds, query.kind, relationDirection, visibleRelations]);

    const displayedNodeIds = useMemo(() => {
        if (query.kind !== 'focus' || relationDirection === 'both' || !focalNodeId) return layerVisibleNodeIds;
        const ids = new Set<string>([focalNodeId]);
        for (const edge of relationVisibleEdges) {
            ids.add(edge.source);
            ids.add(edge.target);
        }
        return ids;
    }, [focalNodeId, layerVisibleNodeIds, query.kind, relationDirection, relationVisibleEdges]);

    const adjacency = useMemo(() => {
        const result = new Map<string, Set<string>>();
        for (const edge of relationVisibleEdges) {
            if (!result.has(edge.source)) result.set(edge.source, new Set());
            if (!result.has(edge.target)) result.set(edge.target, new Set());
            result.get(edge.source)!.add(edge.target);
            result.get(edge.target)!.add(edge.source);
        }
        return result;
    }, [relationVisibleEdges]);

    const displayedNodes = useMemo(() => nodes
        .filter(node => displayedNodeIds.has(node.id))
        .map(node => {
            const related = !selectedNodeId
                || node.id === selectedNodeId
                || adjacency.get(selectedNodeId)?.has(node.id);
            return { ...node, style: { ...node.style, opacity: related ? 1 : (node.data?.isContext ? 0.46 : 0.24) } };
        }), [adjacency, displayedNodeIds, nodes, selectedNodeId]);

    const displayedEdges = useMemo(() => relationVisibleEdges.map(edge => {
        const related = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId;
        return {
            ...edge,
            style: {
                ...edge.style,
                opacity: related ? (selectedNodeId ? 0.98 : 0.82) : 0.1,
                strokeWidth: related && selectedNodeId
                    ? Number(edge.style?.strokeWidth || 1.7) + 1
                    : edge.style?.strokeWidth,
            },
        };
    }), [relationVisibleEdges, selectedNodeId]);

    const searchResults = useMemo(() => {
        const value = search.trim().toLocaleLowerCase();
        if (!value) return [];
        return [...graphIndex.entities.values()]
            .filter(entity => entity.type !== 'tag' && entity.label.toLocaleLowerCase().includes(value))
            .sort((a, b) => a.label.localeCompare(b.label))
            .slice(0, 20);
    }, [graphIndex.entities, search]);

    const chooseFocalPoint = useCallback((entity: DependencyEntity) => {
        setSelectedTagId(null);
        setIncludeTaggedEntries(false);
        setFocalNodeId(entity.id);
        setSelectedNodeId(entity.id);
        setSearch('');
        setRelationDirection('both');
    }, []);

    const chooseTag = useCallback((tagId: string | null) => {
        if (tagId) setFocalNodeId(null);
        setSelectedTagId(tagId);
        setIncludeTaggedEntries(false);
        setSelectedNodeId(tagId);
    }, []);

    const activeFocal = focalNodeId ? graphIndex.entities.get(focalNodeId) : null;
    const availableTags = (portfolio.journal?.tags || []).filter(tag => !tag.archived);

    return (
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-app-bg text-text-main">
            <aside className="app-scroll z-20 flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-app-border bg-app-sidebar/95">
                <div className="border-b border-app-border px-5 py-4">
                    <h2 className="text-sm font-bold uppercase tracking-[0.14em]">Dependency Map</h2>
                    <p className="mt-1 text-[11px] text-text-muted">
                        {selectedTagId ? (includeTaggedEntries ? 'Journal notes' : 'Journal insight') : activeFocal ? `Focused · ${depth} ${depth === 1 ? 'step' : 'steps'}` : 'Portfolio overview'}
                    </p>
                </div>

                <div className="space-y-5 p-4">
                    <section>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Focal point</h3>
                            {activeFocal && (
                                <NemotoButton size="sm" variant="ghost" onClick={() => { setFocalNodeId(null); setSelectedNodeId(null); }} className="min-h-0 px-2 py-1 text-[10px]">Clear</NemotoButton>
                            )}
                        </div>
                        {activeFocal && (
                            <div className="mb-2 rounded-md border border-accent-primary/40 bg-accent-primary/10 px-3 py-2 text-xs font-semibold">
                                <span className="truncate">{activeFocal.label}</span>
                            </div>
                        )}
                        <div className="relative">
                            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
                            <label htmlFor="viewer-dependency-search" className="sr-only">Search for a focal point</label>
                            <NemotoInput
                                id="viewer-dependency-search"
                                type="search"
                                controlSize="sm"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                placeholder="Search entities…"
                                className="nemoto-field-leading-icon w-full"
                            />
                        </div>
                        {searchResults.length > 0 && (
                            <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-md border border-app-border bg-app-surface p-1" aria-label="Focal point search results">
                                {searchResults.map(entity => (
                                    <NemotoPanelRowButton key={entity.id} onClick={() => chooseFocalPoint(entity)} className="justify-between gap-2 px-2 py-1.5">
                                        <span className="truncate text-[11px]">{entity.label}</span>
                                        <span className="shrink-0 text-[9px] uppercase text-text-faint">{getEntityTypeLabel(entity.type)}</span>
                                    </NemotoPanelRowButton>
                                ))}
                            </div>
                        )}
                        {activeFocal && !selectedTagId && (
                            <div className="mt-3">
                                <div className="mb-1 flex justify-between text-[10px] text-text-faint"><span>Reach</span><span>{depth} {depth === 1 ? 'step' : 'steps'}</span></div>
                                <NemotoRange aria-label="Dependency reach" min={1} max={3} step={1} value={depth} onChange={event => setDepth(Number(event.target.value))} className="w-full" />
                            </div>
                        )}
                    </section>

                    {availableTags.length > 0 && (
                        <section>
                            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Journal insight</h3>
                            <label htmlFor="viewer-dependency-tag" className="sr-only">Filter by journal tag</label>
                            <NemotoSelect
                                id="viewer-dependency-tag"
                                controlSize="sm"
                                value={selectedTagId || ''}
                                onChange={event => chooseTag(event.target.value || null)}
                                className="w-full"
                            >
                                <option value="">No tag insight</option>
                                {availableTags.map(tag => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
                            </NemotoSelect>
                            {selectedTagId && viewGraph.tagInsight && (
                                <div role="status" className="mt-2 rounded-md border border-app-border bg-app-surface p-3 text-[10px] leading-relaxed text-text-muted">
                                    <p><strong className="text-text-main">{viewGraph.tagInsight.taggedEntryCount} tagged {viewGraph.tagInsight.taggedEntryCount === 1 ? 'note' : 'notes'}</strong>{' '}
                                        {viewGraph.tagInsight.taggedEntryCount === 1 ? 'points' : 'point'} to <strong className="text-text-main">{viewGraph.tagInsight.referencedEntityCount} {viewGraph.tagInsight.referencedEntityCount === 1 ? 'entity' : 'entities'}</strong>.</p>
                                    {!includeTaggedEntries && viewGraph.tagInsight.referencedEntityCount > 0 && <p className="mt-1 text-text-faint">Repeated references are combined; numbers show frequency.</p>}
                                    {viewGraph.tagInsight.taggedEntryCount > 0 && (
                                        <NemotoButton size="sm" variant="ghost" onClick={() => setIncludeTaggedEntries(value => !value)} className="mt-2 min-h-0 px-0 py-1 font-semibold text-accent-primary">
                                            {includeTaggedEntries ? 'Return to insight summary' : `Show ${viewGraph.tagInsight.taggedEntryCount} individual ${viewGraph.tagInsight.taggedEntryCount === 1 ? 'note' : 'notes'}`}
                                        </NemotoButton>
                                    )}
                                </div>
                            )}
                        </section>
                    )}

                    <section>
                        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Visible layers</h3>
                        <div className="space-y-1">
                            {(Object.keys(LAYER_LABELS) as Array<keyof VisibleLayers>).map(type => (
                                <Toggle
                                    key={type}
                                    label={LAYER_LABELS[type]}
                                    count={layerCounts[type]}
                                    color={entityColor({ id: type, label: type, type })}
                                    enabled={visibleLayers[type]}
                                    onClick={() => setVisibleLayers(current => ({ ...current, [type]: !current[type] }))}
                                />
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Visible relationships</h3>
                        <div className="space-y-1">
                            {RELATION_FILTERS.filter(filter => relationLayerCounts[filter.id] > 0).map(filter => (
                                <Toggle
                                    key={filter.id}
                                    label={filter.label}
                                    count={relationLayerCounts[filter.id]}
                                    color={getDependencyEdgeStroke(filter.sampleType)}
                                    dashed={!!RELATION_DASHES[filter.sampleType]}
                                    enabled={visibleRelations[filter.id]}
                                    onClick={() => setVisibleRelations(current => ({ ...current, [filter.id]: !current[filter.id] }))}
                                />
                            ))}
                        </div>
                        {query.kind === 'focus' && activeFocal && (
                            <NemotoSegmented className="mt-3 grid w-full grid-cols-3" aria-label="Relationship direction">
                                {([['both', 'All'], ['incoming', 'Into'], ['outgoing', 'Out of']] as Array<[RelationDirection, string]>).map(([direction, label]) => (
                                    <NemotoSegmentedOption key={direction} active={relationDirection === direction} onClick={() => setRelationDirection(direction)}>{label}</NemotoSegmentedOption>
                                ))}
                            </NemotoSegmented>
                        )}
                    </section>

                    <section>
                        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Current map</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-md border border-app-border bg-app-surface p-2 text-center"><div className="text-base font-bold">{displayedNodes.length}</div><div className="text-[9px] uppercase text-text-faint">Entities</div></div>
                            <div className="rounded-md border border-app-border bg-app-surface p-2 text-center"><div className="text-base font-bold">{displayedEdges.length}</div><div className="text-[9px] uppercase text-text-faint">Relations</div></div>
                        </div>
                    </section>
                </div>

                <div className="mt-auto border-t border-app-border p-3">
                    <NemotoButton onClick={() => { setNodes(baseNodes); reactFlowInstance.current?.fitView({ padding: 0.2, duration: getMotionDurationMs(motionDurationMs.slow) }); }} className="w-full justify-center">
                        <RefreshCw size={13} /> Reset layout and fit
                    </NemotoButton>
                </div>
            </aside>

            <main className="relative min-w-0 flex-1 overflow-hidden">
                <ReactFlow
                    className="gravity-well-viewer"
                    nodes={displayedNodes}
                    edges={displayedEdges}
                    nodeTypes={NODE_TYPES}
                    onNodesChange={onNodesChange}
                    nodesDraggable
                    nodesConnectable={false}
                    elementsSelectable
                    onlyRenderVisibleElements
                    minZoom={0.08}
                    maxZoom={2}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    onInit={instance => { reactFlowInstance.current = instance; }}
                    onNodeClick={(_, node) => {
                        const nextSelectedId = selectedNodeId === node.id ? null : node.id;
                        setSelectedNodeId(nextSelectedId);
                        if (!nextSelectedId) {
                            onNodeClick(null);
                            return;
                        }

                        const selectedEntity = graphIndex.entities.get(node.id);
                        const sourceEntity = sourceById.get(node.id) || selectedEntity || node.data;
                        const dependencyRelations = viewGraph.relations
                            .filter(relation => relation.source === node.id || relation.target === node.id)
                            .map(relation => {
                                const otherId = relation.source === node.id ? relation.target : relation.source;
                                const other = graphIndex.entities.get(otherId);
                                return other ? {
                                    id: relation.id,
                                    label: getRelationPerspective(relation, node.id).label,
                                    count: relation.count,
                                    other: {
                                        id: other.id,
                                        label: other.label,
                                        type: other.type,
                                        subtitle: entitySubtitle(other),
                                    },
                                } : null;
                            })
                            .filter(Boolean);

                        onNodeClick({
                            ...sourceEntity,
                            dependencyRelations,
                        });
                    }}
                    onNodeDoubleClick={(_, node) => {
                        const entity = graphIndex.entities.get(node.id);
                        if (entity && entity.type !== 'tag') chooseFocalPoint(entity);
                    }}
                    onPaneClick={() => {
                        setSelectedNodeId(null);
                        onNodeClick(null);
                    }}
                >
                    <Background color="var(--color-app-grid)" gap={48} size={1} variant={BackgroundVariant.Dots} />
                </ReactFlow>

                {viewGraph.truncated && (
                    <div className="pointer-events-none absolute left-4 top-4 flex max-w-sm items-start gap-2 rounded-md border border-accent-warning/50 bg-app-surface/95 p-3 text-[11px] shadow-lg">
                        <Info size={14} className="mt-0.5 shrink-0 text-accent-warning" />
                        <span>The map reached its {MAX_RENDERED_NODES}-entity safety limit. Narrow the focus to inspect omitted relationships.</span>
                    </div>
                )}
                {viewGraph.nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="rounded-lg border border-app-border bg-app-surface p-5 text-center shadow-lg">
                            <h3 className="text-sm font-semibold">No dependency data in this scope</h3>
                            <p className="mt-1 text-[11px] text-text-muted">Clear the current filter or choose another focal point.</p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};
