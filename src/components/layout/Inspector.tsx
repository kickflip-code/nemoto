import { divisionLanes, laneAxis } from '../../lib/canvasDivision';
import { useState, useEffect } from 'react';
import { Layers, X, Server, Trash2, Plus, MousePointer2, Move, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';

import AssetInspector from './AssetInspector';
import { PALETTE } from '../../constants/palette';
import { resolveEntity } from '../../lib/entityResolver';
import { getIconComponent } from '../../lib/iconMap';
import LinkedNotes from '../shared/LinkedNotes';
import ProcessInspector from './ProcessInspector';
import EntityPickerModal from '../shared/EntityPickerModal';
import { canOpenNodeDrilldown, openOrCreateNodeDrilldown } from '../../lib/drilldown';
import { getResourceReferenceAssetId } from '../../lib/resourceReferences';
import { getSmartHandles } from '../../lib/smartHandles';
import {
    DEFAULT_EDGE_ROUTING_MARGIN,
    MAX_EDGE_ROUTING_MARGIN,
    MIN_EDGE_ROUTING_MARGIN,
} from '../../lib/edgeRouting';
import { createDefaultEventData } from '../../lib/events';
import type { CanvasEdge, EdgeRoutingMode, NodeType } from '../../types';
import { EventInspectorFields } from './EventInspectorFields';
import {
    AxiomPanel,
    AxiomButton,
    AxiomPanelBody,
    AxiomPanelDivider,
    AxiomPanelHeader,
    AxiomPanelIconButton,
    AxiomSegmented,
    AxiomSegmentedOption,
    AxiomSwitch,
} from '../ui';

export default function Inspector() {
    const { toggleInspector, selectedAssetId, selectAsset, selectedSwimlaneId, selectSwimlane } = useUIStore();
    const { selectedNodeIds, selectedEdgeIds, graph, selectElements } = useCanvasStore();

    // Resizable logic
    const [width, setWidth] = useState(300);
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizing) {
                // Calculate new width: Window Width - Mouse X
                // Constrain between 250px and 600px
                const newWidth = Math.min(Math.max(window.innerWidth - e.clientX, 250), 600);
                setWidth(newWidth);
                document.body.style.cursor = 'ew-resize';
                document.body.style.userSelect = 'none'; // Prevent text selection
            }
        };

        const handleMouseUp = () => {
            if (isResizing) {
                setIsResizing(false);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    // Determine what to show
    const singleSelectedNode = selectedNodeIds.length === 1 ? graph.nodes.find(n => n.id === selectedNodeIds[0]) : null;
    const isResourceNode = singleSelectedNode?.type === 'resource';
    const resourceNodeAssetId = getResourceReferenceAssetId(singleSelectedNode) || null;

    const activeAssetId = isResourceNode && resourceNodeAssetId ? resourceNodeAssetId : selectedAssetId;
    const showAsset = activeAssetId !== null;
    const showSwimlane = selectedSwimlaneId !== null && !showAsset;
    const canvasSelectionCount = selectedNodeIds.length + selectedEdgeIds.length;
    const showMultiSelection = canvasSelectionCount > 1 && !showAsset && !showSwimlane;
    const showEdge = selectedEdgeIds.length === 1 && selectedNodeIds.length === 0 && !showAsset && !showSwimlane;
    const showNode = selectedNodeIds.length === 1 && selectedEdgeIds.length === 0 && !showAsset && !showSwimlane;

    let title = 'Process Properties';
    if (showAsset) title = 'Resource Details';
    else if (showSwimlane) title = 'Division';
    else if (showMultiSelection) title = `${canvasSelectionCount} Selected`;
    else if (showEdge) title = 'Edge Properties';
    else if (showNode) title = 'Node Properties';

    return (
        <AxiomPanel
            as="aside"
            className="axiom-inspector-panel border-l flex flex-col shrink-0 z-20 shadow-xl relative h-full"
            style={{ width: `${width}px` }}
        >
            {/* Resize Handle */}
            <div
                className="axiom-panel-resizer absolute left-0 top-0 bottom-0 w-1.5 hover:w-2 -ml-0.5 cursor-ew-resize z-50"
                onMouseDown={(e) => {
                    e.preventDefault(); // Prevent text selection start
                    setIsResizing(true);
                }}
            />

            {/* Header */}
            <AxiomPanelHeader className="h-10 px-4 flex items-center justify-between border-b">
                <span className="text-xs font-bold text-text-main">{title}</span>
                <AxiomPanelIconButton
                    aria-label={`Close ${title}`}
                    onClick={() => {
                        if (selectedAssetId) selectAsset(null);
                        else if (showSwimlane) selectSwimlane(null);
                        else if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) selectElements([], []);
                        toggleInspector();
                    }}
                >
                    <X size={16} />
                </AxiomPanelIconButton>
            </AxiomPanelHeader>

            <AxiomPanelBody className="flex-1 overflow-y-auto app-scroll p-4 space-y-6">
                {showAsset ? (
                    <AssetInspector id={activeAssetId!} />
                ) : showSwimlane ? (
                    <SwimlaneInspector id={selectedSwimlaneId!} />
                ) : showMultiSelection ? (
                    <MultiSelectionInspector nodeCount={selectedNodeIds.length} edgeCount={selectedEdgeIds.length} />
                ) : showEdge ? (
                    <EdgeInspector id={selectedEdgeIds[0]} />
                ) : showNode ? (
                    <NodeInspector id={selectedNodeIds[0]} />
                ) : (
                    <ProcessInspector />
                )}
            </AxiomPanelBody>
        </AxiomPanel>
    );
}

function MultiSelectionInspector({ nodeCount, edgeCount }: { nodeCount: number; edgeCount: number }) {
    const totalCount = nodeCount + edgeCount;
    const selectionSummary = [
        nodeCount > 0 ? `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}` : null,
        edgeCount > 0 ? `${edgeCount} ${edgeCount === 1 ? 'connection' : 'connections'}` : null,
    ].filter(Boolean).join(' · ');

    return (
        <div className="space-y-5" data-testid="multi-selection-inspector">
            <div className="axiom-panel-card flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-accent-primary/10 text-accent-primary">
                    <MousePointer2 size={19} />
                </div>
                <div className="min-w-0">
                    <div className="text-lg font-semibold leading-none text-text-main">{totalCount} selected</div>
                    <div className="mt-1 text-[10px] text-text-muted">{selectionSummary}</div>
                </div>
            </div>

            {nodeCount > 0 && (
                <div>
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                        <Move size={12} />
                        Move selection
                    </div>
                    <div className="space-y-2 text-xs leading-relaxed text-text-muted">
                        <p>Drag any selected node to move the entire group.</p>
                        <p><span className="font-medium text-text-main">Ctrl/Cmd-click</span> adds or removes individual nodes.</p>
                        <p><span className="font-medium text-text-main">Space-drag</span> pans the canvas without changing the selection.</p>
                    </div>
                </div>
            )}

            <AxiomPanelDivider />

            <p className="text-[10px] leading-relaxed text-text-faint">
                Connected lines remain attached and update automatically when the selected nodes move.
            </p>
        </div>
    );
}

function SwimlaneInspector({ id }: { id: string }) {
    const { graph, updateSwimlane, moveSwimlane, removeSwimlane } = useCanvasStore();
    const lane = graph.swimlanes.find(l => l.id === id);

    if (!lane) return <div className="text-text-muted text-xs">Division not found</div>;
    const column = laneAxis(graph, lane) === 'column';
    const ordered = divisionLanes(graph, laneAxis(graph, lane));
    const index = ordered.findIndex(item => item.id === id);

    return (
        <div className="space-y-6">
            {/* Label Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Identity</label>
                <div className="space-y-1">
                    <span className="text-[10px] text-text-faint">Header Title</span>
                    <input
                        type="text"
                        className="axiom-field axiom-field-sm w-full font-bold tracking-wider"
                        placeholder="Name..."
                        aria-label="Division heading"
                        value={lane.label || ''}
                        onChange={(e) => updateSwimlane(id, { label: e.target.value })}
                    />
                </div>
            </div>

            <AxiomPanelDivider />

            {/* Appearance Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Appearance</label>

                {/* Color Picker */}
                <div className="mb-4">
                    <span className="text-[10px] text-text-faint block mb-2">Accent Color</span>
                    <div className="flex flex-wrap gap-2">
                        {PALETTE.map(c => (
                            <button key={c.id} onClick={() => updateSwimlane(id, { color: c.id })}
                                className={`axiom-color-swatch w-6 h-6 rounded-full flex items-center justify-center ${lane.color === c.id ? 'axiom-color-swatch-active' : ''}`}
                                style={{ backgroundColor: c.hex }} title={c.label}>
                                {lane.color === c.id && <div className="w-1.5 h-1.5 rounded-full bg-text-main/50" />}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <AxiomPanelDivider />
            <section aria-label="Division actions" className="space-y-3">
                <h3 className="text-[10px] font-bold uppercase text-text-faint tracking-wider">Position</h3>
                <div className="grid grid-cols-2 gap-2">
                    <AxiomButton size="sm" className="w-full gap-2" disabled={index === 0} onClick={() => moveSwimlane(id, 'up')}>
                        {column ? <ArrowLeft size={16} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
                        {column ? 'Move left' : 'Move up'}
                    </AxiomButton>
                    <AxiomButton size="sm" className="w-full gap-2" disabled={index === ordered.length - 1} onClick={() => moveSwimlane(id, 'down')}>
                        {column ? <ArrowRight size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
                        {column ? 'Move right' : 'Move down'}
                    </AxiomButton>
                </div>
                <AxiomButton variant="danger" size="sm" className="w-full gap-2" title="Delete this division; keep its process steps" onClick={() => {
                    document.getElementById(`add-division-${laneAxis(graph, lane)}`)?.focus();
                    removeSwimlane(id); useUIStore.getState().selectSwimlane(null);
                }}><Trash2 size={16} aria-hidden="true" />Delete {column ? 'column' : 'row'}</AxiomButton>
            </section>

            {/* Meta */}
            <div className="space-y-2">
                <div className="flex justify-between text-[10px]">
                    <span className="text-text-faint">ID</span>
                    <span className="font-mono text-text-muted">{id}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                    <span className="text-text-faint">{laneAxis(graph, lane) === 'row' ? 'Height' : 'Width'}</span>
                    <span className="text-text-muted">{laneAxis(graph, lane) === 'row' ? lane.height : lane.width ?? 300}px</span>
                </div>
            </div>
        </div>
    );
}

function EdgeInspector({ id }: { id: string }) {
    const { graph, updateEdge } = useCanvasStore();
    const edge = graph.edges.find(e => e.id === id);

    if (!edge) return <div className="text-text-muted text-xs">Edge not found</div>;

    const sourceNode = graph.nodes.find(n => n.id === edge.sourceId);
    const targetNode = graph.nodes.find(n => n.id === edge.targetId);
    const hasImportedRoute = !!edge.routingPoints?.length;
    const routingMode = edge.routingMode ?? 'auto';

    const applyRoutingMode = (mode: EdgeRoutingMode) => {
        const updates: Partial<CanvasEdge> = {
            routingPoints: undefined,
            routingManual: undefined,
            routingMode: mode === 'auto' ? undefined : mode,
            routingMargin: mode === 'auto'
                ? undefined
                : (edge.routingMargin ?? DEFAULT_EDGE_ROUTING_MARGIN),
        };

        if (mode === 'auto' && sourceNode && targetNode) {
            Object.assign(updates, getSmartHandles(sourceNode, targetNode));
        } else if (mode === 'outside-right') {
            updates.sourceHandleId = 's-right';
            updates.targetHandleId = 't-right';
        } else if (mode === 'outside-left') {
            updates.sourceHandleId = 's-left';
            updates.targetHandleId = 't-left';
        } else if (mode === 'above') {
            updates.sourceHandleId = 's-top';
            updates.targetHandleId = 't-top';
        } else if (mode === 'below') {
            updates.sourceHandleId = 's-bottom';
            updates.targetHandleId = 't-bottom';
        }

        updateEdge(id, updates);
    };

    const EDGE_COLORS = [
        { label: 'Gray', value: '#52525b' },
        { label: 'White', value: '#e4e4e7' },
        { label: 'Blue', value: '#3b82f6' },
        { label: 'Gre', value: '#22c55e' },
        { label: 'Red', value: '#ef4444' },
        { label: 'Org', value: '#f97316' },
        { label: 'Amb', value: '#f59e0b' },
        { label: 'Prp', value: '#a855f7' },
    ];

    return (
        <div className="space-y-6">
            {/* Appearance Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Appearance</label>

                {/* Color Picker */}
                <div className="mb-4">
                    <span className="text-[10px] text-text-faint block mb-2">Color</span>
                    <div className="flex flex-wrap gap-2">
                        {EDGE_COLORS.map(c => (
                            <button
                                key={c.value}
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    updateEdge(id, { color: c.value });
                                }}
                                className={`axiom-color-swatch w-5 h-5 rounded-full ${edge.color === c.value ? 'axiom-color-swatch-active' : ''}`}
                                style={{ backgroundColor: c.value }}
                                title={c.label}
                            />
                        ))}
                    </div>
                </div>

                {/* Style & Type Grid */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Pattern</span>
                        <select
                            value={edge.style}
                            onChange={(e) => updateEdge(id, { style: e.target.value as any })}
                            className="axiom-field axiom-field-sm w-full appearance-none"
                        >
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Shape</span>
                        <select
                            value={edge.type || 'default'}
                            onChange={(e) => {
                                const newType = e.target.value as any;
                                updateEdge(id, { type: newType });
                                useCanvasStore.getState().setLastEdgeType(newType);
                            }}
                            className="axiom-field axiom-field-sm w-full appearance-none"
                        >
                            <option value="default">Bezier (Default)</option>
                            <option value="smoothstep">Smooth Step</option>
                            <option value="step">Step (Rigid)</option>
                            <option value="straight">Straight</option>
                        </select>
                    </div>
                </div>

                <div className="mt-4 space-y-1">
                    <span className="text-[10px] text-text-faint">Routing</span>
                    <select
                        value={hasImportedRoute ? 'imported' : routingMode}
                        onChange={(e) => applyRoutingMode(e.target.value as EdgeRoutingMode)}
                        className="axiom-field axiom-field-sm w-full appearance-none"
                    >
                        {hasImportedRoute && <option value="imported" disabled>{edge.routingManual ? 'Manual route' : 'Imported route'}</option>}
                        <option value="auto">Auto</option>
                        <option value="outside-right">Outside right</option>
                        <option value="outside-left">Outside left</option>
                        <option value="above">Above</option>
                        <option value="below">Below</option>
                    </select>
                </div>

                {!hasImportedRoute && routingMode !== 'auto' && (
                    <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-text-faint">
                            <span>Outside margin</span>
                            <span>{edge.routingMargin ?? DEFAULT_EDGE_ROUTING_MARGIN}px</span>
                        </div>
                        <input
                            type="range"
                            min={MIN_EDGE_ROUTING_MARGIN}
                            max={MAX_EDGE_ROUTING_MARGIN}
                            step={8}
                            value={edge.routingMargin ?? DEFAULT_EDGE_ROUTING_MARGIN}
                            onChange={(e) => updateEdge(id, { routingMargin: Number(e.target.value) })}
                            className="w-full accent-app-active"
                            aria-label="Outside routing margin"
                        />
                    </div>
                )}

                {hasImportedRoute && (
                    <div className="mt-3 flex flex-col items-stretch gap-2 rounded-md border border-app-border bg-app-surface p-2">
                        <span className="text-[10px] text-text-faint">{edge.routingManual ? 'Drag the segment handles on the canvas' : 'Imported connector route'}</span>
                        <AxiomButton
                            size="sm"
                            variant="ghost"
                            onClick={() => applyRoutingMode(edge.routingManual ? (edge.routingMode ?? 'auto') : 'auto')}
                        >
                            {edge.routingManual ? 'Reset automatic route' : 'Use Nemoto routing'}
                        </AxiomButton>
                    </div>
                )}

                {/* Animation Toggle */}
                <div className="mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-text-faint">Flow Animation</span>
                    <AxiomSwitch
                        checked={edge.animated ?? false}
                        label="Flow animation"
                        onCheckedChange={checked => updateEdge(id, { animated: checked })}
                    />
                </div>
            </div>

            <AxiomPanelDivider />

            {/* Label Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Identity</label>
                <div className="space-y-1 mb-4">
                    <span className="text-[10px] text-text-faint">Label</span>
                    <input
                        type="text"
                        className="axiom-field axiom-field-sm w-full"
                        placeholder="Action name..."
                        value={edge.label || ''}
                        aria-label="Label"
                        onChange={(e) => updateEdge(id, { label: e.target.value })}
                    />
                </div>
            </div>
            {/* Label Layout Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Label Layout</label>

                {/* Position Slider */}
                <div className="space-y-2 mb-4">
                    <div className="flex justify-between items-center text-[10px]">
                        <span className="text-text-faint uppercase font-semibold">Position</span>
                        <span className="text-accent-primary font-mono">{Math.round((edge.labelPosition ?? 0.5) * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={edge.labelPosition ?? 0.5}
                        onChange={(e) => updateEdge(id, { labelPosition: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-neutral-500/30 rounded-lg appearance-none cursor-pointer accent-accent-primary"
                    />
                </div>

                {/* Orientation Toggle */}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-text-faint uppercase font-semibold">Orientation</span>
                    <AxiomSegmented aria-label="Edge label orientation">
                        <AxiomSegmentedOption
                            active={(edge.labelOrientation || 'horizontal') === 'horizontal'}
                            onClick={() => updateEdge(id, { labelOrientation: 'horizontal' })}
                        >
                            Horiz
                        </AxiomSegmentedOption>
                        <AxiomSegmentedOption
                            active={edge.labelOrientation === 'vertical'}
                            onClick={() => updateEdge(id, { labelOrientation: 'vertical' })}
                        >
                            Vert
                        </AxiomSegmentedOption>
                    </AxiomSegmented>
                </div>

                <AxiomPanelDivider className="my-4" />

                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Label Styling</label>

                {/* Size Toggle */}
                <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] text-text-faint uppercase font-semibold">Size</span>
                    <AxiomSegmented aria-label="Edge label size">
                        {['sm', 'md', 'lg'].map(size => (
                            <AxiomSegmentedOption
                                active={(edge.labelSize || 'sm') === size}
                                key={size}
                                onClick={() => updateEdge(id, { labelSize: size as any })}
                            >
                                {size}
                            </AxiomSegmentedOption>
                        ))}
                    </AxiomSegmented>
                </div>

                {/* Color Picker */}
                <div>
                    <span className="text-[10px] text-text-faint uppercase font-semibold block mb-2">Color</span>
                    <div className="flex flex-wrap gap-2">
                        {/* Null/Default option */}
                        <button
                            onClick={() => updateEdge(id, { labelColor: undefined })}
                            className={`axiom-color-swatch w-5 h-5 rounded-full flex items-center justify-center ${!edge.labelColor ? 'axiom-color-swatch-active' : ''}`}
                            title="Default"
                        >
                            <span className="text-[8px] text-text-faint font-bold">X</span>
                        </button>
                        {EDGE_COLORS.map(c => (
                            <button
                                key={`text-${c.value}`}
                                onClick={() => updateEdge(id, { labelColor: c.value })}
                                className={`axiom-color-swatch w-5 h-5 rounded-full ${edge.labelColor === c.value ? 'axiom-color-swatch-active' : ''}`}
                                style={{ backgroundColor: c.value }}
                                title={c.label}
                            />
                        ))}
                    </div>
                </div>
            </div>

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Connection Info */}
            <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider block">Endpoints</label>
                <div className="axiom-panel-card p-2 space-y-1.5 opacity-70">
                    <div className="flex justify-between text-[10px]">
                        <span className="text-text-faint">From</span>
                        <span className="text-text-main font-medium truncate max-w-[120px]">{sourceNode?.label || edge.sourceId}</span>
                    </div>
                    <div className="axiom-panel-divider h-px"></div>
                    <div className="flex justify-between text-[10px]">
                        <span className="text-text-faint">To</span>
                        <span className="text-text-main font-medium truncate max-w-[120px]">{targetNode?.label || edge.targetId}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function NodeInspector({ id }: { id: string }) {
    const { graph, updateNode } = useCanvasStore();
    const { portfolio } = usePortfolioStore();
    // const { assets } = useLibraryStore(); // REMOVED: Assets are now in portfolio

    const node = graph.nodes.find(n => n.id === id);

    const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);

    if (!node) return <div className="text-text-muted text-xs p-4">Node not found</div>;

    const handleUnlinkAsset = (assetId: string) => {
        const newAssetIds = (node.assetIds || []).filter(id => id !== assetId);
        updateNode(id, { assetIds: newAssetIds });
    };

    const handleLinkAsset = (newAssetId: string) => {
        const currentAssets = node.assetIds || [];
        if (!currentAssets.includes(newAssetId)) {
            updateNode(id, { assetIds: [...currentAssets, newAssetId] });
        }
    };

    const canUseDrilldown = canOpenNodeDrilldown(node);
    const hasDrilldown = !!node.subGraphId;

    return (
        <div className="space-y-6">
            <fieldset className="space-y-2">
                <legend className="text-sm font-bold">Division</legend>
                {(['row', 'column'] as const).map(axis => <label key={axis} className="block text-xs">
                    {axis === 'row' ? 'Row' : 'Column'}
                    <select className="axiom-field w-full" aria-label={axis === 'row' ? 'Row' : 'Column'}
                        value={node[axis === 'row' ? 'rowId' : 'columnId'] ?? ''}
                        onChange={e => updateNode(id, { [axis === 'row' ? 'rowId' : 'columnId']: e.target.value || null })}>
                        <option value="">Unassigned</option>
                        {divisionLanes(graph, axis).map(lane => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
                    </select>
                </label>)}
            </fieldset>
            {/* Content Section */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-2 block">Identity</label>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Node Type</span>
                        <select
                            aria-label="Node Type"
                            className="axiom-field axiom-field-sm w-full appearance-none"
                            value={node.type}
                            onChange={(e) => {
                                const type = e.target.value as NodeType;
                                updateNode(id, {
                                    type,
                                    // Node shapes are auto-sized. A type change must not
                                    // retain the previous shape's measured dimensions.
                                    width: undefined,
                                    height: undefined,
                                    ...(type === 'event' && !node.event ? { event: createDefaultEventData() } : {}),
                                });
                            }}
                        >
                            {node.type === 'arrow' && <option value="arrow" disabled>Legacy Arrow Node</option>}
                            {node.type === 'resource' && <option value="resource" disabled>Resource Reference</option>}
                            <option value="action">Action</option>
                            <option value="decision">Decision</option>
                            <option value="start">Start</option>
                            <option value="end">End</option>
                            <option value="system">System</option>
                            <option value="event">Event</option>
                            <option value="post-it">Post-It</option>
                        </select>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Label</span>
                        <input
                            type="text"
                            className="axiom-field axiom-field-sm w-full"
                            value={node.label ?? ''}
                            aria-label="Label"
                            onChange={(e) => updateNode(id, { label: e.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Description</span>
                        <textarea
                            className="axiom-field axiom-field-sm axiom-field-textarea w-full"
                            value={(node.data?.description as string) || ''}
                            aria-label="Description"
                            placeholder="Add details about this step..."
                            onChange={(e) => updateNode(id, {
                                data: { ...node.data, description: e.target.value }
                            })}
                        ></textarea>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[10px] text-text-faint">Eyebrow Label</span>
                        <input
                            type="text"
                            className="axiom-field axiom-field-sm w-full uppercase tracking-wider"
                            value={(node.data?.eyebrow as string) || ''}
                            aria-label="Eyebrow Label"
                            placeholder="e.g. Support, Finance..."
                            onChange={(e) => updateNode(id, {
                                data: { ...node.data, eyebrow: e.target.value }
                            })}
                        />
                        <span className="text-[9px] text-text-faint opacity-60">Shown above the node as a role tag</span>
                    </div>
                </div>
            </div>

            {node.type === 'event' && (
                <>
                    <div className="axiom-panel-divider h-[1px]"></div>
                    <EventInspectorFields node={node} onChange={event => updateNode(id, { event })} />
                </>
            )}

            <div className="axiom-panel-divider h-[1px]"></div>

            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Drilldown</label>
                <button
                    type="button"
                    disabled={!canUseDrilldown}
                    onClick={() => openOrCreateNodeDrilldown(id, graph)}
                    className={`axiom-panel-card w-full flex items-center justify-between px-3 py-2 text-xs font-semibold transition-colors
                        ${canUseDrilldown
                            ? 'text-text-main hover:border-accent-primary hover:text-accent-primary'
                            : 'text-text-faint cursor-not-allowed opacity-60'
                        }`}
                    title={canUseDrilldown ? 'Open or create a child graph for this node' : 'Drilldown is available for flow nodes'}
                >
                    <span className="flex items-center gap-2">
                        <Layers size={14} />
                        {hasDrilldown ? 'Open Drilldown' : 'Create Drilldown'}
                    </span>
                    <span className="text-[10px] text-text-faint">{hasDrilldown ? 'Linked' : 'Empty'}</span>
                </button>
                <p className="mt-2 text-[10px] text-text-faint leading-relaxed">
                    Adds a child graph to this node. You can also use Alt + double click or the node context menu.
                </p>
            </div>

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Appearance Section - Now available for all nodes */}
            <div>
                <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Appearance</label>

                {/* Color Picker (Universal) */}
                <div>
                    <span className="text-[10px] text-text-faint block mb-2">Theme Color</span>
                    <div className="flex flex-wrap gap-2">
                        {PALETTE.map(c => (
                            <button
                                key={c.id}
                                onClick={() => {
                                    updateNode(id, { data: { ...node.data, color: c.id } });
                                }}
                                className={`axiom-color-swatch w-6 h-6 rounded-full flex items-center justify-center
                                    ${(node.data?.color || 'default') === c.id
                                        ? 'axiom-color-swatch-active' : ''}
                                `}
                                style={{ backgroundColor: c.hex }}
                                title={c.label}
                            >
                                {/* Active Dot */}
                                {(node.data?.color || 'default') === c.id &&
                                    <div className="w-1.5 h-1.5 rounded-full bg-text-main/50" />
                                }
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Legacy rotation section for imported arrow nodes */}
            {node.type === 'arrow' && (
                <div>
                    <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider mb-3 block">Legacy Orientation</label>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center text-[10px]">
                            <span className="text-text-faint uppercase font-semibold">Rotation Angle</span>
                            <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    className="axiom-field axiom-field-xs w-12 text-accent-primary font-mono text-center"
                                    value={Math.round((node.data?.rotation as number) || 0)}
                                    onChange={(e) => {
                                        let val = parseInt(e.target.value) || 0;
                                        val = ((val % 360) + 360) % 360; // Normalize 0-359
                                        updateNode(id, { data: { ...node.data, rotation: val } });
                                    }}
                                />
                                <span className="text-text-faint">°</span>
                            </div>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="359"
                            step="1"
                            value={(node.data?.rotation as number) || 0}
                            onChange={(e) => updateNode(id, { data: { ...node.data, rotation: parseInt(e.target.value) } })}
                            className="w-full h-1 bg-neutral-500/30 rounded-lg appearance-none cursor-pointer accent-accent-primary"
                        />
                        <div className="flex justify-between mt-1">
                            {[0, 90, 180, 270].map(angle => (
                                <button
                                    key={angle}
                                    onClick={() => updateNode(id, { data: { ...node.data, rotation: angle } })}
                                    className="axiom-button axiom-button-sm axiom-button-ghost text-[9px] text-text-faint hover:text-accent-primary px-1.5 py-0.5"
                                >
                                    {angle}°
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="axiom-panel-divider h-[1px] mt-6"></div>
                </div>
            )}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="text-[10px] font-bold uppercase text-text-faint tracking-wider">Linked Resources</label>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-text-faint">{(node.assetIds || []).length}</span>
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                setIsAssetPickerOpen(true);
                            }}
                            className="axiom-panel-icon-button axiom-icon-button-sm"
                            title="Search and Link Resource"
                        >
                            <Plus size={12} />
                        </button>
                    </div>
                </div>

                {isAssetPickerOpen && (
                    <EntityPickerModal
                        allowedTypes={['asset']}
                        onClose={() => setIsAssetPickerOpen(false)}
                        onSelect={(ref) => handleLinkAsset(ref.id)}
                    />
                )}

                <div className="space-y-2">
                    {(node.assetIds || []).length > 0 ? (
                        (node.assetIds || []).map((assetId) => {
                            // Merge assets from LibraryStore into portfolio for resolution
                            // const portfolioWithAssets = { ...portfolio, assets }; // REMOVED: redundant
                            const portfolioWithAssets = portfolio;
                            const resolved = resolveEntity(assetId, 'asset', portfolioWithAssets);

                            // Fallback if resolution fails
                            if (!resolved) {
                                return (
                                    <div
                                        key={assetId}
                                        className="axiom-panel-card axiom-panel-card-danger p-2.5 flex items-start gap-3"
                                    >
                                        <div className="mt-0.5 w-7 h-7 rounded bg-accent-danger/10 flex items-center justify-center border border-accent-danger/20">
                                            <Server size={14} className="text-accent-danger" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium text-accent-danger">Unknown Resource</div>
                                            <div className="text-[10px] text-text-muted mt-0.5 font-mono">{assetId}</div>
                                        </div>
                                        <button
                                            onClick={() => handleUnlinkAsset(assetId)}
                                            className="axiom-panel-icon-button axiom-icon-button-sm axiom-panel-icon-button-danger"
                                            title="Unlink broken resource"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                );
                            }

                            // Get icon component
                            const IconComponent = getIconComponent(resolved.icon);

                            // Get color from palette
                            const colorData = PALETTE.find(p => p.id === resolved.color);
                            const colorHex = colorData?.hex || '#a855f7'; // Fallback to purple

                            return (
                                <div
                                    key={assetId}
                                    className="axiom-panel-card p-2.5 flex items-start gap-3 group hover:border-accent-primary/50 transition-colors"
                                >
                                    <div
                                        className="mt-0.5 w-7 h-7 rounded flex items-center justify-center border"
                                        style={{
                                            backgroundColor: `${colorHex}15`,
                                            borderColor: `${colorHex}30`
                                        }}
                                    >
                                        <IconComponent size={14} style={{ color: colorHex }} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-text-main">{resolved.displayName}</div>
                                        {resolved.subtitle && (
                                            <div className="text-[10px] text-text-muted mt-0.5">{resolved.subtitle}</div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleUnlinkAsset(assetId)}
                                        className="axiom-panel-icon-button axiom-icon-button-sm axiom-panel-icon-button-danger opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Unlink resource"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            );
                        })
                    ) : (
                        <div className="text-[10px] text-text-faint italic p-4 border border-dashed border-app-border rounded text-center">
                            No resources linked. Drag a resource here or use the search to link.
                        </div>
                    )}
                </div>
            </div>

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Linked Notes Section */}
            <LinkedNotes entityId={id} entityType="node" name={node.label ?? ''} />

            <div className="axiom-panel-divider h-[1px]"></div>

            {/* Meta */}
            <div className="space-y-2">
                <div className="flex justify-between text-[10px]">
                    <span className="text-text-faint">ID</span>
                    <span className="font-mono text-text-muted">{id}</span>
                </div>
            </div>
        </div >
    );
}
