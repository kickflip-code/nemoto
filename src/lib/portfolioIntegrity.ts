import { laneAxis } from './canvasDivision';
import type { CanvasGraph, Portfolio, Process } from '../types';
import {
    inspectPortfolioPluginData,
    type PluginPortfolioIntegrityIssueCode,
    type PluginPortfolioIntegrityOptions,
} from '../plugins/portfolioDataIntegrity';
import { createEntityResolverIndex, resolveEntityReference } from './entityResolver';
import { getLegacyResourceReferenceAssetIds, getResourceReferenceAssetId } from './resourceReferences';

export type IntegrityIssueCode = PluginPortfolioIntegrityIssueCode
    | 'duplicate-id'
    | 'dangling-edge-source'
    | 'dangling-edge-target'
    | 'dangling-node-parent'
    | 'dangling-swimlane-reference'
    | 'dangling-asset-reference'
    | 'missing-resource-reference'
    | 'conflicting-resource-reference'
    | 'dangling-asset-category'
    | 'dangling-asset-parent'
    | 'dangling-subgraph-reference'
    | 'unreachable-subgraph'
    | 'subgraph-cycle'
    | 'dangling-folder-reference'
    | 'process-folder-cycle'
    | 'dangling-owner-reference'
    | 'dangling-journal-reference'
    | 'dangling-notebook-reference'
    | 'dangling-journal-folder-reference'
    | 'journal-folder-cycle'
    | 'dangling-tag-reference'
    | 'dangling-finding-node-reference';

export interface PortfolioIntegrityIssue {
    severity: 'error' | 'warning';
    code: IntegrityIssueCode;
    path: string;
    message: string;
    id?: string;
}

export interface PortfolioIntegrityReport {
    valid: boolean;
    errors: PortfolioIntegrityIssue[];
    warnings: PortfolioIntegrityIssue[];
    issues: PortfolioIntegrityIssue[];
}

interface RegisteredId {
    kind: string;
    path: string;
}

interface FolderLike {
    id: string;
    parentId?: string | null;
}

function inspectFolderCycles(
    folders: FolderLike[],
    pathPrefix: string,
    label: string,
    code: 'process-folder-cycle' | 'journal-folder-cycle',
    issues: PortfolioIntegrityIssue[],
): void {
    const foldersById = new Map(folders.map((folder, index) => [folder.id, { folder, index }]));
    const state = new Map<string, 'visiting' | 'visited'>();
    const stack: string[] = [];

    const visit = (folderId: string): void => {
        state.set(folderId, 'visiting');
        stack.push(folderId);

        const current = foldersById.get(folderId)?.folder;
        const parentId = current?.parentId;
        if (parentId && foldersById.has(parentId)) {
            const parentState = state.get(parentId);
            if (!parentState) {
                visit(parentId);
            } else if (parentState === 'visiting') {
                const cycleStart = stack.indexOf(parentId);
                const cycleIds = stack.slice(cycleStart);
                const representative = foldersById.get(cycleIds[0]);
                if (representative) {
                    issues.push({
                        severity: 'error',
                        code,
                        path: `${pathPrefix}[${representative.index}].parentId`,
                        id: representative.folder.id,
                        message: `${label} cycle detected: ${cycleIds.join(' -> ')} -> ${parentId}.`,
                    });
                }
            }
        }

        stack.pop();
        state.set(folderId, 'visited');
    };

    folders.forEach(folder => {
        if (!state.has(folder.id)) visit(folder.id);
    });
}

function inspectSubgraphCycles(
    process: Process,
    processPath: string,
    issues: PortfolioIntegrityIssue[],
): void {
    const subGraphs = process.subGraphs || {};
    const state = new Map<string, 'visiting' | 'visited'>();
    const stack: string[] = [];

    const visit = (subGraphId: string): void => {
        state.set(subGraphId, 'visiting');
        stack.push(subGraphId);

        const graph = subGraphs[subGraphId];
        const childIds = new Set(
            (graph?.nodes || [])
                .map(node => node.subGraphId)
                .filter((id): id is string => !!id && !!subGraphs[id]),
        );
        childIds.forEach(childId => {
            const childState = state.get(childId);
            if (!childState) {
                visit(childId);
            } else if (childState === 'visiting') {
                const cycleStart = stack.indexOf(childId);
                const cycleIds = stack.slice(cycleStart);
                issues.push({
                    severity: 'error',
                    code: 'subgraph-cycle',
                    path: `${processPath}.subGraphs.${subGraphId}`,
                    id: subGraphId,
                    message: `Subgraph cycle detected in process '${process.id}': ${cycleIds.join(' -> ')} -> ${childId}.`,
                });
            }
        });

        stack.pop();
        state.set(subGraphId, 'visited');
    };

    Object.keys(subGraphs).forEach(subGraphId => {
        if (!state.has(subGraphId)) visit(subGraphId);
    });
}

function inspectGraph(
    graph: CanvasGraph,
    process: Process,
    path: string,
    assetIds: Set<string>,
    registerId: (id: string, kind: string, path: string) => void,
    issues: PortfolioIntegrityIssue[],
    referencedSubGraphs: Set<string>,
    allNodeIds: Set<string>,
): void {
    const nodeIds = new Set<string>();
    const laneIds = new Set(graph.swimlanes.map(lane => lane.id));

    graph.nodes.forEach((node, index) => {
        const nodePath = `${path}.nodes[${index}]`;
        registerId(node.id, 'node', nodePath);
        nodeIds.add(node.id);
        allNodeIds.add(node.id);

        (node.assetIds || []).forEach(assetId => {
            if (!assetIds.has(assetId)) {
                issues.push({
                    severity: 'error',
                    code: 'dangling-asset-reference',
                    path: `${nodePath}.assetIds`,
                    id: assetId,
                    message: `Node '${node.id}' references missing asset '${assetId}'.`,
                });
            }
        });

        if (node.type === 'resource') {
            const resourceAssetId = getResourceReferenceAssetId(node);
            const canonicalAssetId = node.assetIds?.find(id => typeof id === 'string' && id.length > 0);
            const legacyAssetIds = getLegacyResourceReferenceAssetIds(node);

            if (!resourceAssetId) {
                issues.push({
                    severity: 'error',
                    code: 'missing-resource-reference',
                    path: nodePath,
                    message: `Placed resource node '${node.id}' does not reference a central asset.`,
                });
            } else if (!canonicalAssetId && !assetIds.has(resourceAssetId)) {
                issues.push({
                    severity: 'error',
                    code: 'dangling-asset-reference',
                    path: `${nodePath}.data`,
                    id: resourceAssetId,
                    message: `Placed resource node '${node.id}' references missing asset '${resourceAssetId}'.`,
                });
            }

            if (canonicalAssetId && legacyAssetIds.some(legacyAssetId => legacyAssetId !== canonicalAssetId)) {
                issues.push({
                    severity: 'error',
                    code: 'conflicting-resource-reference',
                    path: nodePath,
                    id: node.id,
                    message: `Placed resource node '${node.id}' contains conflicting canonical and legacy asset references.`,
                });
            }
        }

        if (node.subGraphId) {
            referencedSubGraphs.add(node.subGraphId);
            if (!process.subGraphs?.[node.subGraphId]) {
                issues.push({
                    severity: 'error',
                    code: 'dangling-subgraph-reference',
                    path: `${nodePath}.subGraphId`,
                    id: node.subGraphId,
                    message: `Node '${node.id}' references missing subgraph '${node.subGraphId}'.`,
                });
            }
        }
    });

    graph.nodes.forEach((node, index) => {
        const nodePath = `${path}.nodes[${index}]`;
        if (node.parentId && !nodeIds.has(node.parentId) && !laneIds.has(node.parentId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-node-parent',
                path: `${nodePath}.parentId`,
                id: node.parentId,
                message: `Node '${node.id}' references missing parent '${node.parentId}' in its graph.`,
            });
        }
        for (const [key, axis] of [['rowId', 'row'], ['columnId', 'column']] as const) {
            const id = node[key];
            if (id && !graph.swimlanes.some(lane => lane.id === id && laneAxis(graph, lane) === axis)) {
                issues.push({ severity: 'error', code: 'dangling-swimlane-reference', path: `${nodePath}.${key}`, id,
                    message: `Node '${node.id}' references missing ${axis} '${id}'.` });
            }
        }
        if (node.swimlaneId && !laneIds.has(node.swimlaneId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-swimlane-reference',
                path: `${nodePath}.swimlaneId`,
                id: node.swimlaneId,
                message: `Node '${node.id}' references missing swimlane '${node.swimlaneId}'.`,
            });
        }
    });

    graph.edges.forEach((edge, index) => {
        const edgePath = `${path}.edges[${index}]`;
        registerId(edge.id, 'edge', edgePath);
        if (!nodeIds.has(edge.sourceId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-edge-source',
                path: `${edgePath}.sourceId`,
                id: edge.sourceId,
                message: `Edge '${edge.id}' references missing source node '${edge.sourceId}'.`,
            });
        }
        if (!nodeIds.has(edge.targetId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-edge-target',
                path: `${edgePath}.targetId`,
                id: edge.targetId,
                message: `Edge '${edge.id}' references missing target node '${edge.targetId}'.`,
            });
        }
    });

    graph.swimlanes.forEach((lane, index) => {
        registerId(lane.id, 'swimlane', `${path}.swimlanes[${index}]`);
    });
}

/** Read-only referential-integrity audit. It never rewrites legacy IDs. */
export function inspectPortfolioIntegrity(
    portfolio: Portfolio,
    options: PluginPortfolioIntegrityOptions = {},
): PortfolioIntegrityReport {
    const issues: PortfolioIntegrityIssue[] = [];
    const registry = new Map<string, RegisteredId>();
    const registerId = (id: string, kind: string, path: string) => {
        const existing = registry.get(id);
        if (existing) {
            issues.push({
                severity: 'error',
                code: 'duplicate-id',
                path,
                id,
                message: `ID '${id}' is used by both ${existing.kind} at ${existing.path} and ${kind} at ${path}.`,
            });
            return;
        }
        registry.set(id, { kind, path });
    };

    const folderIds = new Set(portfolio.processFolders.map(folder => folder.id));
    const assetIds = new Set(portfolio.assets.map(asset => asset.id));
    const categoryIds = new Set(portfolio.assetCategories.map(category => category.id));
    const journalFolderIds = new Set(portfolio.journal.folders.map(folder => folder.id));
    const notebookIds = new Set(portfolio.journal.notebooks.map(notebook => notebook.id));
    const tagIds = new Set(portfolio.journal.tags.map(tag => tag.id));
    const allNodeIds = new Set<string>();

    portfolio.assetCategories.forEach((category, index) => registerId(category.id, 'asset category', `assetCategories[${index}]`));
    portfolio.assets.forEach((asset, index) => {
        const path = `assets[${index}]`;
        registerId(asset.id, 'asset', path);
        if (!categoryIds.has(asset.type)) {
            issues.push({
                severity: 'error',
                code: 'dangling-asset-category',
                path: `${path}.type`,
                id: asset.type,
                message: `Asset '${asset.id}' references missing category '${asset.type}'.`,
            });
        }
        if (asset.parentId && !assetIds.has(asset.parentId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-asset-parent',
                path: `${path}.parentId`,
                id: asset.parentId,
                message: `Asset '${asset.id}' references missing parent asset '${asset.parentId}'.`,
            });
        }
    });
    portfolio.processFolders.forEach((folder, index) => {
        const path = `processFolders[${index}]`;
        registerId(folder.id, 'process folder', path);
        if (folder.parentId && !folderIds.has(folder.parentId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-folder-reference',
                path: `${path}.parentId`,
                id: folder.parentId,
                message: `Process folder '${folder.id}' references missing parent folder '${folder.parentId}'.`,
            });
        }
    });
    inspectFolderCycles(portfolio.processFolders, 'processFolders', 'Process folder', 'process-folder-cycle', issues);

    portfolio.processes.forEach((process, processIndex) => {
        const processPath = `processes[${processIndex}]`;
        registerId(process.id, 'process', processPath);
        if (process.folderId && !folderIds.has(process.folderId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-folder-reference',
                path: `${processPath}.folderId`,
                id: process.folderId,
                message: `Process '${process.id}' references missing folder '${process.folderId}'.`,
            });
        }
        if (process.ownerId && !assetIds.has(process.ownerId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-owner-reference',
                path: `${processPath}.ownerId`,
                id: process.ownerId,
                message: `Process '${process.id}' references missing owner asset '${process.ownerId}'.`,
            });
        }

        const referencedSubGraphs = new Set<string>();
        inspectGraph(process.graph, process, `${processPath}.graph`, assetIds, registerId, issues, referencedSubGraphs, allNodeIds);
        Object.entries(process.subGraphs || {}).forEach(([subGraphId, graph]) => {
            registerId(subGraphId, 'subgraph', `${processPath}.subGraphs.${subGraphId}`);
            inspectGraph(graph, process, `${processPath}.subGraphs.${subGraphId}`, assetIds, registerId, issues, referencedSubGraphs, allNodeIds);
        });
        inspectSubgraphCycles(process, processPath, issues);
        Object.keys(process.subGraphs || {}).forEach(subGraphId => {
            if (!referencedSubGraphs.has(subGraphId)) {
                issues.push({
                    severity: 'warning',
                    code: 'unreachable-subgraph',
                    path: `${processPath}.subGraphs.${subGraphId}`,
                    id: subGraphId,
                    message: `Subgraph '${subGraphId}' is not referenced by any node in process '${process.id}'.`,
                });
            }
        });
    });

    portfolio.journal.folders.forEach((folder, index) => {
        const path = `journal.folders[${index}]`;
        registerId(folder.id, 'journal folder', path);
        if (folder.parentId && !journalFolderIds.has(folder.parentId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-journal-folder-reference',
                path: `${path}.parentId`,
                id: folder.parentId,
                message: `Journal folder '${folder.id}' references missing parent folder '${folder.parentId}'.`,
            });
        }
    });
    inspectFolderCycles(portfolio.journal.folders, 'journal.folders', 'Journal folder', 'journal-folder-cycle', issues);
    portfolio.journal.notebooks.forEach((notebook, index) => {
        const path = `journal.notebooks[${index}]`;
        registerId(notebook.id, 'notebook', path);
        if (notebook.folderId && !journalFolderIds.has(notebook.folderId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-journal-folder-reference',
                path: `${path}.folderId`,
                id: notebook.folderId,
                message: `Notebook '${notebook.id}' references missing journal folder '${notebook.folderId}'.`,
            });
        }
    });
    portfolio.journal.tags.forEach((tag, index) => registerId(tag.id, 'tag', `journal.tags[${index}]`));
    const entityResolverIndex = createEntityResolverIndex(portfolio);
    portfolio.journal.entries.forEach((entry, index) => {
        const entryPath = `journal.entries[${index}]`;
        registerId(entry.id, 'journal entry', entryPath);
        if (entry.notebookId && !notebookIds.has(entry.notebookId)) {
            issues.push({
                severity: 'error',
                code: 'dangling-notebook-reference',
                path: `${entryPath}.notebookId`,
                id: entry.notebookId,
                message: `Journal entry '${entry.id}' references missing notebook '${entry.notebookId}'.`,
            });
        }
        (entry.tags || []).forEach(tagId => {
            if (!tagIds.has(tagId)) {
                issues.push({
                    severity: 'error',
                    code: 'dangling-tag-reference',
                    path: `${entryPath}.tags`,
                    id: tagId,
                    message: `Journal entry '${entry.id}' references missing tag '${tagId}'.`,
                });
            }
        });
        (entry.linkedContext || []).forEach((reference, referenceIndex) => {
            if (!resolveEntityReference(reference, portfolio, entityResolverIndex)) {
                issues.push({
                    severity: 'warning',
                    code: 'dangling-journal-reference',
                    path: `${entryPath}.linkedContext[${referenceIndex}]`,
                    id: reference.id,
                    message: `Journal entry '${entry.id}' contains a dangling ${reference.type} reference '${reference.id}'.`,
                });
            }
        });
    });

    portfolio.incidents.forEach((incident, incidentIndex) => {
        registerId(incident.id, 'incident', `incidents[${incidentIndex}]`);
        incident.findings.forEach((finding, findingIndex) => {
            const findingPath = `incidents[${incidentIndex}].findings[${findingIndex}]`;
            registerId(finding.id, 'finding', findingPath);
            (finding.linkedNodeIds || []).forEach(nodeId => {
                if (!allNodeIds.has(nodeId)) {
                    issues.push({
                        severity: 'error',
                        code: 'dangling-finding-node-reference',
                        path: `${findingPath}.linkedNodeIds`,
                        id: nodeId,
                        message: `Finding '${finding.id}' references missing node '${nodeId}'.`,
                    });
                }
            });
        });
    });

    issues.push(...inspectPortfolioPluginData(portfolio, options));

    const errors = issues.filter(issue => issue.severity === 'error');
    const warnings = issues.filter(issue => issue.severity === 'warning');
    return { valid: errors.length === 0, errors, warnings, issues };
}
