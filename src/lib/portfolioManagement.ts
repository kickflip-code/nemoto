import type { CanvasGraph, Portfolio } from '../types';
import { inspectPortfolioIntegrity, type PortfolioIntegrityIssue } from './portfolioIntegrity';
import { getLegacyResourceReferenceAssetIds } from './resourceReferences';

export interface PortfolioContentCounts {
    processes: number;
    assets: number;
    journalEntries: number;
    notebooks: number;
}

export interface PortfolioAttentionSummary {
    unusedAssetIds: string[];
    unlinkedJournalEntryIds: string[];
    emptyNotebookIds: string[];
    integrityIssues: PortfolioIntegrityIssue[];
    total: number;
}

export interface PortfolioManagementSummary {
    counts: PortfolioContentCounts;
    attention: PortfolioAttentionSummary;
}

function collectGraphAssetReferences(graph: CanvasGraph, references: Set<string>): void {
    graph.nodes.forEach(node => {
        node.assetIds?.forEach(id => references.add(id));
        getLegacyResourceReferenceAssetIds(node).forEach(id => references.add(id));
    });
}

export function collectReferencedAssetIds(portfolio: Portfolio): Set<string> {
    const references = new Set<string>();

    portfolio.processes.forEach(process => {
        if (process.ownerId) references.add(process.ownerId);
        collectGraphAssetReferences(process.graph, references);
        Object.values(process.subGraphs || {}).forEach(graph => collectGraphAssetReferences(graph, references));
    });

    portfolio.journal.entries.forEach(entry => {
        entry.linkedContext?.forEach(reference => {
            if (reference.type === 'asset') references.add(reference.id);
        });
    });

    portfolio.assets.forEach(asset => {
        if (asset.parentId) references.add(asset.parentId);
    });

    return references;
}

export function createPortfolioManagementSummary(portfolio: Portfolio): PortfolioManagementSummary {
    const referencedAssetIds = collectReferencedAssetIds(portfolio);
    const unusedAssetIds = portfolio.assets
        .filter(asset => !referencedAssetIds.has(asset.id))
        .map(asset => asset.id);
    const unlinkedJournalEntryIds = portfolio.journal.entries
        .filter(entry => !entry.linkedContext || entry.linkedContext.length === 0)
        .map(entry => entry.id);
    const notebooksWithEntries = new Set(portfolio.journal.entries.map(entry => entry.notebookId));
    const emptyNotebookIds = portfolio.journal.notebooks
        .filter(notebook => !notebooksWithEntries.has(notebook.id))
        .map(notebook => notebook.id);
    const integrityIssues = inspectPortfolioIntegrity(portfolio).issues;

    return {
        counts: {
            processes: portfolio.processes.length,
            assets: portfolio.assets.length,
            journalEntries: portfolio.journal.entries.length,
            notebooks: portfolio.journal.notebooks.length,
        },
        attention: {
            unusedAssetIds,
            unlinkedJournalEntryIds,
            emptyNotebookIds,
            integrityIssues,
            total: unusedAssetIds.length
                + unlinkedJournalEntryIds.length
                + emptyNotebookIds.length
                + integrityIssues.length,
        },
    };
}
