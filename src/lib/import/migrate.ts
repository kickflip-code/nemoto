import { migrateDivision } from '../canvasDivision';
import type { CanvasGraph, CanvasNode, Portfolio, Process } from '../../types';
import { createEmptyPortfolioPluginState } from '../../plugins/portfolioData';
import {
    JOURNAL_CONTENT_FORMAT,
    JOURNAL_CONTENT_VERSION,
    normalizeJournalContent,
} from '../journalContent';
import { normalizeJournalMentions, reconcileLinkedContext } from '../journalMentions';
import { createEntityResolverIndex } from '../entityResolver';
import { canonicalizeResourceReferenceNode } from '../resourceReferences';

export const CURRENT_PORTFOLIO_SCHEMA_VERSION = 4;
export const LEGACY_PORTFOLIO_SCHEMA_VERSION = 0;

export interface MigrationChange {
    code: 'schema-version' | 'legacy-children' | 'journal-content' | 'defaulted-collection' | 'defaulted-field' | 'plugin-state' | 'resource-reference' | 'event-contract';
    path: string;
    message: string;
}

export interface MigrationWarning {
    code: 'subgraph-id-conflict';
    path: string;
    message: string;
}

export interface MigrationReport {
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    migrated: boolean;
    changes: MigrationChange[];
    warnings: MigrationWarning[];
}

export interface PortfolioMigrationResult {
    portfolio: Portfolio;
    report: MigrationReport;
}

type LegacyCanvasNode = CanvasNode & { children?: CanvasGraph | null };

function migrateInterimEventContract(node: CanvasNode, path: string, changes: MigrationChange[]): void {
    if (node.type !== 'event' || !node.event || typeof node.event !== 'object') return;
    const event = node.event as unknown as Record<string, unknown>;
    let changed = false;

    if (typeof event.kind !== 'string') {
        event.kind = 'generic';
        changed = true;
    }
    if (typeof event.behavior !== 'string') {
        event.behavior = 'neutral';
        changed = true;
    }

    const legacyTimingKeys = ['start', 'end', 'allDay'] as const;
    if (legacyTimingKeys.some(key => Object.prototype.hasOwnProperty.call(event, key))) {
        const timing = event.timing && typeof event.timing === 'object' && !Array.isArray(event.timing)
            ? { ...(event.timing as Record<string, unknown>) }
            : {};
        legacyTimingKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(event, key) && !Object.prototype.hasOwnProperty.call(timing, key)) {
                timing[key] = event[key];
            }
            delete event[key];
        });
        event.timing = timing;
        changed = true;
    }

    if (changed) {
        changes.push({
            code: 'event-contract',
            path: `${path}.event`,
            message: 'Generalized the interim Event payload and moved optional date fields into timing.',
        });
    }
}

function cloneJsonDocument<T>(value: T): T {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value)) as T;
}

function stableHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function allocateLegacySubGraphId(
    processId: string,
    nodePath: string[],
    usedIds: Set<string>,
): string {
    const base = `sg-migrated-${stableHash([processId, ...nodePath].join('\u0000'))}`;
    let candidate = base;
    let suffix = 2;

    while (usedIds.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function normalizeGraphCollections(
    graph: CanvasGraph,
    path: string,
    changes: MigrationChange[],
): CanvasGraph {
    const mutableGraph = graph as CanvasGraph & {
        nodes?: CanvasNode[] | null;
        edges?: CanvasGraph['edges'] | null;
        swimlanes?: CanvasGraph['swimlanes'] | null;
    };

    if (!Array.isArray(mutableGraph.nodes)) {
        mutableGraph.nodes = [];
        changes.push({
            code: 'defaulted-collection',
            path: `${path}.nodes`,
            message: 'Defaulted missing graph nodes to an empty collection.',
        });
    }
    if (!Array.isArray(mutableGraph.edges)) {
        mutableGraph.edges = [];
        changes.push({
            code: 'defaulted-collection',
            path: `${path}.edges`,
            message: 'Defaulted missing graph edges to an empty collection.',
        });
    }
    if (!Array.isArray(mutableGraph.swimlanes)) {
        mutableGraph.swimlanes = [];
        changes.push({
            code: 'defaulted-collection',
            path: `${path}.swimlanes`,
            message: 'Defaulted missing graph swimlanes to an empty collection.',
        });
    }

    return mutableGraph as CanvasGraph;
}

function migrateProcessGraphs(
    process: Process,
    processIndex: number,
    changes: MigrationChange[],
    warnings: MigrationWarning[],
): void {
    const processPath = `processes[${processIndex}]`;
    process.graph = normalizeGraphCollections(process.graph, `${processPath}.graph`, changes);
    process.subGraphs = process.subGraphs ? { ...process.subGraphs } : {};
    const usedSubGraphIds = new Set(Object.keys(process.subGraphs));
    const visitedSubGraphs = new Set<string>();

    const visitGraph = (graph: CanvasGraph, graphPath: string, nodePath: string[]): void => {
        normalizeGraphCollections(graph, graphPath, changes);
        if (!graph.division) {
            Object.assign(graph, migrateDivision(graph, process.mode));
            changes.push({ code: 'defaulted-field', path: `${graphPath}.division`, message: 'Migrated canvas divisions without moving content.' });
        }

        graph.nodes.forEach((rawNode, nodeIndex) => {
            const canonicalNode = canonicalizeResourceReferenceNode(rawNode);
            if (canonicalNode !== rawNode) {
                graph.nodes[nodeIndex] = canonicalNode;
                changes.push({
                    code: 'resource-reference',
                    path: `${graphPath}.nodes[${nodeIndex}].assetIds`,
                    message: 'Promoted a legacy placed-resource data reference to canonical assetIds.',
                });
            }
            const node = canonicalNode as LegacyCanvasNode;
            const currentNodePath = [...nodePath, `${nodeIndex}:${node.id}`];
            const serializedPath = `${graphPath}.nodes[${nodeIndex}]`;
            migrateInterimEventContract(node, serializedPath, changes);

            if (node.children) {
                const legacyChildGraph = normalizeGraphCollections(
                    node.children,
                    `${serializedPath}.children`,
                    changes,
                );
                let targetSubGraphId = node.subGraphId || undefined;

                if (targetSubGraphId && process.subGraphs?.[targetSubGraphId]) {
                    warnings.push({
                        code: 'subgraph-id-conflict',
                        path: serializedPath,
                        message: `Legacy children conflicted with existing subgraph '${targetSubGraphId}'; a deterministic replacement ID was allocated.`,
                    });
                    targetSubGraphId = undefined;
                }

                if (!targetSubGraphId) {
                    targetSubGraphId = allocateLegacySubGraphId(process.id, currentNodePath, usedSubGraphIds);
                } else {
                    usedSubGraphIds.add(targetSubGraphId);
                }

                process.subGraphs![targetSubGraphId] = legacyChildGraph;
                node.subGraphId = targetSubGraphId;
                delete node.children;
                changes.push({
                    code: 'legacy-children',
                    path: serializedPath,
                    message: `Moved nested children to subGraphs['${targetSubGraphId}'].`,
                });

                visitGraph(
                    legacyChildGraph,
                    `${processPath}.subGraphs.${targetSubGraphId}`,
                    currentNodePath,
                );
            }
        });
    };

    visitGraph(process.graph, `${processPath}.graph`, []);

    Object.entries(process.subGraphs).forEach(([subGraphId, graph]) => {
        if (visitedSubGraphs.has(subGraphId)) return;
        visitedSubGraphs.add(subGraphId);
        visitGraph(graph, `${processPath}.subGraphs.${subGraphId}`, [`subgraph:${subGraphId}`]);
    });
}

function normalizePortfolioCollections(portfolio: Portfolio, changes: MigrationChange[]): void {
    const mutablePortfolio = portfolio as Portfolio & {
        processes?: Portfolio['processes'] | null;
        processFolders?: Portfolio['processFolders'] | null;
        assets?: Portfolio['assets'] | null;
        assetCategories?: Portfolio['assetCategories'] | null;
        incidents?: Portfolio['incidents'] | null;
        journal?: Portfolio['journal'] | null;
    };
    const defaults: Array<{
        key: 'processes' | 'processFolders' | 'assets' | 'assetCategories' | 'incidents';
        value: [];
    }> = [
        { key: 'processes', value: [] },
        { key: 'processFolders', value: [] },
        { key: 'assets', value: [] },
        { key: 'assetCategories', value: [] },
        { key: 'incidents', value: [] },
    ];

    defaults.forEach(({ key, value }) => {
        if (!Array.isArray(mutablePortfolio[key])) {
            (mutablePortfolio as unknown as Record<string, unknown>)[key] = value;
            changes.push({
                code: 'defaulted-collection',
                path: key,
                message: `Defaulted missing portfolio ${key} to an empty collection.`,
            });
        }
    });

    if (!mutablePortfolio.journal) {
        mutablePortfolio.journal = { notebooks: [], folders: [], entries: [], tags: [] };
        changes.push({
            code: 'defaulted-collection',
            path: 'journal',
            message: 'Defaulted missing journal to an empty journal.',
        });
    } else {
        const journal = mutablePortfolio.journal;
        (['notebooks', 'folders', 'entries', 'tags'] as const).forEach(key => {
            if (!Array.isArray(journal[key])) {
                (journal as unknown as Record<string, unknown>)[key] = [];
                changes.push({
                    code: 'defaulted-collection',
                    path: `journal.${key}`,
                    message: `Defaulted missing journal ${key} to an empty collection.`,
                });
            }
        });
    }
}

function migratePortfolioPluginState(portfolio: Portfolio, changes: MigrationChange[]): void {
    if (portfolio.plugins) return;

    portfolio.plugins = createEmptyPortfolioPluginState();
    changes.push({
        code: 'plugin-state',
        path: 'plugins',
        message: 'Added the empty host-understood plugin state introduced in portfolio schema 2.',
    });
}

/**
 * Migrate a parsed portfolio without mutating the caller's object.
 * Existing IDs are always preserved. Only missing subgraph IDs introduced by
 * the legacy nested-children format are allocated.
 */
export function migratePortfolioWithReport(input: Portfolio): PortfolioMigrationResult {
    const portfolio = cloneJsonDocument(input);
    const sourceSchemaVersion = Number.isInteger(portfolio.schemaVersion)
        ? portfolio.schemaVersion!
        : LEGACY_PORTFOLIO_SCHEMA_VERSION;
    const changes: MigrationChange[] = [];
    const warnings: MigrationWarning[] = [];

    normalizePortfolioCollections(portfolio, changes);
    migratePortfolioPluginState(portfolio, changes);

    if (!portfolio.lastModified) {
        portfolio.lastModified = '1970-01-01T00:00:00.000Z';
        changes.push({
            code: 'defaulted-field',
            path: 'lastModified',
            message: 'Defaulted missing lastModified to the deterministic Unix epoch.',
        });
    }

    portfolio.processes.forEach((process, processIndex) => {
        migrateProcessGraphs(process, processIndex, changes, warnings);
        process.mode = process.mode || process.graph.mode || 'swimlane';
    });

    const entityResolverIndex = createEntityResolverIndex(portfolio);
    portfolio.journal.entries.forEach((entry, entryIndex) => {
        const before = JSON.stringify({
            content: entry.content,
            contentFormat: entry.contentFormat,
            contentVersion: entry.contentVersion,
            linkedContext: entry.linkedContext,
        });
        entry.content = normalizeJournalContent(entry.content);
        const mentions = normalizeJournalMentions(entry.content, portfolio, entityResolverIndex);
        entry.content = mentions.content;
        entry.linkedContext = reconcileLinkedContext(
            entry.linkedContext as never,
            mentions.inlineReferences,
            portfolio,
            entityResolverIndex,
        );
        entry.contentFormat = JOURNAL_CONTENT_FORMAT;
        entry.contentVersion = Math.max(entry.contentVersion || 0, JOURNAL_CONTENT_VERSION);

        const after = JSON.stringify({
            content: entry.content,
            contentFormat: entry.contentFormat,
            contentVersion: entry.contentVersion,
            linkedContext: entry.linkedContext,
        });
        if (before !== after) {
            changes.push({
                code: 'journal-content',
                path: `journal.entries[${entryIndex}]`,
                message: 'Normalized legacy journal content and entity references.',
            });
        }
    });

    if (portfolio.schemaVersion !== CURRENT_PORTFOLIO_SCHEMA_VERSION) {
        portfolio.schemaVersion = CURRENT_PORTFOLIO_SCHEMA_VERSION;
        changes.push({
            code: 'schema-version',
            path: 'schemaVersion',
            message: `Advanced the explicit schema version to ${CURRENT_PORTFOLIO_SCHEMA_VERSION}.`,
        });
    }

    return {
        portfolio,
        report: {
            sourceSchemaVersion,
            targetSchemaVersion: CURRENT_PORTFOLIO_SCHEMA_VERSION,
            migrated: changes.length > 0,
            changes,
            warnings,
        },
    };
}

/** Compatibility wrapper for existing callers. */
export const migratePortfolio = (portfolio: Portfolio): Portfolio => (
    migratePortfolioWithReport(portfolio).portfolio
);
