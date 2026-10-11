import type { ImportedPortfolio, Portfolio } from '../../types';
import { mergeImportedPortfolioLogic } from './importActions';
import type { PluginImportReviewRow } from '../../plugins/portableRecordImport';

export interface PreparedPluginImport {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly rows: readonly PluginImportReviewRow[];
    readonly mergedItemCount: number;
}
const prepared = new WeakMap<PreparedPluginImport, {
    targetJson: string; sourceJson: string; revision: number;
    candidate: Portfolio;
}>();

export function preparePluginImport(target: Portfolio, source: ImportedPortfolio, revision: number): PreparedPluginImport {
    const result = mergeImportedPortfolioLogic(target, source);
    const plan: PreparedPluginImport = Object.freeze({ sourceId: source.id, sourceName: source.sourceName,
        rows: Object.freeze(result.pluginReview.map(row => Object.freeze({ ...row }))), mergedItemCount: result.mergedItemCount });
    prepared.set(plan, { targetJson: JSON.stringify(target), sourceJson: JSON.stringify(source), revision,
        candidate: structuredClone(result.portfolio) });
    return plan;
}

export function commitPluginImport(plan: PreparedPluginImport, target: Portfolio, source: ImportedPortfolio,
    revision: number): Portfolio {
    const state = prepared.get(plan);
    if (!state || state.revision !== revision || state.targetJson !== JSON.stringify(target)
        || state.sourceJson !== JSON.stringify(source)) {
        throw new Error('The import preview is stale. Review the import again; nothing was merged.');
    }
    prepared.delete(plan);
    return structuredClone(state.candidate);
}
