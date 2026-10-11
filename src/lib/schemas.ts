import { z } from 'zod';
import { PortfolioPluginStateSchema } from '../plugins/portfolioData';
import {
    JOURNAL_CONTENT_FORMAT,
    JOURNAL_CONTENT_VERSION,
    normalizeJournalContent,
} from './journalContent';
import { getEventTimingValidationMessage, getEventValidationMessage } from './events';

// Basic Types
export const PositionSchema = z.object({
    x: z.number(),
    y: z.number()
});

export const NodeTypeSchema = z.enum([
    // Every accepted type must have a first-class editor and viewer renderer.
    'start', 'end', 'action', 'decision', 'system',
    'swimlane', 'group', 'post-it', 'arrow', 'resource', 'event'
]);

export const EventDateValueSchema = z.object({
    kind: z.literal('date'),
    value: z.string(),
    precision: z.enum(['year', 'month', 'day']),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const EventDateTimeValueSchema = z.object({
    kind: z.literal('datetime'),
    value: z.string(),
    timeZone: z.string().nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const EventTemporalValueSchema = z.discriminatedUnion('kind', [
    EventDateValueSchema,
    EventDateTimeValueSchema,
]);

export const EventTimingSchema = z.object({
    start: EventTemporalValueSchema.nullable().optional(),
    end: EventTemporalValueSchema.nullable().optional(),
    allDay: z.boolean().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((timing, context) => {
    const message = getEventTimingValidationMessage(timing);
    if (message) context.addIssue({ code: 'custom', message });
});

export const EventDataSchema = z.object({
    kind: z.enum(['generic', 'message', 'signal', 'condition', 'timer', 'error', 'milestone']).default('generic'),
    behavior: z.enum(['observed', 'emitted', 'neutral']).default('neutral'),
    timing: EventTimingSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((event, context) => {
    const message = getEventValidationMessage(event);
    if (message) context.addIssue({ code: 'custom', message });
});

export const EdgeTypeSchema = z.enum(['default', 'step', 'smoothstep', 'straight']);

// Assets
export const AssetCategorySchema = z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string(),
    color: z.string(),
    baseType: z.enum(['role', 'system', 'document', 'location', 'hardware', 'tool', 'process', 'custom']).default('custom'),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const AssetSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(), // Links to AssetCategory.id
    parentId: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

// Graph Elements
// Graph Elements (Circular Dependency Handling)

export const CanvasEdgeSchema = z.object({
    id: z.string(),
    sourceId: z.string(),
    targetId: z.string(),
    sourceHandleId: z.string().nullable().optional(),
    targetHandleId: z.string().nullable().optional(),
    style: z.enum(['solid', 'dashed', 'dotted', 'error']).nullable().optional().default('solid'),
    type: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    labelPosition: z.number().nullable().optional(),
    labelOrientation: z.string().nullable().optional(),
    labelSize: z.string().nullable().optional(),
    labelColor: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    strokeWidth: z.number().nullable().optional(),
    animated: z.boolean().nullable().optional(),
    routingPoints: z.array(PositionSchema).nullable().optional(),
    routingManual: z.boolean().optional(),
    routingMode: z.enum(['auto', 'outside-right', 'outside-left', 'above', 'below']).nullable().optional(),
    routingMargin: z.number().finite().nonnegative().nullable().optional(),
    selected: z.boolean().nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const SwimlaneSchema = z.object({
    axis: z.enum(['row', 'column']).optional(),
    id: z.string(),
    label: z.string(),
    color: z.string(),
    order: z.number(),
    height: z.number(),
    width: z.number().nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().superRefine((lane, context) => {
    if (lane.axis && (lane.axis === 'row' ? lane.height : lane.width ?? 300) <= 0) {
        context.addIssue({ code: 'custom', message: 'Division size must be positive.' });
    }
});

// Define Base Node Schema first (without children) to avoid eager evaluation issues
// Define Base Node Schema first (without children) to avoid eager evaluation issues
const BaseNodeSchema = z.object({
    id: z.string(),
    type: NodeTypeSchema,
    label: z.string().nullable().optional(),
    position: PositionSchema,
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    parentId: z.string().nullable().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    swimlaneId: z.string().nullable().optional(),
    rowId: z.string().nullable().optional(),
    columnId: z.string().nullable().optional(),
    assetIds: z.array(z.string()).nullable().optional(),
    event: EventDataSchema.nullable().optional(),
    selected: z.boolean().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

// Recursive Graph Schema
export const CanvasGraphSchema: z.ZodType<any> = z.lazy(() => z.object({
    nodes: z.array(z.lazy(() => CanvasNodeSchema)).nullable().optional(), // Wrapped in z.lazy
    edges: z.array(CanvasEdgeSchema).nullable().optional(),
    swimlanes: z.array(SwimlaneSchema).nullable().optional(),
    division: z.object({ version: z.literal(1), rowsVisible: z.boolean(), columnsVisible: z.boolean() }).optional(),
    mode: z.enum(['swimlane', 'swimlane-vertical', 'blank']).nullable().optional(),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough());

// Node Schema with Recursive Children
export const CanvasNodeSchema = BaseNodeSchema.extend({
    children: z.lazy(() => CanvasGraphSchema).nullable().optional(),
    subGraphId: z.string().nullable().optional()
});

// Process
export const ProcessSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    ownerId: z.string().nullable().optional(),
    metaSettings: z.object({
        showOwnerInCanvas: z.boolean().optional(),
        showDescriptionInCanvas: z.boolean().optional(),
    }).nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    graph: CanvasGraphSchema,
    subGraphs: z.record(z.string(), CanvasGraphSchema).nullable().optional(),
    folderId: z.string().nullable().optional(),
    mode: z.enum(['swimlane', 'swimlane-vertical', 'blank']).nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const ProcessFolderSchema = z.preprocess((val: any) => {
    // Alias 'name' to 'title' if 'title' is missing
    if (val && typeof val === 'object' && !val.title && val.name) {
        return { ...val, title: val.name };
    }
    return val;
}, z.object({
    id: z.string(),
    title: z.string(),
    parentId: z.string().nullable().optional(), // Allow null
    createdAt: z.string().nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough());

// Journal
// Journal
export const JournalFolderSchema = z.object({
    id: z.string(),
    title: z.string(),
    parentId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const JournalNotebookSchema = z.object({
    id: z.string(),
    title: z.string(),
    folderId: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const JournalTagSchema = z.object({
    id: z.string(),
    label: z.string(),
    color: z.string(),
    archived: z.boolean().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const EntityReferenceSchema = z.object({
    id: z.string(),
    // Legacy Rust/Quill imports may carry "unknown", "resource", or
    // "subprocess" here. migratePortfolio resolves them against real data.
    type: z.string(),
    processId: z.string().optional(),
    path: z.array(z.string()).optional(),
    source: z.enum(['inline', 'manual']).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const JournalEntrySchema = z.object({
    id: z.string(),
    notebookId: z.string().default(''),
    title: z.string().default('Untitled Note'),
    content: z.preprocess(normalizeJournalContent, z.string()).default(''),
    contentFormat: z.literal(JOURNAL_CONTENT_FORMAT).default(JOURNAL_CONTENT_FORMAT),
    contentVersion: z.number().int().positive().default(JOURNAL_CONTENT_VERSION),
    tags: z.array(z.string()).nullable().default([]),
    // Migration enriches legacy references with process/path metadata after
    // the full portfolio is available for deterministic lookup.
    linkedContext: z.array(z.union([EntityReferenceSchema, z.string()])).nullable().default([]),
    sharePolicy: z.enum(['shareable', 'internal']).default('shareable'),
    createdAt: z.string(),
    updatedAt: z.string()
}).passthrough();

export const JournalDataSchema = z.object({
    notebooks: z.array(JournalNotebookSchema).default([]),
    folders: z.array(JournalFolderSchema).default([]),
    entries: z.array(JournalEntrySchema).default([]),
    tags: z.array(JournalTagSchema).default([]),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough().default({
    notebooks: [],
    folders: [],
    entries: [],
    tags: []
});

// Incidents (Legacy)
export const FindingSchema = z.object({
    id: z.string(),
    timestamp: z.string(),
    text: z.string(),
    linkedNodeIds: z.array(z.string()).default([]),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const IncidentSchema = z.object({
    id: z.string(),
    title: z.string(),
    createdAt: z.string(),
    findings: z.array(FindingSchema),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const ThemeConfigSchema = z.object({
    id: z.string(),
    label: z.string(),
    basePresetId: z.union([z.literal('void'), z.literal('polar'), z.literal('brutalist')]).nullable().optional(),
    colors: z.record(z.string(), z.string()),
    tokens: z.record(z.string(), z.string()).optional(),
    brand: z.object({
        logoUrl: z.string().optional(),
        logoAssetId: z.string().optional(),
        displayName: z.string().optional(),
        fontFamily: z.string().optional(),
    }).passthrough().optional(),
    typography: z.object({
        fontFamily: z.string().optional(),
        regularAssetId: z.string().optional(),
        mediumAssetId: z.string().optional(),
        boldAssetId: z.string().optional(),
    }).passthrough().optional(),
    assets: z.record(z.string(), z.object({
        mediaType: z.union([z.literal('image/png'), z.literal('image/webp'), z.literal('font/woff2')]),
        data: z.string(),
        sha256: z.string(),
    }).passthrough()).optional(),
    recipes: z.record(z.string(), z.unknown()).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

// Portfolio - Wrapped in preprocess to handle legacy/variant formats
export const PortfolioSchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        const normalized = { ...val };
        // Map sourceVersion to version if version is missing (from HTML exports)
        if (!normalized.version && normalized.sourceVersion) {
            normalized.version = normalized.sourceVersion.replace(/^(?:AXIOM|NEMOTO)\s+v?/i, '');
        }

        // Ensure lastModified is a string if missing
        if (!normalized.lastModified && normalized.exportedAt) {
            normalized.lastModified = normalized.exportedAt;
        }

        // Relax asset and journal nullability
        if (normalized.assets === null) normalized.assets = [];
        if (normalized.journal === null) delete normalized.journal;
        return normalized;
    }
    return val;
}, z.object({
    schemaVersion: z.number().int().nonnegative().optional(),
    version: z.string(),
    lastModified: z.string().nullable().optional(), // Allow missing/null
    lastBackup: z.string().nullable().optional(),
    processes: z.array(ProcessSchema).default([]),
    processFolders: z.array(ProcessFolderSchema).default([]),
    assets: z.array(AssetSchema).nullable().optional().default([]), // Allow null array
    assetCategories: z.array(AssetCategorySchema).nullable().optional().default([]),
    incidents: z.array(IncidentSchema).nullable().optional().default([]),
    journal: z.preprocess(value => value === null ? undefined : value, JournalDataSchema),
    customThemes: z.array(ThemeConfigSchema).nullable().optional().default([]),
    activeThemeId: z.string().nullable().optional(),
    plugins: PortfolioPluginStateSchema.optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
}).passthrough());

export type ParsedPortfolio = z.infer<typeof PortfolioSchema>;
