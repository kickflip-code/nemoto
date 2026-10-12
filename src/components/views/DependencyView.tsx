import { GRAPH_NAVIGATION } from '../../lib/graphNavigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    BackgroundVariant,
    Edge,
    MarkerType,
    Node,
    Panel,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
    AlertTriangle,
    ChevronDown,
    Copy,
    Crosshair,
    ExternalLink,
    Focus,
    Info,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useUIStore } from '../../stores/useUIStore';
import { useShallow } from 'zustand/react/shallow';
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
import {
    layoutDependencyGraph,
    layoutFocusedDependencyGraph,
    layoutProcessScope,
} from '../../lib/dependencyLayout';
import { getMotionDurationMs, motionDurationMs } from '../../lib/motion';
import { getDependencyEdgeStroke } from '../../lib/dependencyEdgeStyles';
import { navigateToEntityReference } from '../../lib/entityNavigation';
import { getPaletteColor } from '../../constants/palette';
import ContextMenu, { ContextMenuItem } from '../shared/ContextMenu';
import {
    NemotoButton,
    NemotoInput,
    NemotoPanel,
    NemotoPanelBody,
    NemotoPanelHeader,
    NemotoPanelIconButton,
    NemotoPanelRowButton,
    NemotoRange,
    NemotoSegmented,
    NemotoSegmentedOption,
    NemotoSelect,
    NemotoToggleCard,
} from '../ui';
import { GravityNode } from './GravityNode';

const MAX_RENDERED_NODES = 350;

const NODE_TYPES = { dependency: GravityNode };

const RELATION_LABELS: Record<DependencyRelationType, string> = {
    contains: 'Contains',
    flow: 'Process flow',
    'asset-reference': 'Uses resource',
    'journal-reference': 'Journal reference',
    'tag-membership': 'Tagged note',
    'tag-insight': 'Tagged reference',
    'process-resource': 'Process uses resource',
};

const RELATION_DASHES: Partial<Record<DependencyRelationType, string>> = {
    contains: '7 7',
    'journal-reference': '3 6',
    'tag-membership': '2 5',
};

const LAYER_LABELS: Record<Exclude<DependencyEntityType, 'tag'>, string> = {
    process: 'Processes',
    asset: 'Resources',
    entry: 'Journal',
    node: 'Steps',
};

type VisibleLayers = Record<Exclude<DependencyEntityType, 'tag'>, boolean>;

type RelationLayer = 'flow' | 'resource' | 'journal' | 'contains' | 'tagged';
type VisibleRelationLayers = Record<RelationLayer, boolean>;
type RelationDirection = 'both' | 'incoming' | 'outgoing';

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

function selectHorizontalHandles(
    source: { position: { x: number; y: number }; width: number; height: number },
    target: { position: { x: number; y: number }; width: number; height: number },
): { sourceHandle: string; targetHandle: string } {
    const sourceX = source.position.x + source.width / 2;
    const targetX = target.position.x + target.width / 2;
    return targetX >= sourceX
        ? { sourceHandle: 'source-r', targetHandle: 'target-l' }
        : { sourceHandle: 'source-l', targetHandle: 'target-r' };
}

function DependencyLegend({ visibleRelations }: { visibleRelations: VisibleRelationLayers }) {
    return (
        <div className="rounded-lg border border-app-border bg-app-surface/95 p-3 shadow-lg backdrop-blur-sm" aria-label="Relationship legend">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Relationships</div>
            <div className="space-y-1.5">
                {RELATION_FILTERS.map(filter => (
                    <div
                        key={filter.id}
                        className="flex items-center gap-2 text-[11px] text-text-muted transition-opacity"
                        style={{ opacity: visibleRelations[filter.id] ? 1 : 0.35 }}
                    >
                        <span
                            className="block h-0 w-7 border-t-2"
                            style={{
                                borderColor: getDependencyEdgeStroke(filter.sampleType),
                                borderTopStyle: RELATION_DASHES[filter.sampleType] ? 'dashed' : 'solid',
                            }}
                        />
                        <span>{filter.label}</span>
                    </div>
                ))}
            </div>
            <div className="mt-2 border-t border-app-border pt-2 text-[10px] text-text-faint">
                Arrowheads show the stored direction. Shared context does not prove operational dependency.
            </div>
        </div>
    );
}

function RelationToggle({
    filter,
    count,
    enabled,
    onToggle,
}: {
    filter: typeof RELATION_FILTERS[number];
    count: number;
    enabled: boolean;
    onToggle: () => void;
}) {
    const color = getDependencyEdgeStroke(filter.sampleType);
    return (
        <NemotoToggleCard
            aria-label={`${filter.label} ${count}`}
            active={enabled}
            onClick={onToggle}
        >
            <span className="flex items-center gap-2">
                <span
                    className="block h-0 w-5 border-t-2"
                    style={{
                        borderColor: color,
                        borderTopStyle: RELATION_DASHES[filter.sampleType] ? 'dashed' : 'solid',
                    }}
                />
                {filter.label}
            </span>
            <span className="font-mono text-[10px] text-text-muted">{count}</span>
        </NemotoToggleCard>
    );
}

function LayerToggle({
    type,
    count,
    enabled,
    onToggle,
}: {
    type: Exclude<DependencyEntityType, 'tag'>;
    count: number;
    enabled: boolean;
    onToggle: () => void;
}) {
    const color = entityColor({ id: type, label: type, type });
    return (
        <NemotoToggleCard
            active={enabled}
            onClick={onToggle}
        >
            <span className="flex items-center gap-2">
                <span
                    className="h-2.5 w-2.5 rounded-sm border"
                    style={{ backgroundColor: enabled ? color : 'transparent', borderColor: color }}
                />
                {LAYER_LABELS[type]}
            </span>
            <span className="font-mono text-[10px] text-text-muted">{count}</span>
        </NemotoToggleCard>
    );
}

export default function DependencyView() {
    return (
        <ReactFlowProvider>
            <DependencyViewInner />
        </ReactFlowProvider>
    );
}

function DependencyViewInner() {
    const portfolio = usePortfolioStore(state => state.portfolio);
    const {
        gravityWellFocalPoint,
        gravityWellFolderId,
        gravityWellProcessIds,
        setGravityWellFocalPoint,
        setGravityWellFolderId,
        setGravityWellProcessIds,
        toggleGravityWellProcessId,
    } = useUIStore(useShallow(state => ({
        gravityWellFocalPoint: state.gravityWellFocalPoint,
        gravityWellFolderId: state.gravityWellFolderId,
        gravityWellProcessIds: state.gravityWellProcessIds,
        setGravityWellFocalPoint: state.setGravityWellFocalPoint,
        setGravityWellFolderId: state.setGravityWellFolderId,
        setGravityWellProcessIds: state.setGravityWellProcessIds,
        toggleGravityWellProcessId: state.toggleGravityWellProcessId,
    })));
    const [depth, setDepth] = useState(1);
    const [includeUnlinkedResources, setIncludeUnlinkedResources] = useState(false);
    const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
    const [includeTaggedEntries, setIncludeTaggedEntries] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [showDataIssues, setShowDataIssues] = useState(false);
    const [relationDirection, setRelationDirection] = useState<RelationDirection>('both');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
    const [visibleLayers, setVisibleLayers] = useState<VisibleLayers>({
        process: true,
        asset: true,
        entry: true,
        node: true,
    });
    const [visibleRelations, setVisibleRelations] = useState<VisibleRelationLayers>({
        flow: true,
        resource: true,
        journal: true,
        contains: false,
        tagged: true,
    });
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges] = useEdgesState([]);
    const reactFlowInstance = useRef<any>(null);

    const graphIndex = useMemo(() => buildDependencyGraphIndex(portfolio), [portfolio]);

    const query = useMemo<DependencyQuery>(() => {
        if (selectedTagId) {
            return {
                kind: 'tag',
                tagId: selectedTagId,
                maxNodes: MAX_RENDERED_NODES,
                includeJournalEntries: includeTaggedEntries,
            };
        }
        if (gravityWellFocalPoint) {
            return {
                kind: 'focus',
                focalId: gravityWellFocalPoint.id,
                depth,
                maxNodes: MAX_RENDERED_NODES,
            };
        }
        if (gravityWellFolderId || gravityWellProcessIds.length > 0) {
            return {
                kind: 'process',
                folderId: gravityWellFolderId,
                processIds: gravityWellProcessIds,
                maxNodes: MAX_RENDERED_NODES,
            };
        }
        return {
            kind: 'overview',
            maxNodes: MAX_RENDERED_NODES,
            includeUnlinkedResources,
        };
    }, [depth, gravityWellFocalPoint, gravityWellFolderId, gravityWellProcessIds, includeTaggedEntries, includeUnlinkedResources, selectedTagId]);

    const viewGraph = useMemo(
        () => queryDependencyGraph(graphIndex, portfolio, query),
        [graphIndex, portfolio, query],
    );

    const relationCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const relation of viewGraph.relations) {
            if (!visibleRelations[getRelationLayer(relation.type)]) continue;
            if (query.kind === 'focus' && gravityWellFocalPoint && relationDirection !== 'both') {
                const matchesDirection = relationDirection === 'incoming'
                    ? relation.target === gravityWellFocalPoint.id
                    : relation.source === gravityWellFocalPoint.id;
                if (!matchesDirection) continue;
            }
            counts.set(relation.source, (counts.get(relation.source) || 0) + 1);
            counts.set(relation.target, (counts.get(relation.target) || 0) + 1);
        }
        return counts;
    }, [gravityWellFocalPoint, query.kind, relationDirection, viewGraph.relations, visibleRelations]);

    const nodeLayouts = useMemo(
        () => query.kind === 'process'
            ? layoutProcessScope(viewGraph.nodes, viewGraph.relations)
            : query.kind === 'focus'
                ? layoutFocusedDependencyGraph(viewGraph.nodes, viewGraph.relations)
            : layoutDependencyGraph(viewGraph.nodes),
        [query.kind, viewGraph.nodes, viewGraph.relations],
    );

    const baseNodes = useMemo<Node[]>(() => {
        const layoutById = new Map(nodeLayouts.map(layout => [layout.id, layout]));

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
        const layoutById = new Map(nodeLayouts.map(layout => [layout.id, layout]));

        return viewGraph.relations.flatMap(relation => {
            const source = layoutById.get(relation.source);
            const target = layoutById.get(relation.target);
            if (!source || !target) return [];
            const stroke = getDependencyEdgeStroke(relation.type);
            const handles = relation.type === 'process-resource'
                ? selectHorizontalHandles(source, target)
                : selectHandles(source, target);
            const aggregatedWidth = relation.count ? Math.min(1.5 + relation.count * 0.35, 5) : 1.7;

            return [{
                id: relation.id,
                source: relation.source,
                target: relation.target,
                sourceHandle: handles.sourceHandle,
                targetHandle: handles.targetHandle,
                type: query.kind === 'overview' || query.kind === 'process' || query.kind === 'focus'
                    ? 'smoothstep'
                    : 'default',
                ariaLabel: RELATION_LABELS[relation.type],
                label: relation.count && relation.count > 1 ? String(relation.count) : undefined,
                labelStyle: { fill: 'var(--color-text-main)', fontSize: 10, fontWeight: 700 },
                labelBgStyle: { fill: 'var(--color-app-surface)', fillOpacity: 0.92 },
                labelBgPadding: [5, 3],
                labelBgBorderRadius: 4,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: stroke,
                    width: 14,
                    height: 14,
                },
                data: { relationType: relation.type },
                style: {
                    stroke,
                    strokeWidth: aggregatedWidth,
                    strokeDasharray: RELATION_DASHES[relation.type],
                    opacity: 0.72,
                },
            }];
        });
    }, [nodeLayouts, query.kind, viewGraph.relations]);

    useEffect(() => {
        setNodes(baseNodes);
        setEdges(baseEdges);
        const timer = window.setTimeout(() => {
            reactFlowInstance.current?.fitView({
                padding: 0.22,
                duration: getMotionDurationMs(motionDurationMs.slow),
            });
        }, 40);
        return () => window.clearTimeout(timer);
    }, [baseEdges, baseNodes, setEdges, setNodes]);

    useEffect(() => {
        if (selectedNodeId && !viewGraph.nodes.some(node => node.id === selectedNodeId)) {
            setSelectedNodeId(null);
        }
    }, [selectedNodeId, viewGraph.nodes]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isEditable = target?.matches('input, textarea, select, [contenteditable="true"]');
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !isEditable) {
                event.preventDefault();
                document.getElementById('dependency-search')?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const layerCounts = useMemo(() => {
        const counts: Record<Exclude<DependencyEntityType, 'tag'>, number> = {
            process: 0,
            asset: 0,
            entry: 0,
            node: 0,
        };
        for (const node of viewGraph.nodes) {
            if (node.type !== 'tag') counts[node.type] += 1;
        }
        return counts;
    }, [viewGraph.nodes]);

    const relationLayerCounts = useMemo(() => {
        const counts: Record<RelationLayer, number> = {
            flow: 0,
            resource: 0,
            journal: 0,
            contains: 0,
            tagged: 0,
        };
        for (const relation of viewGraph.relations) counts[getRelationLayer(relation.type)] += 1;
        return counts;
    }, [viewGraph.relations]);

    const danglingBreakdown = useMemo(() => (
        Object.entries(viewGraph.danglingRelationCounts) as Array<[DependencyRelationType, number]>
    ).filter(([, count]) => count > 0), [viewGraph.danglingRelationCounts]);

    const layerVisibleNodeIds = useMemo(() => new Set(
        nodes
            .filter(node => node.data?.isFocal || node.data?.type === 'tag' || visibleLayers[node.data?.type as keyof VisibleLayers])
            .map(node => node.id),
    ), [nodes, visibleLayers]);

    const relationVisibleEdges = useMemo(() => edges.filter(edge => {
        if (!layerVisibleNodeIds.has(edge.source) || !layerVisibleNodeIds.has(edge.target)) return false;
        const relationType = edge.data?.relationType as DependencyRelationType | undefined;
        if (relationType && !visibleRelations[getRelationLayer(relationType)]) return false;
        if (query.kind !== 'focus' || relationDirection === 'both' || !gravityWellFocalPoint) return true;
        return relationDirection === 'incoming'
            ? edge.target === gravityWellFocalPoint.id
            : edge.source === gravityWellFocalPoint.id;
    }), [edges, gravityWellFocalPoint, layerVisibleNodeIds, query.kind, relationDirection, visibleRelations]);

    const displayedNodeIds = useMemo(() => {
        if (query.kind !== 'focus' || relationDirection === 'both' || !gravityWellFocalPoint) {
            return layerVisibleNodeIds;
        }
        const ids = new Set<string>([gravityWellFocalPoint.id]);
        for (const edge of relationVisibleEdges) {
            ids.add(edge.source);
            ids.add(edge.target);
        }
        return ids;
    }, [gravityWellFocalPoint, layerVisibleNodeIds, query.kind, relationDirection, relationVisibleEdges]);

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

    const highlightId = hoveredNodeId || selectedNodeId;
    const displayedNodes = useMemo(() => nodes
        .filter(node => displayedNodeIds.has(node.id))
        .map(node => {
            const isRelated = !highlightId
                || node.id === highlightId
                || adjacency.get(highlightId)?.has(node.id);
            const dimmedOpacity = node.data?.isContext ? 0.46 : 0.26;
            return {
                ...node,
                style: { ...node.style, opacity: isRelated ? 1 : dimmedOpacity },
            };
        }), [adjacency, displayedNodeIds, highlightId, nodes]);

    const displayedEdges = useMemo(() => relationVisibleEdges
        .map(edge => {
            const isRelated = !highlightId || edge.source === highlightId || edge.target === highlightId;
            return {
                ...edge,
                style: {
                    ...edge.style,
                    opacity: isRelated ? (highlightId ? 0.98 : 0.82) : 0.12,
                    strokeWidth: isRelated && highlightId
                        ? Number(edge.style?.strokeWidth || 1.7) + 1.2
                        : edge.style?.strokeWidth,
                },
            };
        }), [highlightId, relationVisibleEdges]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            reactFlowInstance.current?.fitView({
                padding: 0.22,
                duration: getMotionDurationMs(motionDurationMs.slow),
            });
        }, 40);
        return () => window.clearTimeout(timer);
    }, [relationDirection, visibleLayers, visibleRelations]);

    const searchResults = useMemo(() => {
        const queryText = search.trim().toLocaleLowerCase();
        if (!queryText) return [];
        return [...graphIndex.entities.values()]
            .filter(entity => entity.type !== 'tag' && entity.label.toLocaleLowerCase().includes(queryText))
            .sort((a, b) => a.label.localeCompare(b.label))
            .slice(0, 40);
    }, [graphIndex.entities, search]);

    const selectedEntity = selectedNodeId ? graphIndex.entities.get(selectedNodeId) || null : null;
    const selectedRelations = useMemo(() => {
        if (!selectedNodeId) return [];
        return viewGraph.relations
            .filter(relation => relation.source === selectedNodeId || relation.target === selectedNodeId)
            .map(relation => {
                const otherId = relation.source === selectedNodeId ? relation.target : relation.source;
                return {
                    relation,
                    other: graphIndex.entities.get(otherId),
                    perspective: getRelationPerspective(relation, selectedNodeId),
                };
            })
            .filter((item): item is typeof item & { other: DependencyEntity } => !!item.other)
            .sort((a, b) => a.perspective.label.localeCompare(b.perspective.label) || a.other.label.localeCompare(b.other.label));
    }, [graphIndex.entities, selectedNodeId, viewGraph.relations]);

    const clearScopes = useCallback(() => {
        setGravityWellFocalPoint(null);
        setGravityWellFolderId(null);
        setGravityWellProcessIds([]);
        setSelectedTagId(null);
        setIncludeTaggedEntries(false);
        setSearch('');
        setSelectedNodeId(null);
    }, [setGravityWellFocalPoint, setGravityWellFolderId, setGravityWellProcessIds]);

    const chooseFocalPoint = useCallback((entity: DependencyEntity) => {
        setGravityWellFolderId(null);
        setGravityWellProcessIds([]);
        setSelectedTagId(null);
        setIncludeTaggedEntries(false);
        setGravityWellFocalPoint({ id: entity.id, label: entity.label });
        setSelectedNodeId(entity.id);
        setSearch('');
    }, [setGravityWellFocalPoint, setGravityWellFolderId, setGravityWellProcessIds]);

    const chooseProcess = useCallback((processId: string) => {
        setGravityWellFocalPoint(null);
        setSelectedTagId(null);
        setIncludeTaggedEntries(false);
        toggleGravityWellProcessId(processId);
        setSelectedNodeId(null);
    }, [setGravityWellFocalPoint, toggleGravityWellProcessId]);

    const chooseFolder = useCallback((folderId: string | null) => {
        setGravityWellFocalPoint(null);
        setSelectedTagId(null);
        setIncludeTaggedEntries(false);
        setGravityWellFolderId(folderId);
        setSelectedNodeId(null);
    }, [setGravityWellFocalPoint, setGravityWellFolderId]);

    const chooseTag = useCallback((tagId: string | null) => {
        setGravityWellFocalPoint(null);
        setGravityWellFolderId(null);
        setGravityWellProcessIds([]);
        setSelectedTagId(tagId);
        setIncludeTaggedEntries(false);
        setSelectedNodeId(tagId);
        setSearch('');
    }, [setGravityWellFocalPoint, setGravityWellFolderId, setGravityWellProcessIds]);

    const openEntity = useCallback((entity: DependencyEntity) => {
        if (entity.type === 'tag') return;
        const type = entity.type === 'entry' ? 'journalEntry' : entity.type;
        const result = navigateToEntityReference({
            id: entity.id,
            type,
            processId: entity.processId,
        }, 'navigate');
        if (!result.ok) toast.error(result.reason || 'Could not open the source.');
    }, []);

    const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
        event.preventDefault();
        const entity = graphIndex.entities.get(node.id);
        if (!entity) return;
        const items: ContextMenuItem[] = [
            {
                label: 'Set as focus',
                icon: Crosshair,
                action: () => chooseFocalPoint(entity),
            },
        ];
        if (entity.type !== 'tag') {
            items.push(
                { separator: true },
                {
                    label: 'Open source',
                    icon: ExternalLink,
                    action: () => openEntity(entity),
                },
            );
        }
        items.push({
            label: 'Copy link',
            icon: Copy,
            action: async () => {
                const type = entity.type === 'entry' ? 'journalEntry' : entity.type;
                await navigator.clipboard.writeText(`axiom://${type}/${entity.id}`);
                toast.success('Link copied');
            },
        });
        setContextMenu({ x: event.clientX, y: event.clientY, items });
    }, [chooseFocalPoint, graphIndex.entities, openEntity]);

    const queryLabel = query.kind === 'overview'
        ? 'Portfolio overview'
        : query.kind === 'focus'
            ? `Focused view · ${depth} ${depth === 1 ? 'step' : 'steps'}`
            : query.kind === 'process'
                ? 'Process scope'
                : includeTaggedEntries ? 'Journal notes' : 'Journal insight';

    return (
        <div className="absolute inset-0 flex min-h-0 w-full overflow-hidden bg-app-bg text-text-main">
            <NemotoPanel as="aside" className="z-20 flex h-full min-h-0 w-[340px] shrink-0 flex-col border-r border-app-border bg-app-sidebar" aria-label="Dependency controls">
                <NemotoPanelHeader className="shrink-0 border-b border-app-border px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h1 className="text-sm font-bold uppercase tracking-[0.16em] text-text-main">Dependency Map</h1>
                            <p className="mt-1 text-[11px] text-text-muted">{queryLabel}</p>
                        </div>
                        {query.kind !== 'overview' && (
                            <NemotoPanelIconButton
                                onClick={clearScopes}
                                aria-label="Clear all dependency scopes"
                                size="sm"
                                title="Back to portfolio overview"
                            >
                                <X size={15} />
                            </NemotoPanelIconButton>
                        )}
                    </div>
                </NemotoPanelHeader>

                <NemotoPanelBody className="app-scroll min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
                    {(query.kind === 'overview' || query.kind === 'process') && (
                        <section className="rounded-lg border border-app-border bg-app-surface p-3 text-[11px] leading-relaxed text-text-muted">
                            <div className="mb-1 flex items-center gap-2 font-semibold text-text-main">
                                <Info size={14} className="text-accent-primary" /> {query.kind === 'overview' ? 'Overview' : 'Scoped overview'}
                            </div>
                            <p>
                                {query.kind === 'overview'
                                    ? 'Processes and connected resources are summarized here. Choose a focus to inspect steps, notes and every connection around it.'
                                    : 'Process-specific resources are placed to the left, processes in the middle and shared resources to the right. Choose a focal point to inspect steps, notes and detailed relationships.'}
                            </p>
                            {query.kind === 'overview' && viewGraph.unlinkedResourceCount > 0 && (
                                <NemotoButton
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setIncludeUnlinkedResources(current => !current)}
                                    className="mt-2 px-0 font-semibold text-accent-primary hover:text-text-main"
                                >
                                    {includeUnlinkedResources
                                        ? `Hide ${viewGraph.unlinkedResourceCount} unlinked ${viewGraph.unlinkedResourceCount === 1 ? 'resource' : 'resources'}`
                                        : `Show ${viewGraph.unlinkedResourceCount} unlinked ${viewGraph.unlinkedResourceCount === 1 ? 'resource' : 'resources'}`}
                                </NemotoButton>
                            )}
                        </section>
                    )}

                    <section aria-labelledby="dependency-scope-heading">
                        <h2 id="dependency-scope-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Process scope</h2>
                        <div className="space-y-2">
                            <div className="relative">
                                <label htmlFor="dependency-folder" className="sr-only">Focus by process folder</label>
                                <NemotoSelect
                                    id="dependency-folder"
                                    controlSize="sm"
                                    value={gravityWellFolderId || ''}
                                    onChange={event => chooseFolder(event.target.value || null)}
                                    className="w-full appearance-none py-2 pl-3 pr-8 text-xs"
                                >
                                    <option value="">All folders</option>
                                    {(portfolio.processFolders || []).map(folder => (
                                        <option key={folder.id} value={folder.id}>{folder.title}</option>
                                    ))}
                                </NemotoSelect>
                                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint" />
                            </div>

                            <div className="relative">
                                <label htmlFor="dependency-process" className="sr-only">Add a process to scope</label>
                                <NemotoSelect
                                    id="dependency-process"
                                    controlSize="sm"
                                    value=""
                                    onChange={event => event.target.value && chooseProcess(event.target.value)}
                                    disabled={!!gravityWellFolderId}
                                    className="w-full appearance-none py-2 pl-3 pr-8 text-xs"
                                >
                                    <option value="" disabled>Add process…</option>
                                    {portfolio.processes
                                        .filter(process => !gravityWellProcessIds.includes(process.id))
                                        .map(process => <option key={process.id} value={process.id}>{process.title}</option>)}
                                </NemotoSelect>
                                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint" />
                            </div>

                            {gravityWellProcessIds.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {gravityWellProcessIds.map(processId => {
                                        const process = portfolio.processes.find(candidate => candidate.id === processId);
                                        return (
                                            <NemotoButton
                                                size="sm"
                                                key={processId}
                                                onClick={() => chooseProcess(processId)}
                                                className="flex max-w-full items-center gap-1 rounded-full border border-accent-primary/40 bg-accent-primary/10 px-2 py-1 text-[10px] text-accent-primary"
                                                aria-label={`Remove ${process?.title || 'process'} from scope`}
                                            >
                                                <span className="truncate">{process?.title || 'Missing process'}</span>
                                                <X size={10} />
                                            </NemotoButton>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </section>

                    <section aria-labelledby="dependency-layers-heading">
                        <h2 id="dependency-layers-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Visible layers</h2>
                        <div className="space-y-1">
                            {(Object.keys(LAYER_LABELS) as Array<keyof VisibleLayers>).map(type => (
                                <LayerToggle
                                    key={type}
                                    type={type}
                                    count={layerCounts[type]}
                                    enabled={visibleLayers[type]}
                                    onToggle={() => setVisibleLayers(current => ({ ...current, [type]: !current[type] }))}
                                />
                            ))}
                        </div>
                        {gravityWellFocalPoint && !visibleLayers[graphIndex.entities.get(gravityWellFocalPoint.id)?.type as keyof VisibleLayers] && (
                            <p className="mt-2 text-[10px] text-text-faint">The focal point remains pinned when its layer is hidden.</p>
                        )}
                    </section>

                    <section aria-labelledby="dependency-relations-heading">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h2 id="dependency-relations-heading" className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Visible relationships</h2>
                            {!visibleRelations.contains && relationLayerCounts.contains > 0 && (
                                <span className="text-[9px] text-text-faint">Containment hidden</span>
                            )}
                        </div>
                        <div className="space-y-1">
                            {RELATION_FILTERS.filter(filter => relationLayerCounts[filter.id] > 0).map(filter => (
                                <RelationToggle
                                    key={filter.id}
                                    filter={filter}
                                    count={relationLayerCounts[filter.id]}
                                    enabled={visibleRelations[filter.id]}
                                    onToggle={() => setVisibleRelations(current => ({
                                        ...current,
                                        [filter.id]: !current[filter.id],
                                    }))}
                                />
                            ))}
                            {viewGraph.relations.length === 0 && (
                                <p className="rounded-md border border-dashed border-app-border p-2 text-[10px] text-text-faint">No relationships in this scope.</p>
                            )}
                        </div>
                        {query.kind === 'focus' && gravityWellFocalPoint && (
                            <div className="mt-3">
                                <div className="mb-1.5 text-[10px] font-medium text-text-faint">Direction around focus</div>
                                <NemotoSegmented className="flex w-full" aria-label="Relationship direction">
                                    {([
                                        ['both', 'All'],
                                        ['incoming', 'Into'],
                                        ['outgoing', 'Out of'],
                                    ] as Array<[RelationDirection, string]>).map(([direction, label]) => (
                                        <NemotoSegmentedOption
                                            key={direction}
                                            active={relationDirection === direction}
                                            onClick={() => setRelationDirection(direction)}
                                            className="flex-1"
                                        >
                                            {label}
                                        </NemotoSegmentedOption>
                                    ))}
                                </NemotoSegmented>
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="dependency-tag-heading">
                        <h2 id="dependency-tag-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Journal insight</h2>
                        <label htmlFor="dependency-tag" className="sr-only">Filter by journal tag</label>
                        <NemotoSelect
                            id="dependency-tag"
                            controlSize="sm"
                            value={selectedTagId || ''}
                            onChange={event => chooseTag(event.target.value || null)}
                            className="w-full px-3 py-2 text-xs"
                        >
                            <option value="">No tag filter</option>
                            {(portfolio.journal?.tags || [])
                                .filter(tag => !tag.archived)
                                .map(tag => <option key={tag.id} value={tag.id}>{tag.label}</option>)}
                        </NemotoSelect>
                        {!selectedTagId && (
                            <p className="mt-2 text-[10px] leading-relaxed text-text-faint">Choose a tag to see which entities its notes reference most often.</p>
                        )}
                        {selectedTagId && viewGraph.tagInsight && (
                            <div role="status" className="mt-2 rounded-lg border border-app-border bg-app-surface p-3 text-[11px] leading-relaxed text-text-muted">
                                <p>
                                    <span className="font-semibold text-text-main">
                                        {viewGraph.tagInsight.taggedEntryCount} tagged {viewGraph.tagInsight.taggedEntryCount === 1 ? 'note' : 'notes'}
                                    </span>
                                    {' '}{viewGraph.tagInsight.taggedEntryCount === 1 ? 'points' : 'point'} to{' '}
                                    <span className="font-semibold text-text-main">
                                        {viewGraph.tagInsight.referencedEntityCount} {viewGraph.tagInsight.referencedEntityCount === 1 ? 'entity' : 'entities'}
                                    </span>.
                                </p>
                                {!includeTaggedEntries && viewGraph.tagInsight.referencedEntityCount > 0 && (
                                    <p className="mt-1 text-text-faint">Repeated references are combined; the number on each entity shows frequency.</p>
                                )}
                                {viewGraph.tagInsight.unlinkedEntryCount > 0 && (
                                    <p className="mt-1 text-accent-warning">
                                        {viewGraph.tagInsight.unlinkedEntryCount} tagged {viewGraph.tagInsight.unlinkedEntryCount === 1 ? 'note has' : 'notes have'} no valid entity reference.
                                    </p>
                                )}
                                {viewGraph.tagInsight.taggedEntryCount > 0 && (
                                    <NemotoButton
                                        size="sm"
                                        variant="ghost"
                                        aria-pressed={includeTaggedEntries}
                                        onClick={() => setIncludeTaggedEntries(current => !current)}
                                        className="mt-2 px-0 font-semibold text-accent-primary hover:text-text-main"
                                    >
                                        {includeTaggedEntries
                                            ? 'Return to insight summary'
                                            : `Show ${viewGraph.tagInsight.taggedEntryCount} individual ${viewGraph.tagInsight.taggedEntryCount === 1 ? 'note' : 'notes'}`}
                                    </NemotoButton>
                                )}
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="dependency-focus-heading">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <h2 id="dependency-focus-heading" className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Focal point</h2>
                            {gravityWellFocalPoint && (
                                <NemotoButton
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setGravityWellFocalPoint(null);
                                        setSelectedNodeId(null);
                                    }}
                                    className="px-0 text-[10px] text-text-muted hover:text-text-main"
                                >
                                    Clear focus
                                </NemotoButton>
                            )}
                        </div>

                        {gravityWellFocalPoint && (
                            <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 p-2.5">
                                <Focus size={14} className="shrink-0 text-accent-primary" />
                                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-main">{gravityWellFocalPoint.label}</span>
                            </div>
                        )}

                        <div className="relative">
                            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                            <label htmlFor="dependency-search" className="sr-only">Search for a focal point</label>
                            <NemotoInput
                                id="dependency-search"
                                controlSize="sm"
                                type="search"
                                placeholder="Search entities…"
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                                className="nemoto-field-leading-icon w-full py-2 pr-3 text-xs placeholder:text-text-faint"
                                autoComplete="off"
                            />
                        </div>

                        {search && (
                            <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-app-border bg-app-surface p-1 app-scroll" aria-label="Focal point search results">
                                {searchResults.length > 0 ? searchResults.map(entity => (
                                    <NemotoPanelRowButton
                                        key={entity.id}
                                        onClick={() => chooseFocalPoint(entity)}
                                        className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left"
                                    >
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-main">{entity.label}</span>
                                        <span className="shrink-0 text-[10px] uppercase text-text-faint">{entitySubtitle(entity)}</span>
                                    </NemotoPanelRowButton>
                                )) : (
                                    <div className="px-2.5 py-3 text-center text-[11px] text-text-faint">No matching entities</div>
                                )}
                            </div>
                        )}

                        {gravityWellFocalPoint ? (
                            <div className="mt-3">
                                <div className="mb-2 flex items-center justify-between text-[11px]">
                                    <label htmlFor="dependency-depth" className="font-medium text-text-muted">Reach</label>
                                    <span className="font-mono text-accent-primary">{depth} {depth === 1 ? 'step' : 'steps'}</span>
                                </div>
                                <NemotoRange
                                    id="dependency-depth"
                                    min={1}
                                    max={3}
                                    step={1}
                                    value={depth}
                                    onChange={event => setDepth(Number(event.target.value))}
                                    className="gravity-slider-track h-1 w-full cursor-pointer appearance-none rounded-full bg-app-border accent-accent-primary"
                                />
                                <div className="mt-1 flex justify-between text-[10px] text-text-faint"><span>Direct</span><span>Extended</span></div>
                                <p className="mt-2 text-[10px] leading-relaxed text-text-faint">
                                    Reach counts relationship hops in either direction. Into and Out of show only direct relationships with the focal point.
                                </p>
                            </div>
                        ) : (
                            <p className="mt-2 text-[10px] text-text-faint">Choose a focal point to set relationship reach.</p>
                        )}
                    </section>

                    <section aria-labelledby="dependency-summary-heading">
                        <h2 id="dependency-summary-heading" className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Current map</h2>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-lg border border-app-border bg-app-surface p-3 text-center">
                                <div className="text-lg font-bold text-text-main">{displayedNodes.length}</div>
                                <div className="text-[10px] uppercase text-text-faint">Entities</div>
                            </div>
                            <div className="rounded-lg border border-app-border bg-app-surface p-3 text-center">
                                <div className="text-lg font-bold text-text-main">{displayedEdges.length}</div>
                                <div className="text-[10px] uppercase text-text-faint">Relations</div>
                            </div>
                        </div>
                    </section>

                    {selectedEntity && (
                        <section className="border-t border-app-border pt-5" aria-labelledby="dependency-details-heading">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <h2 id="dependency-details-heading" className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">Selected entity</h2>
                                <NemotoPanelIconButton size="sm" onClick={() => setSelectedNodeId(null)} className="text-text-faint" aria-label="Close entity details">
                                    <X size={13} />
                                </NemotoPanelIconButton>
                            </div>

                            <div className="rounded-lg border border-app-border bg-app-surface p-3">
                                <div className="text-xs font-semibold leading-snug text-text-main">{selectedEntity.label}</div>
                                <div className="mt-1 text-[10px] uppercase tracking-[0.08em]" style={{ color: entityColor(selectedEntity) }}>{entitySubtitle(selectedEntity)}</div>
                                {selectedEntity.type !== 'tag' && (
                                    <NemotoButton
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => openEntity(selectedEntity)}
                                        className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-accent-primary hover:text-text-main"
                                    >
                                        <ExternalLink size={12} /> Open source
                                    </NemotoButton>
                                )}
                            </div>

                            <div className="mt-3">
                                <div className="mb-1.5 text-[10px] font-medium uppercase text-text-faint">Direct relationships ({selectedRelations.length})</div>
                                <div className="space-y-1">
                                    {selectedRelations.slice(0, 60).map(({ relation, other, perspective }) => (
                                        <div key={relation.id} className="flex items-center gap-1 rounded-md border border-app-border bg-app-surface p-1">
                                            <NemotoPanelRowButton
                                                onClick={() => setSelectedNodeId(other.id)}
                                                className="min-w-0 flex-1 px-2 py-1.5 text-left"
                                            >
                                                <div className="text-[10px] font-medium text-text-muted">
                                                    {perspective.label}
                                                    {relation.type === 'tag-insight' && relation.count
                                                        ? ` · ${relation.count} tagged ${relation.count === 1 ? 'note' : 'notes'}`
                                                        : ''}
                                                </div>
                                                <div className="truncate text-[11px] text-text-main">{other.label}</div>
                                            </NemotoPanelRowButton>
                                            {other.type !== 'tag' && (
                                                <NemotoButton
                                                    icon
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => openEntity(other)}
                                                    className="shrink-0"
                                                    aria-label={`Open ${other.label}`}
                                                >
                                                    <ExternalLink size={12} />
                                                </NemotoButton>
                                            )}
                                        </div>
                                    ))}
                                    {selectedRelations.length === 0 && (
                                        <div className="rounded-md border border-dashed border-app-border p-3 text-center text-[11px] text-text-faint">No direct relationships in the current map.</div>
                                    )}
                                    {selectedRelations.length > 60 && (
                                        <div className="text-[10px] text-text-faint">Showing the first 60 relationships.</div>
                                    )}
                                </div>
                            </div>
                        </section>
                    )}
                </NemotoPanelBody>

                <footer className="shrink-0 border-t border-app-border p-3">
                    <NemotoButton
                        size="sm"
                        onClick={() => {
                            setNodes(baseNodes);
                            reactFlowInstance.current?.fitView({
                                padding: 0.22,
                                duration: getMotionDurationMs(motionDurationMs.slow),
                            });
                        }}
                        className="w-full justify-center py-2 text-xs"
                    >
                        <RefreshCw size={13} /> Reset layout and fit
                    </NemotoButton>
                </footer>
            </NemotoPanel>

            <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-app-bg">
                <ReactFlow
                {...GRAPH_NAVIGATION}
                    className="gravity-well-graph"
                    nodes={displayedNodes}
                    edges={displayedEdges}
                    onNodesChange={onNodesChange}
                    nodesDraggable
                    nodesConnectable={false}
                    elementsSelectable
                    nodesFocusable
                    edgesFocusable
                    onlyRenderVisibleElements
                    minZoom={0.08}
                    maxZoom={2}
                    fitView
                    fitViewOptions={{ padding: 0.22 }}
                    nodeTypes={NODE_TYPES}
                    onInit={instance => { reactFlowInstance.current = instance; }}
                    onNodeClick={(_, node) => setSelectedNodeId(current => current === node.id ? null : node.id)}
                    onNodeDoubleClick={(_, node) => {
                        const entity = graphIndex.entities.get(node.id);
                        if (entity) openEntity(entity);
                    }}
                    onNodeContextMenu={handleNodeContextMenu}
                    onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
                    onNodeMouseLeave={() => setHoveredNodeId(null)}
                    onPaneClick={() => setSelectedNodeId(null)}
                >
                    <Background color="var(--color-app-grid)" gap={48} size={1} variant={BackgroundVariant.Dots} />
                    <Panel position="top-left" className="m-4">
                        {viewGraph.truncated && (
                            <div className="flex max-w-sm items-start gap-2 rounded-lg border border-accent-warning/50 bg-app-surface/95 p-3 text-[11px] text-text-main shadow-lg backdrop-blur-sm">
                                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-accent-warning" />
                                <span>The map reached its {MAX_RENDERED_NODES}-entity safety limit. Narrow the scope or reduce reach to inspect omitted relationships.</span>
                            </div>
                        )}
                        {!viewGraph.truncated && viewGraph.hiddenNodeCount > 0 && (
                            <div className="flex max-w-sm items-start gap-2 rounded-lg border border-app-border bg-app-surface/95 p-3 text-[11px] text-text-muted shadow-lg backdrop-blur-sm">
                                <Info size={15} className="mt-0.5 shrink-0 text-accent-primary" />
                                <span>{viewGraph.hiddenNodeCount} lower-priority entities are summarized out of this overview. Select a focus to inspect them.</span>
                            </div>
                        )}
                        {viewGraph.danglingReferenceCount > 0 && (
                            <div className="mt-2 max-w-xs rounded-lg border border-accent-warning/40 bg-app-surface/95 shadow-lg backdrop-blur-sm">
                                <NemotoPanelRowButton
                                    aria-expanded={showDataIssues}
                                    onClick={() => setShowDataIssues(current => !current)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-text-main"
                                >
                                    <AlertTriangle size={14} className="shrink-0 text-accent-warning" />
                                    <span className="flex-1">Portfolio issues · {viewGraph.danglingReferenceCount}</span>
                                    <ChevronDown size={13} className={`text-text-faint transition-transform ${showDataIssues ? 'rotate-180' : ''}`} />
                                </NemotoPanelRowButton>
                                {showDataIssues && (
                                    <div className="border-t border-app-border px-3 py-2.5 text-[10px] leading-relaxed text-text-muted">
                                        <p>These portfolio-wide references point to entities that no longer exist and are excluded from the map.</p>
                                        <div className="mt-2 space-y-1">
                                            {danglingBreakdown.map(([type, count]) => (
                                                <div key={type} className="flex items-center justify-between gap-4">
                                                    <span>{RELATION_LABELS[type]}</span>
                                                    <span className="font-mono text-text-main">{count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </Panel>
                    <Panel position="top-right" className="m-4"><DependencyLegend visibleRelations={visibleRelations} /></Panel>
                    <Panel position="bottom-right" className="m-4 rounded-md border border-app-border bg-app-surface/90 px-2.5 py-1.5 font-mono text-[10px] text-text-muted">
                        {displayedNodes.length} entities · {displayedEdges.length} relations
                    </Panel>
                </ReactFlow>

                {viewGraph.nodes.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                        <div className="max-w-xs rounded-xl border border-app-border bg-app-surface p-6 text-center shadow-lg">
                            <Focus size={24} className="mx-auto mb-3 text-text-faint" />
                            <h2 className="text-sm font-semibold text-text-main">No dependency data in this scope</h2>
                            <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                                Add processes or resources, or clear the current scope to return to the portfolio overview.
                            </p>
                        </div>
                    </div>
                )}
            </main>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenu.items}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
