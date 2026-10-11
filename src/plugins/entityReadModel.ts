import type {
    CanvasNode,
    Portfolio,
} from '../types';
import type { EntityReference } from '../types/journal';
import {
    MAX_PLUGIN_ENTITY_SNAPSHOT_BYTES,
    MAX_PLUGIN_RELATION_MATCHES,
    PluginEntityRelationSchema,
    PluginEntityRelationPageSchema,
    PluginEntitySnapshotSchema,
    PluginRelationCursorError,
    parsePluginEntityRelationQuery,
    sameEntityIdentity,
    type PluginEntityRelation,
    type PluginEntityRelationPage,
    type PluginEntityRelationQuery,
    type PluginEntitySnapshot,
    type PluginRelationDirection,
} from './entityReadContracts';
import type { JsonValue } from './semanticData';
import {
    findGraphEntityLocation,
    graphLocationHint,
    listProcessGraphLocations,
    type LocatedPortfolioGraph,
} from './graphLocations';
import {
    coreEntityReference,
    parseUniversalEntityReference,
    pluginEntityReference,
    type CoreEntityKind,
    type UniversalEntityReference,
} from './universalReference';

const MAX_SNAPSHOT_TEXT = 4_000;
const MAX_SEMANTIC_PROPERTIES_BYTES = 48 * 1024;
const CURSOR_PATTERN = /^v1:(\d+):(\d+)$/;

type JsonObject = { [key: string]: JsonValue };

const cloneJson = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const byteLength = (value: unknown): number => (
    new TextEncoder().encode(JSON.stringify(value)).byteLength
);

const text = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return (normalized || fallback).slice(0, MAX_SNAPSHOT_TEXT);
};

const refreshReference = (
    portfolio: Portfolio,
    input: UniversalEntityReference,
): UniversalEntityReference => {
    if (input.kind === 'core.node' || input.kind === 'core.edge' || input.kind === 'core.swimlane') {
        const located = findGraphEntityLocation(
            portfolio,
            input.kind,
            input.id,
            input.location?.processId,
        );
        return located
            ? coreEntityReference(input.kind, input.id, graphLocationHint(located))
            : input;
    }
    if (input.kind === 'core.finding') {
        const incident = portfolio.incidents.find(candidate => (
            candidate.findings.some(finding => finding.id === input.id)
        ));
        return incident
            ? coreEntityReference('core.finding', input.id, { incidentId: incident.id })
            : input;
    }
    return input;
};

const boundedSemanticProperties = (
    properties: JsonObject,
    omitted: Set<string>,
): JsonObject | undefined => {
    if (byteLength(properties) > MAX_SEMANTIC_PROPERTIES_BYTES) {
        omitted.add('properties');
        return undefined;
    }
    return cloneJson(properties);
};

const provenanceSummary = (provenance: {
    assertion: string;
    recordedAt: string;
    origin: { kind: string };
    confidence?: { value: number };
}): JsonObject => ({
    assertion: provenance.assertion,
    recordedAt: provenance.recordedAt,
    originKind: provenance.origin.kind,
    ...(provenance.confidence ? { confidence: provenance.confidence.value } : {}),
});

const snapshot = (
    portfolioRevision: number,
    reference: UniversalEntityReference,
    label: string,
    fields: JsonObject,
    omitted: Set<string>,
): PluginEntitySnapshot => {
    const candidate = {
        schema: 'axiom.plugin.entity-snapshot' as const,
        schemaVersion: 1 as const,
        portfolioRevision,
        reference,
        label: text(label, 'Untitled entity').slice(0, 500),
        fields,
        omittedFields: [...omitted].sort(),
    };
    if (byteLength(candidate) > MAX_PLUGIN_ENTITY_SNAPSHOT_BYTES && 'properties' in fields) {
        delete fields.properties;
        omitted.add('properties');
        candidate.omittedFields = [...omitted].sort();
    }
    return deepFreeze(PluginEntitySnapshotSchema.parse(candidate));
};

const nodeFields = (node: CanvasNode, located: LocatedPortfolioGraph, omitted: Set<string>): JsonObject => {
    const fields: JsonObject = {
        nodeType: node.type,
        processId: located.process.id,
        graphId: located.graphId,
        position: { x: node.position.x, y: node.position.y },
        ...(typeof node.width === 'number' ? { width: node.width } : {}),
        ...(typeof node.height === 'number' ? { height: node.height } : {}),
    };
    const description = node.data?.description;
    const hasPublicDescription = typeof description === 'string' && Boolean(description.trim());
    if (hasPublicDescription) {
        fields.description = text(description, '');
    }
    if (node.data && Object.entries(node.data).some(([key]) => (
        key !== 'description' || !hasPublicDescription
    ))) omitted.add('data');
    if (node.extensions) omitted.add('extensions');
    return fields;
};

export function createPluginEntitySnapshot(
    portfolio: Portfolio,
    input: unknown,
    portfolioRevision: number,
): PluginEntitySnapshot | null {
    const reference = parseUniversalEntityReference(input);
    const omitted = new Set<string>();

    switch (reference.kind) {
        case 'core.process': {
            const process = portfolio.processes.find(value => value.id === reference.id);
            if (!process) return null;
            if (process.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.process', process.id), process.title, {
                mode: process.mode,
                createdAt: process.createdAt,
                updatedAt: process.updatedAt,
                ...(process.description?.trim() ? { description: text(process.description, '') } : {}),
            }, omitted);
        }
        case 'core.process-folder': {
            const folder = portfolio.processFolders.find(value => value.id === reference.id);
            if (!folder) return null;
            if (folder.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.process-folder', folder.id), folder.title, {
                ...(folder.createdAt ? { createdAt: folder.createdAt } : {}),
            }, omitted);
        }
        case 'core.node': {
            const located = findGraphEntityLocation(portfolio, 'core.node', reference.id, reference.location?.processId);
            const node = located?.graph.nodes.find(value => value.id === reference.id);
            if (!located || !node) return null;
            return snapshot(
                portfolioRevision,
                coreEntityReference('core.node', node.id, graphLocationHint(located)),
                node.label || 'Untitled step',
                nodeFields(node, located, omitted),
                omitted,
            );
        }
        case 'core.edge': {
            const located = findGraphEntityLocation(portfolio, 'core.edge', reference.id, reference.location?.processId);
            const edge = located?.graph.edges.find(value => value.id === reference.id);
            if (!located || !edge) return null;
            if (edge.extensions) omitted.add('extensions');
            return snapshot(
                portfolioRevision,
                coreEntityReference('core.edge', edge.id, graphLocationHint(located)),
                edge.label || 'Unlabelled connection',
                {
                    processId: located.process.id,
                    graphId: located.graphId,
                    style: edge.style,
                    ...(edge.type ? { edgeType: edge.type } : {}),
                    ...(edge.animated !== undefined ? { animated: edge.animated } : {}),
                    ...(edge.routingMode ? { routingMode: edge.routingMode } : {}),
                },
                omitted,
            );
        }
        case 'core.swimlane': {
            const located = findGraphEntityLocation(portfolio, 'core.swimlane', reference.id, reference.location?.processId);
            const lane = located?.graph.swimlanes.find(value => value.id === reference.id);
            if (!located || !lane) return null;
            if (lane.extensions) omitted.add('extensions');
            return snapshot(
                portfolioRevision,
                coreEntityReference('core.swimlane', lane.id, graphLocationHint(located)),
                lane.label,
                {
                    processId: located.process.id,
                    graphId: located.graphId,
                    color: lane.color,
                    order: lane.order,
                    height: lane.height,
                    ...(typeof lane.width === 'number' ? { width: lane.width } : {}),
                },
                omitted,
            );
        }
        case 'core.asset': {
            const asset = portfolio.assets.find(value => value.id === reference.id);
            if (!asset) return null;
            if (asset.metadata) omitted.add('metadata');
            if (asset.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.asset', asset.id), asset.name, {}, omitted);
        }
        case 'core.asset-category': {
            const category = portfolio.assetCategories.find(value => value.id === reference.id);
            if (!category) return null;
            if (category.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.asset-category', category.id), category.label, {
                icon: category.icon,
                color: category.color,
                ...(category.baseType ? { baseType: category.baseType } : {}),
            }, omitted);
        }
        case 'core.journal-entry': {
            const entry = portfolio.journal.entries.find(value => value.id === reference.id);
            if (!entry) return null;
            omitted.add('content');
            if (entry.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.journal-entry', entry.id), entry.title, {
                contentFormat: entry.contentFormat,
                contentVersion: entry.contentVersion,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
            }, omitted);
        }
        case 'core.journal-notebook': {
            const notebook = portfolio.journal.notebooks.find(value => value.id === reference.id);
            if (!notebook) return null;
            if (notebook.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.journal-notebook', notebook.id), notebook.title, {
                createdAt: notebook.createdAt,
                updatedAt: notebook.updatedAt,
            }, omitted);
        }
        case 'core.journal-folder': {
            const folder = portfolio.journal.folders.find(value => value.id === reference.id);
            if (!folder) return null;
            if (folder.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.journal-folder', folder.id), folder.title, {
                createdAt: folder.createdAt,
            }, omitted);
        }
        case 'core.tag': {
            const tag = portfolio.journal.tags.find(value => value.id === reference.id);
            if (!tag) return null;
            if (tag.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.tag', tag.id), tag.label, {
                color: tag.color,
                ...(tag.archived !== undefined ? { archived: tag.archived } : {}),
            }, omitted);
        }
        case 'core.incident': {
            const incident = portfolio.incidents.find(value => value.id === reference.id);
            if (!incident) return null;
            if (incident.extensions) omitted.add('extensions');
            return snapshot(portfolioRevision, coreEntityReference('core.incident', incident.id), incident.title, {
                createdAt: incident.createdAt,
                findingCount: incident.findings.length,
            }, omitted);
        }
        case 'core.finding': {
            const incident = portfolio.incidents.find(value => (
                value.findings.some(finding => finding.id === reference.id)
            ));
            const finding = incident?.findings.find(value => value.id === reference.id);
            if (!incident || !finding) return null;
            if (finding.extensions) omitted.add('extensions');
            return snapshot(
                portfolioRevision,
                coreEntityReference('core.finding', finding.id, { incidentId: incident.id }),
                finding.text,
                { timestamp: finding.timestamp },
                omitted,
            );
        }
        default: {
            const semanticData = portfolio.plugins?.semanticData;
            if (!semanticData) return null;
            const record = semanticData.records.find(value => (
                value.type === reference.kind && value.id === reference.id
            ));
            if (record) {
                const properties = boundedSemanticProperties(record.properties, omitted);
                omitted.add('provenance.sources');
                return snapshot(portfolioRevision, pluginEntityReference(record.type, record.id), record.label, {
                    semanticKind: 'record',
                    owner: cloneJson(record.owner) as unknown as JsonValue,
                    provenance: provenanceSummary(record.provenance),
                    createdAt: record.createdAt,
                    updatedAt: record.updatedAt,
                    ...(properties ? { properties } : {}),
                }, omitted);
            }
            const relation = semanticData.relations.find(value => (
                value.type === reference.kind && value.id === reference.id
            ));
            if (relation) {
                const properties = boundedSemanticProperties(relation.properties, omitted);
                omitted.add('provenance.sources');
                return snapshot(portfolioRevision, pluginEntityReference(relation.type, relation.id), relation.type, {
                    semanticKind: 'relation',
                    owner: cloneJson(relation.owner) as unknown as JsonValue,
                    provenance: provenanceSummary(relation.provenance),
                    source: cloneJson(refreshReference(portfolio, relation.source)) as unknown as JsonValue,
                    target: cloneJson(refreshReference(portfolio, relation.target)) as unknown as JsonValue,
                    createdAt: relation.createdAt,
                    updatedAt: relation.updatedAt,
                    ...(properties ? { properties } : {}),
                }, omitted);
            }
            const annotation = semanticData.annotations.find(value => (
                value.type === reference.kind && value.id === reference.id
            ));
            if (!annotation) return null;
            const properties = boundedSemanticProperties(annotation.properties, omitted);
            omitted.add('provenance.sources');
            return snapshot(portfolioRevision, pluginEntityReference(annotation.type, annotation.id), annotation.type, {
                semanticKind: 'annotation',
                owner: cloneJson(annotation.owner) as unknown as JsonValue,
                provenance: provenanceSummary(annotation.provenance),
                target: cloneJson(refreshReference(portfolio, annotation.target)) as unknown as JsonValue,
                createdAt: annotation.createdAt,
                updatedAt: annotation.updatedAt,
                ...(properties ? { properties } : {}),
            }, omitted);
        }
    }
}

const legacyReference = (
    portfolio: Portfolio,
    reference: EntityReference,
): UniversalEntityReference | null => {
    const mapping: Partial<Record<EntityReference['type'], CoreEntityKind>> = {
        process: 'core.process',
        node: 'core.node',
        asset: 'core.asset',
        journalEntry: 'core.journal-entry',
        tag: 'core.tag',
        incident: 'core.incident',
    };
    const kind = mapping[reference.type];
    if (!kind) return null;
    if (kind === 'core.node') {
        const located = findGraphEntityLocation(portfolio, kind, reference.id, reference.processId);
        return located ? coreEntityReference(kind, reference.id, graphLocationHint(located)) : null;
    }
    return coreEntityReference(kind, reference.id);
};

const cursorOffset = (cursor: string | undefined, revision: number): number => {
    if (!cursor) return 0;
    const match = CURSOR_PATTERN.exec(cursor);
    if (!match) throw new PluginRelationCursorError('Relation cursor has an invalid format.', cursor);
    const cursorRevision = Number(match[1]);
    const offset = Number(match[2]);
    if (cursorRevision !== revision) {
        throw new PluginRelationCursorError(
            `Portfolio changed from relation cursor revision ${cursorRevision} to ${revision}. Restart the query.`,
            cursor,
        );
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new PluginRelationCursorError('Relation cursor offset is invalid.', cursor);
    }
    return offset;
};

const relationTouches = (
    relation: PluginEntityRelation,
    reference: UniversalEntityReference,
    direction: PluginRelationDirection,
): boolean => (
    (direction !== 'incoming' && sameEntityIdentity(relation.source, reference))
    || (direction !== 'outgoing' && sameEntityIdentity(relation.target, reference))
);

export function queryPluginEntityRelations(
    portfolio: Portfolio,
    input: unknown,
    portfolioRevision: number,
): PluginEntityRelationPage {
    const query: PluginEntityRelationQuery = parsePluginEntityRelationQuery(input);
    const requestedReference = refreshReference(portfolio, query.reference);
    const offset = cursorOffset(query.cursor, portfolioRevision);
    const allowedKinds = query.relationKinds ? new Set(query.relationKinds) : null;
    const byKey = new Map<string, PluginEntityRelation>();
    let truncated = false;

    const consider = (relation: PluginEntityRelation): void => {
        if (allowedKinds && !allowedKinds.has(relation.kind)) return;
        if (!relationTouches(relation, requestedReference, query.direction)) return;
        const parsed = PluginEntityRelationSchema.parse(relation);
        const key = `${parsed.kind}\u0000${parsed.id}\u0000${parsed.source.kind}\u0000${parsed.source.id}\u0000${parsed.target.kind}\u0000${parsed.target.id}`;
        if (byKey.has(key)) return;
        if (byKey.size >= MAX_PLUGIN_RELATION_MATCHES) {
            truncated = true;
            return;
        }
        byKey.set(key, parsed);
    };
    const coreRelation = (
        kind: `core.relation.${string}`,
        id: string,
        source: UniversalEntityReference,
        target: UniversalEntityReference,
        options: { relationReference?: UniversalEntityReference; label?: string } = {},
    ) => consider({
        id,
        kind,
        origin: 'core',
        source,
        target,
        ...options,
    });

    portfolio.processes.forEach(process => {
        const processReference = coreEntityReference('core.process', process.id);
        if (process.folderId && portfolio.processFolders.some(folder => folder.id === process.folderId)) {
            coreRelation(
                'core.relation.process-folder',
                `process-folder:${process.id}:${process.folderId}`,
                processReference,
                coreEntityReference('core.process-folder', process.folderId),
            );
        }
        if (process.ownerId && portfolio.assets.some(asset => asset.id === process.ownerId)) {
            coreRelation(
                'core.relation.process-owner',
                `process-owner:${process.id}:${process.ownerId}`,
                processReference,
                coreEntityReference('core.asset', process.ownerId),
            );
        }

        listProcessGraphLocations(process).forEach(located => {
            const location = graphLocationHint(located);
            const nodesById = new Map(located.graph.nodes.map(node => [node.id, node]));
            const lanesById = new Map(located.graph.swimlanes.map(lane => [lane.id, lane]));
            located.graph.nodes.forEach(node => {
                const nodeReference = coreEntityReference('core.node', node.id, location);
                coreRelation(
                    'core.relation.process-node',
                    `process-node:${process.id}:${located.graphId}:${node.id}`,
                    processReference,
                    nodeReference,
                );
                (node.assetIds || []).forEach(assetId => {
                    if (!portfolio.assets.some(asset => asset.id === assetId)) return;
                    coreRelation(
                        'core.relation.node-asset',
                        `node-asset:${node.id}:${assetId}`,
                        nodeReference,
                        coreEntityReference('core.asset', assetId),
                    );
                });
                if (node.swimlaneId && lanesById.has(node.swimlaneId)) {
                    coreRelation(
                        'core.relation.node-swimlane',
                        `node-swimlane:${node.id}:${node.swimlaneId}`,
                        nodeReference,
                        coreEntityReference('core.swimlane', node.swimlaneId, location),
                    );
                }
                if (node.parentId && nodesById.has(node.parentId)) {
                    coreRelation(
                        'core.relation.node-parent',
                        `node-parent:${node.id}:${node.parentId}`,
                        nodeReference,
                        coreEntityReference('core.node', node.parentId, location),
                    );
                }
            });
            located.graph.edges.forEach(edge => {
                const edgeReference = coreEntityReference('core.edge', edge.id, location);
                coreRelation(
                    'core.relation.process-edge',
                    `process-edge:${process.id}:${located.graphId}:${edge.id}`,
                    processReference,
                    edgeReference,
                );
                if (nodesById.has(edge.sourceId) && nodesById.has(edge.targetId)) {
                    coreRelation(
                        'core.relation.flow',
                        `flow:${edge.id}`,
                        coreEntityReference('core.node', edge.sourceId, location),
                        coreEntityReference('core.node', edge.targetId, location),
                        {
                            relationReference: edgeReference,
                            ...(edge.label?.trim() ? { label: text(edge.label, '') } : {}),
                        },
                    );
                }
            });
            located.graph.swimlanes.forEach(lane => {
                coreRelation(
                    'core.relation.process-swimlane',
                    `process-swimlane:${process.id}:${located.graphId}:${lane.id}`,
                    processReference,
                    coreEntityReference('core.swimlane', lane.id, location),
                );
            });
        });
    });

    portfolio.assets.forEach(asset => {
        const assetReference = coreEntityReference('core.asset', asset.id);
        if (portfolio.assetCategories.some(category => category.id === asset.type)) {
            coreRelation(
                'core.relation.asset-category',
                `asset-category:${asset.id}:${asset.type}`,
                assetReference,
                coreEntityReference('core.asset-category', asset.type),
            );
        }
        if (asset.parentId && portfolio.assets.some(candidate => candidate.id === asset.parentId)) {
            coreRelation(
                'core.relation.asset-parent',
                `asset-parent:${asset.id}:${asset.parentId}`,
                assetReference,
                coreEntityReference('core.asset', asset.parentId),
            );
        }
    });

    portfolio.journal.notebooks.forEach(notebook => {
        if (!notebook.folderId || !portfolio.journal.folders.some(folder => folder.id === notebook.folderId)) return;
        coreRelation(
            'core.relation.notebook-folder',
            `notebook-folder:${notebook.id}:${notebook.folderId}`,
            coreEntityReference('core.journal-notebook', notebook.id),
            coreEntityReference('core.journal-folder', notebook.folderId),
        );
    });
    portfolio.journal.entries.forEach(entry => {
        const entryReference = coreEntityReference('core.journal-entry', entry.id);
        if (portfolio.journal.notebooks.some(notebook => notebook.id === entry.notebookId)) {
            coreRelation(
                'core.relation.entry-notebook',
                `entry-notebook:${entry.id}:${entry.notebookId}`,
                entryReference,
                coreEntityReference('core.journal-notebook', entry.notebookId),
            );
        }
        (entry.tags || []).forEach(tagId => {
            if (!portfolio.journal.tags.some(tag => tag.id === tagId)) return;
            coreRelation(
                'core.relation.entry-tag',
                `entry-tag:${entry.id}:${tagId}`,
                entryReference,
                coreEntityReference('core.tag', tagId),
            );
        });
        (entry.linkedContext || []).forEach((linked, index) => {
            const target = legacyReference(portfolio, linked);
            if (!target) return;
            coreRelation(
                'core.relation.entry-context',
                `entry-context:${entry.id}:${index}:${target.kind}:${target.id}`,
                entryReference,
                target,
            );
        });
    });

    portfolio.incidents.forEach(incident => {
        const incidentReference = coreEntityReference('core.incident', incident.id);
        incident.findings.forEach(finding => {
            const findingReference = coreEntityReference('core.finding', finding.id, { incidentId: incident.id });
            coreRelation(
                'core.relation.finding-incident',
                `finding-incident:${finding.id}:${incident.id}`,
                findingReference,
                incidentReference,
            );
            finding.linkedNodeIds.forEach(nodeId => {
                const located = findGraphEntityLocation(portfolio, 'core.node', nodeId);
                if (!located) return;
                coreRelation(
                    'core.relation.finding-node',
                    `finding-node:${finding.id}:${nodeId}`,
                    findingReference,
                    coreEntityReference('core.node', nodeId, graphLocationHint(located)),
                );
            });
        });
    });

    portfolio.plugins?.semanticData.relations.forEach(relation => consider({
        id: `semantic-relation:${relation.type}:${relation.id}`,
        kind: relation.type,
        origin: 'semantic',
        source: refreshReference(portfolio, relation.source),
        target: refreshReference(portfolio, relation.target),
        relationReference: pluginEntityReference(relation.type, relation.id),
    }));
    portfolio.plugins?.semanticData.annotations.forEach(annotation => consider({
        id: `semantic-annotation:${annotation.type}:${annotation.id}`,
        kind: 'core.relation.annotation',
        origin: 'semantic',
        source: refreshReference(portfolio, annotation.target),
        target: pluginEntityReference(annotation.type, annotation.id),
        relationReference: pluginEntityReference(annotation.type, annotation.id),
    }));

    const items = [...byKey.values()].sort((left, right) => (
        left.kind.localeCompare(right.kind)
        || left.source.kind.localeCompare(right.source.kind)
        || left.source.id.localeCompare(right.source.id)
        || left.target.kind.localeCompare(right.target.kind)
        || left.target.id.localeCompare(right.target.id)
        || left.id.localeCompare(right.id)
    ));
    const pageItems = items.slice(offset, offset + query.limit);
    const nextOffset = offset + pageItems.length;
    const nextCursor = nextOffset < items.length
        ? `v1:${portfolioRevision}:${nextOffset}`
        : null;

    return deepFreeze(PluginEntityRelationPageSchema.parse({
        schema: 'axiom.plugin.relation-page',
        schemaVersion: 1,
        portfolioRevision,
        reference: requestedReference,
        direction: query.direction,
        items: pageItems,
        nextCursor,
        truncated,
    }));
}
