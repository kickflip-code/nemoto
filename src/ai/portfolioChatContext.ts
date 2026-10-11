import { z } from 'zod';
import { findNodeLocationInProcess } from '../lib/entityResolver';
import type { CanvasGraph, Portfolio, Process } from '../types';
import { JsonObjectSchema } from '../plugins/semanticData';
import {
    UniversalEntityReferenceSchema,
    coreEntityReference,
} from '../plugins/universalReference';

export const CURRENT_PORTFOLIO_CHAT_CONTEXT_SCHEMA_VERSION = 1;
export const DEFAULT_PORTFOLIO_CHAT_MAX_CHARACTERS = 60_000;
export const DEFAULT_PORTFOLIO_CHAT_MAX_SOURCES = 150;

export const PortfolioChatSourceSchema = z.object({
    sourceId: z.string().trim().min(1).max(300),
    category: z.enum([
        'process',
        'process-folder',
        'node',
        'edge',
        'swimlane',
        'asset',
        'asset-category',
        'linked-note',
        'journal-entry',
        'journal-notebook',
        'journal-folder',
        'tag',
        'incident',
        'finding',
        'semantic-record',
        'semantic-relation',
        'semantic-annotation',
    ]),
    label: z.string().trim().min(1).max(500),
    reference: UniversalEntityReferenceSchema,
    data: JsonObjectSchema,
}).strict();

export const PortfolioChatContextProjectionSchema = z.object({
    schema: z.literal('axiom.portfolio-chat-context'),
    schemaVersion: z.literal(CURRENT_PORTFOLIO_CHAT_CONTEXT_SCHEMA_VERSION),
    projection: z.literal('core-portfolio-chat'),
    projectionVersion: z.literal(1),
    scope: z.enum(['current-process', 'selected-item', 'portfolio-retrieval']),
    baseRevision: z.string().trim().min(1).max(240),
    processId: z.string().trim().min(1).max(240).nullable(),
    selectionSourceId: z.string().trim().min(1).max(300),
    sources: z.array(PortfolioChatSourceSchema).min(1).max(DEFAULT_PORTFOLIO_CHAT_MAX_SOURCES),
    limits: z.object({
        maximumCharacters: z.number().int().positive(),
        maximumSources: z.number().int().positive(),
        includedCharacters: z.number().int().nonnegative(),
        omittedSources: z.number().int().nonnegative(),
        truncated: z.boolean(),
    }).strict(),
    retrieval: z.object({
        strategy: z.literal('lexical-v1'),
        indexedSourceCount: z.number().int().positive(),
        matchedSourceCount: z.number().int().nonnegative(),
        returnedSourceCount: z.number().int().positive(),
        primarySourceIds: z.array(z.string().trim().min(1).max(300)).max(50),
        expandedSourceIds: z.array(z.string().trim().min(1).max(300)).max(100),
        fallbackUsed: z.boolean(),
    }).strict().optional(),
}).strict().superRefine((context, refinement) => {
    const sourceIds = new Set<string>();
    context.sources.forEach((source, index) => {
        if (sourceIds.has(source.sourceId)) {
            refinement.addIssue({
                code: 'custom',
                path: ['sources', index, 'sourceId'],
                message: `Duplicate Portfolio Chat source ID: ${source.sourceId}.`,
            });
        }
        sourceIds.add(source.sourceId);
    });
    if (!sourceIds.has(context.selectionSourceId)) {
        refinement.addIssue({
            code: 'custom',
            path: ['selectionSourceId'],
            message: 'The selected source must be present in the supplied source set.',
        });
    }
    if (context.scope === 'portfolio-retrieval' && !context.retrieval) {
        refinement.addIssue({
            code: 'custom',
            path: ['retrieval'],
            message: 'Portfolio retrieval context requires a retrieval receipt.',
        });
    }
    if (context.scope !== 'portfolio-retrieval' && context.retrieval) {
        refinement.addIssue({
            code: 'custom',
            path: ['retrieval'],
            message: 'Scoped process context cannot contain a portfolio retrieval receipt.',
        });
    }
    if (context.retrieval) {
        if (context.retrieval.returnedSourceCount !== context.sources.length) {
            refinement.addIssue({
                code: 'custom',
                path: ['retrieval', 'returnedSourceCount'],
                message: 'The retrieval receipt must report the exact supplied source count.',
            });
        }
        if (context.retrieval.indexedSourceCount < context.retrieval.returnedSourceCount
            || context.retrieval.matchedSourceCount > context.retrieval.indexedSourceCount) {
            refinement.addIssue({
                code: 'custom',
                path: ['retrieval'],
                message: 'Retrieval counts must be consistent with the index and supplied source set.',
            });
        }
        const receiptIds = [
            ...context.retrieval.primarySourceIds,
            ...context.retrieval.expandedSourceIds,
        ];
        const uniqueReceiptIds = new Set(receiptIds);
        if (uniqueReceiptIds.size !== receiptIds.length
            || receiptIds.some(sourceId => !sourceIds.has(sourceId))) {
            refinement.addIssue({
                code: 'custom',
                path: ['retrieval'],
                message: 'Retrieval receipt source IDs must be unique members of the supplied source set.',
            });
        }
    }
});

export type PortfolioChatSource = z.infer<typeof PortfolioChatSourceSchema>;
export type PortfolioChatContextProjection = z.infer<typeof PortfolioChatContextProjectionSchema>;
export type PortfolioChatSelection = Readonly<{
    kind: 'asset' | 'node';
    id: string;
}>;

export interface PortfolioChatContextOptions {
    maximumCharacters?: number;
    maximumSources?: number;
}

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const decodeBasicHtmlEntities = (value: string): string => value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const notePlainText = (content: string): string => decodeBasicHtmlEntities(content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6_000);

const graphLocationKey = (path: readonly string[]): string => path.length > 0
    ? path.join('>')
    : 'root';

const safeData = (value: unknown): z.infer<typeof JsonObjectSchema> | undefined => {
    const parsed = JsonObjectSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
};

interface ProcessGraphSourceResult {
    sources: PortfolioChatSource[];
    referencedAssetIds: Set<string>;
    includedNodeIds: Set<string>;
}

const createGraphSources = (process: Process): ProcessGraphSourceResult => {
    const sources: PortfolioChatSource[] = [];
    const referencedAssetIds = new Set<string>();
    const includedNodeIds = new Set<string>();
    const visitedSubGraphs = new Set<string>();

    const visit = (graph: CanvasGraph, path: string[]) => {
        const locationKey = graphLocationKey(path);
        graph.nodes.forEach(node => {
            includedNodeIds.add(node.id);
            node.assetIds?.forEach(assetId => referencedAssetIds.add(assetId));
            const nodeData = safeData(node.data);
            sources.push({
                sourceId: `node:${process.id}:${locationKey}:${node.id}`,
                category: 'node',
                label: node.label || 'Untitled node',
                reference: coreEntityReference('core.node', node.id, {
                    processId: process.id,
                    graphPath: path,
                }),
                data: {
                    label: node.label || 'Untitled node',
                    nodeType: node.type,
                    processId: process.id,
                    processTitle: process.title,
                    graphPath: [...path],
                    relatedAssetIds: [...(node.assetIds || [])],
                    ...(nodeData ? { details: nodeData } : {}),
                },
            });

            if (node.subGraphId && process.subGraphs?.[node.subGraphId]
                && !visitedSubGraphs.has(node.subGraphId)) {
                visitedSubGraphs.add(node.subGraphId);
                visit(process.subGraphs[node.subGraphId], [...path, node.id]);
            }
        });

        graph.edges.forEach(edge => sources.push({
            sourceId: `edge:${process.id}:${locationKey}:${edge.id}`,
            category: 'edge',
            label: edge.label || `${edge.sourceId} to ${edge.targetId}`,
            reference: coreEntityReference('core.edge', edge.id, {
                processId: process.id,
                graphPath: path,
            }),
            data: {
                label: edge.label || '',
                sourceNodeId: edge.sourceId,
                targetNodeId: edge.targetId,
                style: edge.style,
                graphPath: [...path],
            },
        }));

        graph.swimlanes.forEach(swimlane => sources.push({
            sourceId: `swimlane:${process.id}:${locationKey}:${swimlane.id}`,
            category: 'swimlane',
            label: swimlane.label,
            reference: coreEntityReference('core.swimlane', swimlane.id, {
                processId: process.id,
                graphPath: path,
            }),
            data: {
                label: swimlane.label,
                order: swimlane.order,
                graphPath: [...path],
            },
        }));
    };

    visit(process.graph, []);
    if (process.ownerId) referencedAssetIds.add(process.ownerId);
    return { sources, referencedAssetIds, includedNodeIds };
};

/**
 * Builds the bounded, copied context used by Core Portfolio Chat. The model
 * never receives a live portfolio or store reference.
 */
export function createPortfolioChatContextProjection(
    portfolio: Portfolio,
    processId: string,
    baseRevision: string,
    selection?: PortfolioChatSelection | null,
    options: PortfolioChatContextOptions = {},
): PortfolioChatContextProjection | null {
    const process = portfolio.processes.find(candidate => candidate.id === processId);
    if (!process) return null;

    const graphResult = createGraphSources(process);
    const referencedAssetIds = graphResult.referencedAssetIds;
    if (selection?.kind === 'asset') referencedAssetIds.add(selection.id);

    const processSource: PortfolioChatSource = {
        sourceId: `process:${process.id}`,
        category: 'process',
        label: process.title,
        reference: coreEntityReference('core.process', process.id),
        data: {
            title: process.title,
            description: process.description || '',
            ownerId: process.ownerId || '',
            mode: process.mode,
            nodeCount: graphResult.includedNodeIds.size,
        },
    };

    const assetSources = portfolio.assets
        .filter(asset => referencedAssetIds.has(asset.id))
        .map((asset): PortfolioChatSource => {
            const category = portfolio.assetCategories.find(candidate => candidate.id === asset.type);
            const metadata = safeData(asset.metadata);
            return {
                sourceId: `asset:${asset.id}`,
                category: 'asset',
                label: asset.name,
                reference: coreEntityReference('core.asset', asset.id),
                data: {
                    name: asset.name,
                    category: category?.label || asset.type,
                    baseType: category?.baseType || 'custom',
                    ...(metadata ? { metadata } : {}),
                },
            };
        });

    const includedAssetIds = new Set(assetSources.map(source => source.reference.id));
    const linkedNoteSources = portfolio.journal.entries.flatMap((entry): PortfolioChatSource[] => {
        const linked = entry.linkedContext?.some(reference => (
            (reference.type === 'process' && reference.id === process.id)
            || (reference.type === 'node'
                && graphResult.includedNodeIds.has(reference.id)
                && (!reference.processId || reference.processId === process.id))
            || (reference.type === 'asset' && includedAssetIds.has(reference.id))
        ));
        if (!linked) return [];
        return [{
            sourceId: `journal-entry:${entry.id}`,
            category: 'linked-note',
            label: entry.title,
            reference: coreEntityReference('core.journal-entry', entry.id),
            data: {
                title: entry.title,
                text: notePlainText(entry.content),
                linkedContext: (entry.linkedContext || []).map(reference => ({
                    id: reference.id,
                    type: reference.type,
                    ...(reference.processId ? { processId: reference.processId } : {}),
                })),
            },
        }];
    });

    let selectionSourceId = processSource.sourceId;
    if (selection?.kind === 'asset' && assetSources.some(source => source.reference.id === selection.id)) {
        selectionSourceId = `asset:${selection.id}`;
    } else if (selection?.kind === 'node') {
        const location = findNodeLocationInProcess(selection.id, process);
        if (location) {
            const containerPath = location.path.slice(0, -1);
            selectionSourceId = `node:${process.id}:${graphLocationKey(containerPath)}:${selection.id}`;
        }
    }

    const allCandidates = [
        processSource,
        ...graphResult.sources,
        ...assetSources,
        ...linkedNoteSources,
    ];
    const selectionIndex = allCandidates.findIndex(source => source.sourceId === selectionSourceId);
    if (selectionIndex < 0) selectionSourceId = processSource.sourceId;
    const candidates = [
        ...allCandidates.filter(source => source.sourceId === selectionSourceId),
        ...allCandidates.filter(source => source.sourceId !== selectionSourceId),
    ];

    const maximumCharacters = Math.max(
        2_000,
        Math.min(options.maximumCharacters ?? DEFAULT_PORTFOLIO_CHAT_MAX_CHARACTERS, 200_000),
    );
    const maximumSources = Math.max(
        1,
        Math.min(options.maximumSources ?? DEFAULT_PORTFOLIO_CHAT_MAX_SOURCES, DEFAULT_PORTFOLIO_CHAT_MAX_SOURCES),
    );
    const sources: PortfolioChatSource[] = [];
    let includedCharacters = 0;
    let omittedSources = 0;
    candidates.forEach(candidate => {
        const size = JSON.stringify(candidate).length;
        if (sources.length >= maximumSources || includedCharacters + size > maximumCharacters) {
            omittedSources += 1;
            return;
        }
        sources.push(candidate);
        includedCharacters += size;
    });
    if (!sources.some(source => source.sourceId === selectionSourceId)) return null;

    const parsed = PortfolioChatContextProjectionSchema.parse({
        schema: 'axiom.portfolio-chat-context',
        schemaVersion: CURRENT_PORTFOLIO_CHAT_CONTEXT_SCHEMA_VERSION,
        projection: 'core-portfolio-chat',
        projectionVersion: 1,
        scope: selectionSourceId === processSource.sourceId ? 'current-process' : 'selected-item',
        baseRevision,
        processId: process.id,
        selectionSourceId,
        sources,
        limits: {
            maximumCharacters,
            maximumSources,
            includedCharacters,
            omittedSources,
            truncated: omittedSources > 0,
        },
    });
    return deepFreeze(parsed);
}
