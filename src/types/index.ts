import type {
    ThemeBranding,
    ThemeEmbeddedAsset,
    ThemePresetId,
    ThemeRecipes,
    ThemeTokenMap,
    ThemeTypography,
} from '../theme/themeContract';
import type { PortfolioPluginState } from '../plugins/portfolioData';
import type { JournalData } from './journal';

// --- PROJECT TYPES ---

export interface ProjectMeta {
    version: string;
    title: string;
    author?: string;
    createdAt: string;
    updatedAt: string;
}

export type AssetBaseType = 'role' | 'system' | 'document' | 'location' | 'hardware' | 'tool' | 'process' | 'custom';
export type AssetType = string; // Links to AssetCategory.id

export interface AssetCategory {
    id: string;
    label: string;
    icon: string; // Lucide icon name
    color: string; // Palette color id
    baseType?: AssetBaseType; // NEW: The semantic bridge
    extensions?: Record<string, unknown>;
}

export interface Asset {
    id: string;
    name: string;
    type: AssetType; // Links to AssetCategory.id
    parentId?: string | null;
    metadata?: Record<string, unknown> | null;
    extensions?: Record<string, unknown>;
}

export interface Finding {
    id: string;
    timestamp: string;
    text: string;
    linkedNodeIds: string[];
    extensions?: Record<string, unknown>;
}

export interface Incident {
    id: string;
    title: string;
    createdAt: string;
    findings: Finding[];
    extensions?: Record<string, unknown>;
}

// --- GRAPH TYPES ---

export interface Position { x: number; y: number; }

export type ActiveNodeType = 'start' | 'end' | 'action' | 'decision' | 'system' | 'swimlane' | 'group' | 'post-it' | 'resource' | 'event';
/** Retained special node types that still have first-class renderers. */
export type LegacyNodeType = 'arrow';
export type NodeType = ActiveNodeType | LegacyNodeType;
export type EdgeRoutingMode = 'auto' | 'outside-right' | 'outside-left' | 'above' | 'below';

export type EventDatePrecision = 'year' | 'month' | 'day';
export type EventKind = 'generic' | 'message' | 'signal' | 'condition' | 'timer' | 'error' | 'milestone';
export type EventBehavior = 'observed' | 'emitted' | 'neutral';

export interface EventDateValue extends Record<string, unknown> {
    kind: 'date';
    /** Lexical date value matching precision: YYYY, YYYY-MM, or YYYY-MM-DD. */
    value: string;
    precision: EventDatePrecision;
    extensions?: Record<string, unknown>;
}

export interface EventDateTimeValue extends Record<string, unknown> {
    kind: 'datetime';
    /** RFC 3339 instant with an explicit UTC designator or numeric offset. */
    value: string;
    /** Optional IANA zone used to reproduce the intended local presentation. */
    timeZone?: string | null;
    extensions?: Record<string, unknown>;
}

export type EventTemporalValue = EventDateValue | EventDateTimeValue;

/** Optional temporal facet. Timing never defines the Event's process meaning. */
export interface EventTiming extends Record<string, unknown> {
    start?: EventTemporalValue | null;
    end?: EventTemporalValue | null;
    /** True only for day-precision date values. Interval endpoints are inclusive. */
    allDay?: boolean;
    extensions?: Record<string, unknown>;
}

/** Core-owned semantic payload for process Event nodes. */
export interface EventData extends Record<string, unknown> {
    /** What occurred, was observed, was received, or became true. */
    kind: EventKind;
    /** The process's relationship to the occurrence. */
    behavior?: EventBehavior;
    timing?: EventTiming | null;
    metadata?: Record<string, unknown> | null;
    extensions?: Record<string, unknown>;
}

export interface CanvasNode {
    id: string;
    type: NodeType;
    label: string | null;
    position: Position;
    width?: number | null;
    height?: number | null;
    parentId?: string | null;
    data?: Record<string, unknown> | null;
    swimlaneId?: string | null;
    rowId?: string | null;
    columnId?: string | null;
    assetIds?: string[] | null;
    subGraphId?: string | null; // Flattened Drill-down: Reference to Process.subGraphs
    event?: EventData | null;
    selected?: boolean;
    extensions?: Record<string, unknown>;
}

export interface CanvasEdge {
    id: string;
    sourceId: string;
    targetId: string;
    sourceHandleId?: string;
    targetHandleId?: string;
    style: 'solid' | 'dashed' | 'dotted';
    type?: 'default' | 'step' | 'smoothstep' | 'straight';
    label?: string;
    labelPosition?: number; // 0 to 1, default 0.5
    labelOrientation?: 'horizontal' | 'vertical';
    labelSize?: 'sm' | 'md' | 'lg';
    labelColor?: string;
    color?: string;
    strokeWidth?: number;
    animated?: boolean;
    /** Optional absolute canvas points used to preserve imported connector routing. */
    routingPoints?: Position[] | null;
    /** User-edited orthogonal bends; endpoint leads follow moved nodes. */
    routingManual?: boolean;
    /** Semantic Nemoto route that is recalculated when canvas nodes move. */
    routingMode?: EdgeRoutingMode | null;
    /** Distance in canvas pixels between an outside route and the outermost node. */
    routingMargin?: number | null;
    selected?: boolean;
    extensions?: Record<string, unknown>;
}

export interface Swimlane {
    axis?: 'row' | 'column';
    id: string;
    label: string;
    color: string;
    order: number;
    height: number;
    width?: number; // Added for Vertical Swimlanes
    extensions?: Record<string, unknown>;
}

export interface CanvasGraph {
    /** Versioned, independent display settings. Absence denotes a legacy graph. */
    division?: { version: 1; rowsVisible: boolean; columnsVisible: boolean };
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    swimlanes: Swimlane[];
    mode?: CanvasMode;
    viewport?: { x: number; y: number; zoom: number };
    extensions?: Record<string, unknown>;
}

// --- LEGACY ROOT (for backwards compatibility) ---

export interface NemotoProject {
    meta: ProjectMeta;
    assets: Asset[];
    graph: CanvasGraph;
    incidents: Incident[];
}

// --- PORTFOLIO TYPES (NEW) ---

export interface ProcessFolder {
    id: string;
    title: string;
    parentId?: string | null; // For nested folders
    createdAt?: string;
    extensions?: Record<string, unknown>;
}

export interface Process {
    id: string;
    title: string;
    description?: string | null;
    ownerId?: string | null;
    metaSettings?: {
        showOwnerInCanvas?: boolean;
        showDescriptionInCanvas?: boolean;
    } | null;
    createdAt: string;
    updatedAt: string;
    graph: CanvasGraph;
    subGraphs?: Record<string, CanvasGraph> | null; // Map of subGraphId -> CanvasGraph for flattened drill-down
    folderId?: string | null; // Reference to ProcessFolder.id
    mode: CanvasMode;
    extensions?: Record<string, unknown>;
}

export type CanvasMode = 'swimlane' | 'swimlane-vertical' | 'blank';

export interface ThemeConfig {
    id: string;
    label: string;
    basePresetId?: ThemePresetId | null; // Initial baseline only; custom themes may diverge fully.
    colors: ThemeTokenMap; // Legacy internal name for theme tokens.
    tokens?: ThemeTokenMap; // Shareable-file name; kept in sync with colors during import/export.
    brand?: ThemeBranding;
    typography?: ThemeTypography;
    assets?: Record<string, ThemeEmbeddedAsset>;
    recipes?: ThemeRecipes;
    extensions?: Record<string, unknown>;
    /**
     * Lossless portable document backing an installed theme. Runtime consumers
     * use the projected fields above; file I/O patches known paths here so
     * fields from newer Nemoto/plugin versions are not discarded.
     */
    sourceDocument?: Record<string, unknown>;
}

export interface Portfolio {
    /** Explicit data-contract version. Legacy files may only contain `version`. */
    schemaVersion?: number;
    version: string;
    lastModified: string;
    lastBackup?: string;
    processes: Process[];
    processFolders: ProcessFolder[]; // Folder structure for processes
    assets: Asset[];
    assetCategories: AssetCategory[]; // New dynamic categories
    incidents: Incident[]; // Legacy: To be deprecated
    journal: JournalData; // NEW: The Journal
    customThemes?: ThemeConfig[] | null; // User-created custom themes
    activeThemeId?: string | null;      // ID of active custom theme
    /** Portfolio-local activation metadata and host-understood semantic plugin data. */
    plugins?: PortfolioPluginState;
    /** Namespaced, portable data owned by future plugins. */
    extensions?: Record<string, unknown>;
}

export interface ImportedPortfolio {
    id: string;
    sourceName: string;
    importedAt: string;
    data: Portfolio;
    isReadOnly: true;
}

export interface ExportOptions {
    processIds: string[];
    assetIds: string[];
    incidentIds: string[];
}

export interface ImportOptions {
    target: string; // "main" or temp portfolio name
    processIds: string[];
    assetIds: string[];
    incidentIds: string[];
}

export interface ProcessPreview {
    id: string;
    title: string;
    nodeCount: number;
}

export interface AssetPreview {
    id: string;
    name: string;
}

export interface IncidentPreview {
    id: string;
    title: string;
    findingCount: number;
}

export interface ImportPreview {
    processes: ProcessPreview[];
    assets: AssetPreview[];
    incidents: IncidentPreview[];
}

// --- CONFIG ---

export interface AppConfig {
    activeTheme: string;
    uiScale: number;
    locale?: string;
    autoSaveInterval: number;
    lastBackup?: string;
    activeTempPortfolio?: string;
}

// --- IMPORT / MERGE TYPES ---

export type MergeStrategy = 'keep_existing' | 'overwrite' | 'keep_both';

export interface ImportConflict {
    id: string;
    type: 'process' | 'asset' | 'folder';
    title: string;
    existingDate: string;
    incomingDate: string;
}


