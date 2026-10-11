import type { CanvasGraph, Portfolio } from '../types';
import {
    coreEntityReference,
    type CoreEntityKind,
    type UniversalEntityReference,
} from './universalReference';
import { listProcessGraphLocations } from './graphLocations';

const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_PLUGIN_SEARCH_RESULTS = 100;
export const MAX_PLUGIN_SEARCH_QUERY_LENGTH = 240;

export interface PluginSearchRequest {
    readonly query: string;
    readonly kinds?: readonly CoreEntityKind[];
    readonly limit?: number;
}

export interface PluginSearchResult {
    readonly reference: UniversalEntityReference;
    readonly label: string;
    readonly context: string;
    readonly score: number;
}

interface SearchCandidate {
    reference: UniversalEntityReference | null;
    label: string;
    context: string;
    searchableText: string;
}

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const safeCoreEntityReference = (
    kind: CoreEntityKind,
    id: string,
    location?: Parameters<typeof coreEntityReference>[2],
): UniversalEntityReference | null => {
    try {
        return deepFreeze(coreEntityReference(kind, id, location));
    } catch {
        return null;
    }
};

const normalize = (value: string): string => value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const graphCandidates = (
    processId: string,
    processTitle: string,
    graph: CanvasGraph,
    graphPath?: readonly string[],
): SearchCandidate[] => {
    const location = graphPath && graphPath.length > 0
        ? { processId, graphPath: [...graphPath] }
        : { processId };
    return [
        ...graph.nodes.map(node => ({
            reference: safeCoreEntityReference('core.node', node.id, location),
            label: node.label?.trim() || 'Untitled step',
            context: processTitle,
            searchableText: [node.label, node.data?.description, processTitle]
                .filter(value => typeof value === 'string')
                .join(' '),
        })),
        ...graph.edges.filter(edge => edge.label?.trim()).map(edge => ({
            reference: safeCoreEntityReference('core.edge', edge.id, location),
            label: edge.label!.trim(),
            context: processTitle,
            searchableText: `${edge.label} ${processTitle}`,
        })),
        ...graph.swimlanes.map(swimlane => ({
            reference: safeCoreEntityReference('core.swimlane', swimlane.id, location),
            label: swimlane.label,
            context: processTitle,
            searchableText: `${swimlane.label} ${processTitle}`,
        })),
    ];
};

const collectCandidates = (portfolio: Portfolio): SearchCandidate[] => {
    const categoryLabels = new Map(
        portfolio.assetCategories.map(category => [category.id, category.label]),
    );
    const notebookTitles = new Map(
        portfolio.journal.notebooks.map(notebook => [notebook.id, notebook.title]),
    );

    return [
        ...portfolio.processes.flatMap(process => [
            {
                reference: safeCoreEntityReference('core.process', process.id),
                label: process.title,
                context: 'Process',
                searchableText: `${process.title} ${process.description || ''}`,
            },
            ...listProcessGraphLocations(process).flatMap(located => graphCandidates(
                process.id,
                process.title,
                located.graph,
                located.graphPath || undefined,
            )),
        ]),
        ...portfolio.processFolders.map(folder => ({
            reference: safeCoreEntityReference('core.process-folder', folder.id),
            label: folder.title,
            context: 'Process folder',
            searchableText: folder.title,
        })),
        ...portfolio.assets.map(asset => {
            const category = categoryLabels.get(asset.type) || 'Resource';
            return {
                reference: safeCoreEntityReference('core.asset', asset.id),
                label: asset.name,
                context: category,
                searchableText: `${asset.name} ${category}`,
            };
        }),
        ...portfolio.assetCategories.map(category => ({
            reference: safeCoreEntityReference('core.asset-category', category.id),
            label: category.label,
            context: 'Resource category',
            searchableText: `${category.label} ${category.baseType || ''}`,
        })),
        ...portfolio.journal.entries.map(entry => ({
            reference: safeCoreEntityReference('core.journal-entry', entry.id),
            label: entry.title,
            context: notebookTitles.get(entry.notebookId) || 'Journal',
            searchableText: `${entry.title} ${notebookTitles.get(entry.notebookId) || ''}`,
        })),
        ...portfolio.journal.notebooks.map(notebook => ({
            reference: safeCoreEntityReference('core.journal-notebook', notebook.id),
            label: notebook.title,
            context: 'Journal notebook',
            searchableText: notebook.title,
        })),
        ...portfolio.journal.folders.map(folder => ({
            reference: safeCoreEntityReference('core.journal-folder', folder.id),
            label: folder.title,
            context: 'Journal folder',
            searchableText: folder.title,
        })),
        ...portfolio.journal.tags.map(tag => ({
            reference: safeCoreEntityReference('core.tag', tag.id),
            label: tag.label,
            context: 'Journal tag',
            searchableText: tag.label,
        })),
        ...portfolio.incidents.flatMap(incident => [
            {
                reference: safeCoreEntityReference('core.incident', incident.id),
                label: incident.title,
                context: 'Incident',
                searchableText: incident.title,
            },
            ...incident.findings.map(finding => ({
                reference: safeCoreEntityReference('core.finding', finding.id, { incidentId: incident.id }),
                label: finding.text,
                context: incident.title,
                searchableText: `${finding.text} ${incident.title}`,
            })),
        ]),
    ];
};

const candidateScore = (candidate: SearchCandidate, normalizedQuery: string): number => {
    const label = normalize(candidate.label);
    if (label === normalizedQuery) return 100;
    if (label.startsWith(normalizedQuery)) return 80;
    if (label.includes(normalizedQuery)) return 60;
    return 40;
};

export function searchPortfolio(
    portfolio: Portfolio,
    request: PluginSearchRequest,
): readonly PluginSearchResult[] {
    const query = request.query.trim().slice(0, MAX_PLUGIN_SEARCH_QUERY_LENGTH);
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return Object.freeze([]);

    const terms = normalizedQuery.split(' ').filter(Boolean).slice(0, 16);
    const allowedKinds = request.kinds ? new Set<CoreEntityKind>(request.kinds) : null;
    const requestedLimit = Number.isFinite(request.limit)
        ? Math.floor(request.limit!)
        : DEFAULT_SEARCH_LIMIT;
    const limit = Math.min(MAX_PLUGIN_SEARCH_RESULTS, Math.max(1, requestedLimit));

    return Object.freeze(collectCandidates(portfolio)
        .filter((candidate): candidate is SearchCandidate & { reference: UniversalEntityReference } => (
            candidate.reference !== null
        ))
        .filter(candidate => !allowedKinds || allowedKinds.has(candidate.reference.kind as CoreEntityKind))
        .map(candidate => ({ candidate, haystack: normalize(candidate.searchableText) }))
        .filter(({ haystack }) => terms.every(term => haystack.includes(term)))
        .map(({ candidate }) => Object.freeze({
            reference: candidate.reference,
            label: candidate.label,
            context: candidate.context,
            score: candidateScore(candidate, normalizedQuery),
        }))
        .sort((left, right) => (
            right.score - left.score
            || left.label.localeCompare(right.label)
            || left.reference.kind.localeCompare(right.reference.kind)
            || left.reference.id.localeCompare(right.reference.id)
        ))
        .slice(0, limit));
}
