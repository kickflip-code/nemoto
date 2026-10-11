import { JsonObjectSchema } from '../plugins/semanticData';
import { findNodeLocationInPortfolio } from '../lib/entityResolver';
import {
    coreEntityReference,
    pluginEntityReference,
    type UniversalEntityReference,
} from '../plugins/universalReference';
import { createPortfolioRevision } from '../plugins/proposalReview';
import type { CanvasGraph, Portfolio, Process } from '../types';
import {
    PortfolioChatContextProjectionSchema,
    type PortfolioChatContextProjection,
    type PortfolioChatSelection,
    type PortfolioChatSource,
} from './portfolioChatContext';

export const PORTFOLIO_RETRIEVAL_STRATEGY = 'lexical-v1' as const;
export const DEFAULT_PORTFOLIO_RETRIEVAL_MAX_SOURCES = 12;
export const DEFAULT_PORTFOLIO_RETRIEVAL_PRIMARY_SOURCES = 6;
export const DEFAULT_PORTFOLIO_RETRIEVAL_MAX_CHARACTERS = 16_000;

interface CatalogSeed {
    source: PortfolioChatSource;
    relatedReferences: UniversalEntityReference[];
}

export interface PortfolioRetrievalDocument {
    readonly source: PortfolioChatSource;
    readonly normalizedLabel: string;
    readonly normalizedText: string;
    readonly labelTokens: ReadonlySet<string>;
    readonly tokenFrequency: ReadonlyMap<string, number>;
    readonly relatedSourceIds: readonly string[];
}

export interface PortfolioRetrievalIndex {
    readonly baseRevision: string;
    readonly documents: readonly PortfolioRetrievalDocument[];
    readonly bySourceId: ReadonlyMap<string, PortfolioRetrievalDocument>;
}

export interface PortfolioRetrievalOptions {
    processId?: string | null;
    selection?: PortfolioChatSelection | null;
    maximumCharacters?: number;
    maximumSources?: number;
    maximumPrimarySources?: number;
}

const STOP_WORDS = new Set([
    'a', 'about', 'all', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does',
    'for', 'from', 'how', 'i', 'in', 'is', 'it', 'most', 'of', 'on', 'or', 'our',
    'should', 'that', 'the', 'their', 'there', 'these', 'this', 'to', 'what', 'when',
    'where', 'which', 'who', 'why', 'with', 'would', 'you',
    'alla', 'ar', 'att', 'av', 'de', 'den', 'det', 'ett', 'en', 'for', 'fran', 'har', 'hur',
    'i', 'kan', 'med', 'och', 'om', 'pa', 'ska', 'som', 'till', 'vad', 'var', 'vilka',
    'vilken', 'vem', 'vi',
]);

const BROAD_QUERY_TERMS = new Set([
    'all', 'entire', 'everything', 'overall', 'overview', 'portfolio', 'summarize',
    'alla', 'allt', 'hela', 'helhet', 'overblick', 'oversikt', 'portfolj', 'sammanfatta',
]);

const DEICTIC_QUERY_TERMS = new Set([
    'current', 'here', 'selected', 'selection', 'this',
    'aktuell', 'denna', 'detta', 'har', 'markerad', 'markerade', 'vald', 'valda',
]);

const OUTSIDE_QUERY_TERMS = new Set([
    'another', 'beyond', 'elsewhere', 'other', 'outside',
    'annan', 'annat', 'andra', 'utanfor',
]);

const normalizeText = (value: string): string => value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string, removeStopWords = true): string[] => {
    const tokens = normalizeText(value).match(/[\p{L}\p{N}]+/gu) || [];
    const meaningful = tokens.filter(token => token.length > 1 && (!removeStopWords || !STOP_WORDS.has(token)));
    return meaningful.length > 0 ? meaningful : tokens.filter(token => token.length > 1);
};

const plainText = (content: string): string => content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const safeData = (value: unknown): PortfolioChatSource['data'] => {
    const parsed = JsonObjectSchema.safeParse(value);
    return parsed.success ? parsed.data : {};
};

const graphLocationKey = (path: readonly string[]): string => path.length > 0
    ? path.join('>')
    : 'root';

const referenceKey = (reference: UniversalEntityReference, broad = false): string => [
    reference.kind,
    reference.id,
    broad ? '' : reference.location?.processId || '',
    broad ? '' : reference.location?.incidentId || '',
].join('\u0000');

const addGraphSources = (
    process: Process,
    seeds: CatalogSeed[],
): void => {
    const processReference = coreEntityReference('core.process', process.id);
    seeds.push({
        source: {
            sourceId: `process:${process.id}`,
            category: 'process',
            label: process.title,
            reference: processReference,
            data: safeData({
                title: process.title,
                description: process.description || '',
                ownerId: process.ownerId || '',
                mode: process.mode,
            }),
        },
        relatedReferences: process.ownerId ? [coreEntityReference('core.asset', process.ownerId)] : [],
    });

    const visitedSubGraphs = new Set<string>();
    const visit = (graph: CanvasGraph, path: string[]) => {
        const location = { processId: process.id, graphPath: path };
        const locationKey = graphLocationKey(path);
        graph.nodes.forEach(node => {
            const reference = coreEntityReference('core.node', node.id, location);
            seeds.push({
                source: {
                    sourceId: `node:${process.id}:${locationKey}:${node.id}`,
                    category: 'node',
                    label: node.label || 'Untitled node',
                    reference,
                    data: safeData({
                        label: node.label || 'Untitled node',
                        nodeType: node.type,
                        processId: process.id,
                        processTitle: process.title,
                        graphPath: [...path],
                        relatedAssetIds: [...(node.assetIds || [])],
                        ...(node.data ? { details: node.data } : {}),
                    }),
                },
                relatedReferences: [
                    processReference,
                    ...(node.assetIds || []).map(assetId => coreEntityReference('core.asset', assetId)),
                ],
            });

            if (node.subGraphId && process.subGraphs?.[node.subGraphId]
                && !visitedSubGraphs.has(node.subGraphId)) {
                visitedSubGraphs.add(node.subGraphId);
                visit(process.subGraphs[node.subGraphId], [...path, node.id]);
            }
        });

        graph.edges.forEach(edge => seeds.push({
            source: {
                sourceId: `edge:${process.id}:${locationKey}:${edge.id}`,
                category: 'edge',
                label: edge.label || `${edge.sourceId} to ${edge.targetId}`,
                reference: coreEntityReference('core.edge', edge.id, location),
                data: safeData({
                    label: edge.label || '',
                    processId: process.id,
                    processTitle: process.title,
                    sourceNodeId: edge.sourceId,
                    targetNodeId: edge.targetId,
                    style: edge.style,
                    graphPath: [...path],
                }),
            },
            relatedReferences: [
                processReference,
                coreEntityReference('core.node', edge.sourceId, location),
                coreEntityReference('core.node', edge.targetId, location),
            ],
        }));

        graph.swimlanes.forEach(swimlane => seeds.push({
            source: {
                sourceId: `swimlane:${process.id}:${locationKey}:${swimlane.id}`,
                category: 'swimlane',
                label: swimlane.label,
                reference: coreEntityReference('core.swimlane', swimlane.id, location),
                data: safeData({
                    label: swimlane.label,
                    processId: process.id,
                    processTitle: process.title,
                    order: swimlane.order,
                    graphPath: [...path],
                }),
            },
            relatedReferences: [processReference],
        }));
    };

    visit(process.graph, []);
};

const linkedContextReference = (
    reference: NonNullable<Portfolio['journal']['entries'][number]['linkedContext']>[number],
): UniversalEntityReference | null => {
    if (reference.type === 'process') return coreEntityReference('core.process', reference.id);
    if (reference.type === 'asset') return coreEntityReference('core.asset', reference.id);
    if (reference.type === 'journalEntry') return coreEntityReference('core.journal-entry', reference.id);
    if (reference.type === 'tag') return coreEntityReference('core.tag', reference.id);
    if (reference.type === 'incident') return coreEntityReference('core.incident', reference.id);
    if (reference.type === 'node' && reference.processId) {
        return coreEntityReference('core.node', reference.id, {
            processId: reference.processId,
            graphPath: reference.path || [],
        });
    }
    return null;
};

const findNodeReference = (
    portfolio: Portfolio,
    nodeId: string,
): UniversalEntityReference | null => {
    const location = findNodeLocationInPortfolio(nodeId, portfolio);
    return location ? coreEntityReference('core.node', nodeId, {
        processId: location.processId,
        graphPath: location.path.slice(0, -1),
    }) : null;
};

const createCatalogSeeds = (portfolio: Portfolio): CatalogSeed[] => {
    const seeds: CatalogSeed[] = [];
    portfolio.processes.forEach(process => addGraphSources(process, seeds));

    portfolio.processFolders.forEach(folder => seeds.push({
        source: {
            sourceId: `process-folder:${folder.id}`,
            category: 'process-folder',
            label: folder.title,
            reference: coreEntityReference('core.process-folder', folder.id),
            data: safeData({ title: folder.title, parentId: folder.parentId || '' }),
        },
        relatedReferences: folder.parentId ? [coreEntityReference('core.process-folder', folder.parentId)] : [],
    }));

    portfolio.assetCategories.forEach(category => seeds.push({
        source: {
            sourceId: `asset-category:${category.id}`,
            category: 'asset-category',
            label: category.label,
            reference: coreEntityReference('core.asset-category', category.id),
            data: safeData({ label: category.label, baseType: category.baseType || 'custom' }),
        },
        relatedReferences: [],
    }));

    portfolio.assets.forEach(asset => seeds.push({
        source: {
            sourceId: `asset:${asset.id}`,
            category: 'asset',
            label: asset.name,
            reference: coreEntityReference('core.asset', asset.id),
            data: safeData({
                name: asset.name,
                categoryId: asset.type,
                category: portfolio.assetCategories.find(category => category.id === asset.type)?.label || asset.type,
                parentId: asset.parentId || '',
                ...(asset.metadata ? { metadata: asset.metadata } : {}),
            }),
        },
        relatedReferences: [
            coreEntityReference('core.asset-category', asset.type),
            ...(asset.parentId ? [coreEntityReference('core.asset', asset.parentId)] : []),
        ],
    }));

    portfolio.journal.folders.forEach(folder => seeds.push({
        source: {
            sourceId: `journal-folder:${folder.id}`,
            category: 'journal-folder',
            label: folder.title,
            reference: coreEntityReference('core.journal-folder', folder.id),
            data: safeData({ title: folder.title, parentId: folder.parentId || '' }),
        },
        relatedReferences: folder.parentId ? [coreEntityReference('core.journal-folder', folder.parentId)] : [],
    }));

    portfolio.journal.notebooks.forEach(notebook => seeds.push({
        source: {
            sourceId: `journal-notebook:${notebook.id}`,
            category: 'journal-notebook',
            label: notebook.title,
            reference: coreEntityReference('core.journal-notebook', notebook.id),
            data: safeData({ title: notebook.title, folderId: notebook.folderId || '' }),
        },
        relatedReferences: notebook.folderId ? [coreEntityReference('core.journal-folder', notebook.folderId)] : [],
    }));

    portfolio.journal.tags.forEach(tag => seeds.push({
        source: {
            sourceId: `tag:${tag.id}`,
            category: 'tag',
            label: tag.label,
            reference: coreEntityReference('core.tag', tag.id),
            data: safeData({ label: tag.label, archived: !!tag.archived }),
        },
        relatedReferences: [],
    }));

    portfolio.journal.entries.forEach(entry => seeds.push({
        source: {
            sourceId: `journal-entry:${entry.id}`,
            category: 'journal-entry',
            label: entry.title,
            reference: coreEntityReference('core.journal-entry', entry.id),
            data: safeData({
                title: entry.title,
                text: plainText(entry.content).slice(0, 12_000),
                notebookId: entry.notebookId,
                tags: [...(entry.tags || [])],
                linkedContext: (entry.linkedContext || []).map(reference => ({
                    id: reference.id,
                    type: reference.type,
                    ...(reference.processId ? { processId: reference.processId } : {}),
                })),
            }),
        },
        relatedReferences: [
            coreEntityReference('core.journal-notebook', entry.notebookId),
            ...(entry.tags || []).map(tagId => coreEntityReference('core.tag', tagId)),
            ...(entry.linkedContext || []).map(linkedContextReference).filter((reference): reference is UniversalEntityReference => !!reference),
        ],
    }));

    portfolio.incidents.forEach(incident => {
        const incidentReference = coreEntityReference('core.incident', incident.id);
        seeds.push({
            source: {
                sourceId: `incident:${incident.id}`,
                category: 'incident',
                label: incident.title,
                reference: incidentReference,
                data: safeData({ title: incident.title, createdAt: incident.createdAt, findingCount: incident.findings.length }),
            },
            relatedReferences: incident.findings.map(finding => coreEntityReference('core.finding', finding.id, { incidentId: incident.id })),
        });
        incident.findings.forEach(finding => seeds.push({
            source: {
                sourceId: `finding:${incident.id}:${finding.id}`,
                category: 'finding',
                label: finding.text.slice(0, 160) || 'Incident finding',
                reference: coreEntityReference('core.finding', finding.id, { incidentId: incident.id }),
                data: safeData({ text: finding.text, timestamp: finding.timestamp, linkedNodeIds: [...finding.linkedNodeIds] }),
            },
            relatedReferences: [
                incidentReference,
                ...finding.linkedNodeIds
                    .map(nodeId => findNodeReference(portfolio, nodeId))
                    .filter((reference): reference is UniversalEntityReference => !!reference),
            ],
        }));
    });

    const semanticData = portfolio.plugins?.semanticData;
    semanticData?.records.forEach(record => seeds.push({
        source: {
            sourceId: `semantic-record:${record.id}`,
            category: 'semantic-record',
            label: record.label,
            reference: pluginEntityReference(record.type, record.id),
            data: safeData({
                semanticType: record.type,
                label: record.label,
                properties: record.properties,
                assertion: record.provenance.assertion,
            }),
        },
        relatedReferences: record.provenance.sources.flatMap(source => source.kind === 'entity' ? [source.reference] : []),
    }));
    semanticData?.relations.forEach(relation => seeds.push({
        source: {
            sourceId: `semantic-relation:${relation.id}`,
            category: 'semantic-relation',
            label: relation.type,
            reference: pluginEntityReference(relation.type, relation.id),
            data: safeData({
                semanticType: relation.type,
                source: relation.source,
                target: relation.target,
                properties: relation.properties,
                assertion: relation.provenance.assertion,
            }),
        },
        relatedReferences: [relation.source, relation.target],
    }));
    semanticData?.annotations.forEach(annotation => seeds.push({
        source: {
            sourceId: `semantic-annotation:${annotation.id}`,
            category: 'semantic-annotation',
            label: annotation.type,
            reference: pluginEntityReference(annotation.type, annotation.id),
            data: safeData({
                semanticType: annotation.type,
                target: annotation.target,
                properties: annotation.properties,
                assertion: annotation.provenance.assertion,
            }),
        },
        relatedReferences: [annotation.target],
    }));

    return seeds;
};

const createTokenFrequency = (text: string): Map<string, number> => {
    const frequency = new Map<string, number>();
    tokenize(text, false).forEach(token => frequency.set(token, (frequency.get(token) || 0) + 1));
    return frequency;
};

export const buildPortfolioRetrievalIndex = (portfolio: Portfolio): PortfolioRetrievalIndex => {
    const seeds = createCatalogSeeds(portfolio);
    const sourceIdsByReference = new Map<string, string[]>();
    seeds.forEach(({ source }) => {
        [referenceKey(source.reference), referenceKey(source.reference, true)].forEach(key => {
            const existing = sourceIdsByReference.get(key) || [];
            if (!existing.includes(source.sourceId)) existing.push(source.sourceId);
            sourceIdsByReference.set(key, existing);
        });
    });

    const relatedIdsBySourceId = new Map<string, Set<string>>();
    seeds.forEach(({ source, relatedReferences }) => {
        const relatedIds = relatedIdsBySourceId.get(source.sourceId) || new Set<string>();
        relatedReferences.flatMap(reference => (
            sourceIdsByReference.get(referenceKey(reference))
            || sourceIdsByReference.get(referenceKey(reference, true))
            || []
        )).forEach(relatedSourceId => {
            if (relatedSourceId !== source.sourceId) relatedIds.add(relatedSourceId);
        });
        relatedIdsBySourceId.set(source.sourceId, relatedIds);
    });
    relatedIdsBySourceId.forEach((relatedIds, sourceId) => {
        relatedIds.forEach(relatedSourceId => {
            const reverse = relatedIdsBySourceId.get(relatedSourceId) || new Set<string>();
            reverse.add(sourceId);
            relatedIdsBySourceId.set(relatedSourceId, reverse);
        });
    });

    const documents = seeds.map(({ source }): PortfolioRetrievalDocument => {
        const text = `${source.label} ${source.category} ${JSON.stringify(source.data)}`.slice(0, 30_000);
        const relatedSourceIds = [...(relatedIdsBySourceId.get(source.sourceId) || [])].sort();
        return Object.freeze({
            source: Object.freeze(source),
            normalizedLabel: normalizeText(source.label),
            normalizedText: normalizeText(text),
            labelTokens: new Set(tokenize(source.label, false)),
            tokenFrequency: createTokenFrequency(text),
            relatedSourceIds: Object.freeze(relatedSourceIds),
        });
    });
    return Object.freeze({
        baseRevision: createPortfolioRevision(portfolio),
        documents: Object.freeze(documents),
        bySourceId: new Map(documents.map(document => [document.source.sourceId, document])),
    });
};

const indexCache = new WeakMap<Portfolio, PortfolioRetrievalIndex>();

export const getPortfolioRetrievalIndex = (portfolio: Portfolio): PortfolioRetrievalIndex => {
    const revision = createPortfolioRevision(portfolio);
    const cached = indexCache.get(portfolio);
    if (cached?.baseRevision === revision) return cached;
    const index = buildPortfolioRetrievalIndex(portfolio);
    indexCache.set(portfolio, index);
    return index;
};

const scoreDocument = (
    document: PortfolioRetrievalDocument,
    query: string,
    queryTokens: readonly string[],
    documentFrequencies: ReadonlyMap<string, number>,
    documentCount: number,
): number => {
    let score = 0;
    const normalizedQuery = normalizeText(query);
    if (document.normalizedLabel === normalizedQuery) score += 100;
    else if (normalizedQuery.length >= 3 && document.normalizedLabel.includes(normalizedQuery)) score += 45;
    if (normalizedQuery.split(' ').length > 1 && document.normalizedText.includes(normalizedQuery)) score += 24;

    queryTokens.forEach(token => {
        const frequency = document.tokenFrequency.get(token) || 0;
        const idf = Math.log(1 + documentCount / (1 + (documentFrequencies.get(token) || 0)));
        if (document.labelTokens.has(token)) score += 10 * idf;
        if (frequency > 0) score += (2 + Math.log(frequency)) * idf;
        if (frequency === 0 && token.length >= 4) {
            const partialLabelMatch = [...document.labelTokens].some(labelToken => (
                labelToken.startsWith(token) || token.startsWith(labelToken)
            ));
            if (partialLabelMatch) score += 3 * idf;
        }
    });
    return score;
};

const belongsToProcess = (
    document: PortfolioRetrievalDocument,
    processId: string,
): boolean => (
    (document.source.reference.kind === 'core.process' && document.source.reference.id === processId)
    || document.source.reference.location?.processId === processId
);

const findFocusSourceId = (
    index: PortfolioRetrievalIndex,
    processId?: string | null,
    selection?: PortfolioChatSelection | null,
): string | undefined => {
    if (selection) {
        return index.documents.find(document => (
            document.source.reference.id === selection.id
            && document.source.reference.kind === (selection.kind === 'asset' ? 'core.asset' : 'core.node')
            && (selection.kind !== 'node' || !processId || document.source.reference.location?.processId === processId)
        ))?.source.sourceId;
    }
    return processId ? index.documents.find(document => (
        document.source.reference.kind === 'core.process' && document.source.reference.id === processId
    ))?.source.sourceId : undefined;
};

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

export const createPortfolioRetrievalContextProjection = (
    portfolio: Portfolio,
    query: string,
    options: PortfolioRetrievalOptions = {},
): PortfolioChatContextProjection | null => {
    const index = getPortfolioRetrievalIndex(portfolio);
    if (index.documents.length === 0) return null;

    const queryTokens = [...new Set(tokenize(query))];
    const rawTokens = tokenize(query, false);
    const broadQuery = rawTokens.some(token => BROAD_QUERY_TERMS.has(token));
    const deicticQuery = rawTokens.some(token => DEICTIC_QUERY_TERMS.has(token));
    const outsideCurrentProcess = !!options.processId
        && rawTokens.some(token => OUTSIDE_QUERY_TERMS.has(token));
    const documentFrequencies = new Map<string, number>();
    queryTokens.forEach(token => {
        documentFrequencies.set(token, index.documents.reduce((count, document) => (
            count + (document.tokenFrequency.has(token) ? 1 : 0)
        ), 0));
    });

    let scored = index.documents.map(document => {
        let score = scoreDocument(document, query, queryTokens, documentFrequencies, index.documents.length);
        if (broadQuery && ['process', 'process-folder', 'asset-category', 'journal-notebook', 'incident'].includes(document.source.category)) {
            score += 2;
        }
        return { document, score };
    }).filter(candidate => candidate.score > 0)
        .sort((left, right) => right.score - left.score
            || left.document.source.label.localeCompare(right.document.source.label)
            || left.document.source.sourceId.localeCompare(right.document.source.sourceId));
    if (outsideCurrentProcess && options.processId) {
        scored = scored.filter(candidate => !belongsToProcess(candidate.document, options.processId!));
    }

    const focusSourceId = findFocusSourceId(index, options.processId, options.selection);
    const maximumPrimarySources = Math.max(1, Math.min(
        options.maximumPrimarySources ?? DEFAULT_PORTFOLIO_RETRIEVAL_PRIMARY_SOURCES,
        30,
    ));
    const maximumSources = Math.max(1, Math.min(
        options.maximumSources ?? DEFAULT_PORTFOLIO_RETRIEVAL_MAX_SOURCES,
        100,
    ));
    const maximumCharacters = Math.max(2_000, Math.min(
        options.maximumCharacters ?? DEFAULT_PORTFOLIO_RETRIEVAL_MAX_CHARACTERS,
        200_000,
    ));

    let fallbackUsed = false;
    let primaryIds = scored.slice(0, maximumPrimarySources).map(candidate => candidate.document.source.sourceId);
    if (deicticQuery && focusSourceId && !outsideCurrentProcess) {
        primaryIds = [focusSourceId, ...primaryIds.filter(id => id !== focusSourceId)];
    }
    if (primaryIds.length === 0) {
        fallbackUsed = true;
        primaryIds = index.documents
            .filter(document => ['process', 'process-folder', 'asset-category', 'journal-notebook', 'incident'].includes(document.source.category))
            .filter(document => !outsideCurrentProcess
                || !options.processId
                || !belongsToProcess(document, options.processId))
            .slice(0, maximumPrimarySources)
            .map(document => document.source.sourceId);
    }
    if (primaryIds.length === 0 && focusSourceId) primaryIds = [focusSourceId];
    if (primaryIds.length === 0) primaryIds = [index.documents[0].source.sourceId];
    primaryIds = [...new Set(primaryIds)].slice(0, maximumPrimarySources);

    const expandedIds: string[] = [];
    primaryIds.forEach(sourceId => {
        index.bySourceId.get(sourceId)?.relatedSourceIds.forEach(relatedSourceId => {
            if (!primaryIds.includes(relatedSourceId) && !expandedIds.includes(relatedSourceId)) {
                expandedIds.push(relatedSourceId);
            }
        });
    });
    if (focusSourceId
        && !outsideCurrentProcess
        && !primaryIds.includes(focusSourceId)
        && !expandedIds.includes(focusSourceId)) {
        expandedIds.unshift(focusSourceId);
    }
    const currentProcessSourceId = options.processId ? `process:${options.processId}` : undefined;
    if (currentProcessSourceId
        && !outsideCurrentProcess
        && index.bySourceId.has(currentProcessSourceId)
        && !primaryIds.includes(currentProcessSourceId)
        && !expandedIds.includes(currentProcessSourceId)) {
        expandedIds.push(currentProcessSourceId);
    }

    const candidateIds = [...primaryIds, ...expandedIds].slice(0, maximumSources);
    const sources: PortfolioChatSource[] = [];
    let includedCharacters = 0;
    candidateIds.forEach(sourceId => {
        const source = index.bySourceId.get(sourceId)?.source;
        if (!source) return;
        const size = JSON.stringify(source).length;
        if (sources.length >= maximumSources || includedCharacters + size > maximumCharacters) return;
        sources.push(source);
        includedCharacters += size;
    });
    if (sources.length === 0) return null;

    const includedIds = new Set(sources.map(source => source.sourceId));
    const includedPrimaryIds = primaryIds.filter(sourceId => includedIds.has(sourceId));
    const includedExpandedIds = expandedIds.filter(sourceId => includedIds.has(sourceId));
    const relevantIds = new Set([
        ...scored.map(candidate => candidate.document.source.sourceId),
        ...expandedIds,
    ]);
    const omittedSources = [...relevantIds].filter(sourceId => !includedIds.has(sourceId)).length;
    const selectionSourceId = (focusSourceId && includedIds.has(focusSourceId) && deicticQuery
        ? focusSourceId
        : includedPrimaryIds[0]) || sources[0].sourceId;

    const parsed = PortfolioChatContextProjectionSchema.parse({
        schema: 'axiom.portfolio-chat-context',
        schemaVersion: 1,
        projection: 'core-portfolio-chat',
        projectionVersion: 1,
        scope: 'portfolio-retrieval',
        baseRevision: index.baseRevision,
        processId: options.processId || null,
        selectionSourceId,
        sources,
        limits: {
            maximumCharacters,
            maximumSources,
            includedCharacters,
            omittedSources,
            truncated: omittedSources > 0,
        },
        retrieval: {
            strategy: PORTFOLIO_RETRIEVAL_STRATEGY,
            indexedSourceCount: index.documents.length,
            matchedSourceCount: scored.length,
            returnedSourceCount: sources.length,
            primarySourceIds: includedPrimaryIds,
            expandedSourceIds: includedExpandedIds,
            fallbackUsed,
        },
    });
    return deepFreeze(parsed);
};
