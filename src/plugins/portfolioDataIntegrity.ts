import type { Portfolio } from '../types';
import type { PortfolioPluginRequirement } from './portfolioData';
import type { UniversalEntityReference } from './universalReference';
import { satisfiesVersionRange } from './versionRange';
import { PluginDataEnvelopeSchema } from './collectionStorage';
import { isPortableRecord, PortablePluginRecordSchema } from './portableRecords';

export type PluginPortfolioIntegrityIssueCode =
    | 'duplicate-plugin-requirement'
    | 'duplicate-semantic-identity'
    | 'undeclared-semantic-owner'
    | 'plugin-data-version-mismatch'
    | 'plugin-version-mismatch'
    | 'dangling-semantic-reference'
    | 'inactive-required-plugin'
    | 'missing-required-plugin'
    | 'missing-recommended-plugin'
    | 'incompatible-installed-plugin'
    | 'unsupported-portable-record'
    | 'duplicate-portable-record'
    | 'undeclared-portable-owner';

export interface PluginPortfolioIntegrityIssue {
    severity: 'error' | 'warning';
    code: PluginPortfolioIntegrityIssueCode;
    path: string;
    message: string;
    id?: string;
}

export interface PluginPortfolioIntegrityOptions {
    /** Omit when package availability is unknown. Values are installed versions. */
    availablePlugins?: Readonly<Record<string, string>>;
}

const semanticKey = (kind: string, id: string): string => `${kind}\u0000${id}`;

function resolveCoreReference(reference: UniversalEntityReference, portfolio: Portfolio): boolean {
    switch (reference.kind) {
        case 'core.process':
            return portfolio.processes.some(process => process.id === reference.id);
        case 'core.process-folder':
            return portfolio.processFolders.some(folder => folder.id === reference.id);
        case 'core.asset':
            return portfolio.assets.some(asset => asset.id === reference.id);
        case 'core.asset-category':
            return portfolio.assetCategories.some(category => category.id === reference.id);
        case 'core.journal-entry':
            return portfolio.journal.entries.some(entry => entry.id === reference.id);
        case 'core.journal-notebook':
            return portfolio.journal.notebooks.some(notebook => notebook.id === reference.id);
        case 'core.journal-folder':
            return portfolio.journal.folders.some(folder => folder.id === reference.id);
        case 'core.tag':
            return portfolio.journal.tags.some(tag => tag.id === reference.id);
        case 'core.incident':
            return portfolio.incidents.some(incident => incident.id === reference.id);
        case 'core.finding':
            return portfolio.incidents.some(incident => (
                incident.findings.some(finding => finding.id === reference.id)
            ));
        case 'core.node':
        case 'core.edge':
        case 'core.swimlane': {
            // Location is only a resolution hint. Stable IDs remain resolvable
            // after an entity moves to another process or drill-down graph.
            const graphs = portfolio.processes.flatMap(process => ([
                process.graph,
                ...Object.values(process.subGraphs || {}),
            ]));
            if (reference.kind === 'core.node') {
                return graphs.some(graph => graph.nodes.some(node => node.id === reference.id));
            }
            if (reference.kind === 'core.edge') {
                return graphs.some(graph => graph.edges.some(edge => edge.id === reference.id));
            }
            return graphs.some(graph => graph.swimlanes.some(lane => lane.id === reference.id));
        }
        default:
            return false;
    }
}

export function doesUniversalReferenceResolve(
    reference: UniversalEntityReference,
    portfolio: Portfolio,
): boolean {
    if (reference.kind.startsWith('core.')) {
        return resolveCoreReference(reference, portfolio);
    }
    const semanticData = portfolio.plugins?.semanticData;
    if (!semanticData) return false;
    return [
        ...semanticData.records,
        ...semanticData.relations,
        ...semanticData.annotations,
    ].some(value => value.type === reference.kind && value.id === reference.id);
}

/**
 * Audits only the host-understood plugin state. The function is read-only and
 * remains useful when none of the defining plugins are installed.
 */
export function inspectPortfolioPluginData(
    portfolio: Portfolio,
    options: PluginPortfolioIntegrityOptions = {},
): PluginPortfolioIntegrityIssue[] {
    const issues: PluginPortfolioIntegrityIssue[] = [];
    for (const [pluginId, raw] of Object.entries(portfolio.extensions ?? {})) {
        const envelope = PluginDataEnvelopeSchema.safeParse(raw);
        if (!envelope.success) continue;
        const ids = new Set<string>();
        for (const [key, document] of Object.entries(envelope.data.documents)) {
            if (!isPortableRecord(document.value)) continue;
            const path = `extensions.${pluginId}.documents.${key}.value`;
            const parsed = PortablePluginRecordSchema.safeParse(document.value);
            if (!parsed.success) {
                issues.push({ severity: 'warning', code: 'unsupported-portable-record', path,
                    message: 'Unsupported portable record is preserved for recovery; it cannot be remapped by this build.' });
                continue;
            }
            if (ids.has(parsed.data.id)) issues.push({ severity: 'warning', code: 'duplicate-portable-record', path,
                message: 'Duplicate portable record identity is preserved for recovery; import is blocked.' });
            ids.add(parsed.data.id);
            if (!portfolio.plugins?.requirements.some(item => item.pluginId === pluginId)) issues.push({
                severity: 'warning', code: 'undeclared-portable-owner', path,
                message: 'Portable record owner has no plugin requirement; import is blocked.' });
            parsed.data.references.forEach((slot, index) => {
                if (slot.reference && !doesUniversalReferenceResolve(slot.reference, portfolio)) issues.push({
                    severity: 'warning', code: 'dangling-semantic-reference', path: `${path}.references[${index}]`,
                    id: slot.reference.id, message: `Reference '${slot.role}' cannot be resolved; fallback '${slot.fallbackLabel}' is retained.` });
            });
        }
    }
    if (!portfolio.plugins) return issues;
    const requirements = new Map<string, PortfolioPluginRequirement>();

    portfolio.plugins.requirements.forEach((requirement, index) => {
        const path = `plugins.requirements[${index}]`;
        if (requirements.has(requirement.pluginId)) {
            issues.push({
                severity: 'error',
                code: 'duplicate-plugin-requirement',
                path,
                id: requirement.pluginId,
                message: `Plugin '${requirement.pluginId}' is declared more than once.`,
            });
        } else {
            requirements.set(requirement.pluginId, requirement);
        }

        if (requirement.requirement === 'required' && requirement.activation === 'inactive') {
            issues.push({
                severity: 'warning',
                code: 'inactive-required-plugin',
                path: `${path}.activation`,
                id: requirement.pluginId,
                message: `Required plugin '${requirement.pluginId}' is inactive, so the portfolio has reduced fidelity.`,
            });
        }

        if (!options.availablePlugins || requirement.activation !== 'active') return;
        const installedVersion = options.availablePlugins[requirement.pluginId];
        if (!installedVersion) {
            if (requirement.requirement === 'previously-used') return;
            issues.push({
                severity: 'warning',
                code: requirement.requirement === 'required'
                    ? 'missing-required-plugin'
                    : 'missing-recommended-plugin',
                path,
                id: requirement.pluginId,
                message: `${requirement.requirement === 'required' ? 'Required' : 'Recommended'} plugin '${requirement.pluginId}' is not available on this device.`,
            });
            return;
        }
        if (!satisfiesVersionRange(installedVersion, requirement.version)) {
            issues.push({
                severity: 'warning',
                code: 'incompatible-installed-plugin',
                path: `${path}.version`,
                id: requirement.pluginId,
                message: `Installed plugin '${requirement.pluginId}' version ${installedVersion} does not satisfy ${requirement.version}.`,
            });
        }
    });

    const semanticObjects = [
        ...portfolio.plugins.semanticData.records.map((value, index) => ({ value, path: `plugins.semanticData.records[${index}]` })),
        ...portfolio.plugins.semanticData.relations.map((value, index) => ({ value, path: `plugins.semanticData.relations[${index}]` })),
        ...portfolio.plugins.semanticData.annotations.map((value, index) => ({ value, path: `plugins.semanticData.annotations[${index}]` })),
    ];
    const semanticRegistry = new Map<string, string>();

    semanticObjects.forEach(({ value, path }) => {
        const key = semanticKey(value.type, value.id);
        const existingPath = semanticRegistry.get(key);
        if (existingPath) {
            issues.push({
                severity: 'error',
                code: 'duplicate-semantic-identity',
                path,
                id: value.id,
                message: `Semantic identity '${value.type}'/'${value.id}' is also used at ${existingPath}.`,
            });
        } else {
            semanticRegistry.set(key, path);
        }

        const requirement = requirements.get(value.owner.pluginId);
        if (!requirement) {
            issues.push({
                severity: 'warning',
                code: 'undeclared-semantic-owner',
                path: `${path}.owner.pluginId`,
                id: value.owner.pluginId,
                message: `Semantic data owned by '${value.owner.pluginId}' is preserved, but the portfolio does not declare that plugin.`,
            });
            return;
        }
        if (requirement.dataVersion !== value.owner.dataVersion) {
            issues.push({
                severity: 'error',
                code: 'plugin-data-version-mismatch',
                path: `${path}.owner.dataVersion`,
                id: value.id,
                message: `Semantic object '${value.id}' uses data version ${value.owner.dataVersion}, while the portfolio declares ${requirement.dataVersion}.`,
            });
        }
        if (!satisfiesVersionRange(value.owner.pluginVersion, requirement.version)) {
            issues.push({
                severity: 'warning',
                code: 'plugin-version-mismatch',
                path: `${path}.owner.pluginVersion`,
                id: value.id,
                message: `Semantic object '${value.id}' was written by plugin version ${value.owner.pluginVersion}, outside the declared range ${requirement.version}.`,
            });
        }
    });

    const inspectReference = (reference: UniversalEntityReference, path: string): void => {
        const exists = reference.kind.startsWith('core.')
            ? resolveCoreReference(reference, portfolio)
            : semanticRegistry.has(semanticKey(reference.kind, reference.id));
        if (!exists) {
            issues.push({
                severity: 'warning',
                code: 'dangling-semantic-reference',
                path,
                id: reference.id,
                message: `Semantic reference '${reference.kind}'/'${reference.id}' cannot be resolved in this portfolio.`,
            });
        }
    };

    semanticObjects.forEach(({ value, path }) => {
        value.provenance.sources.forEach((source, index) => {
            if (source.kind === 'entity') {
                inspectReference(source.reference, `${path}.provenance.sources[${index}].reference`);
            }
        });
        if (value.schema === 'axiom.semantic-relation') {
            inspectReference(value.source, `${path}.source`);
            inspectReference(value.target, `${path}.target`);
        }
        if (value.schema === 'axiom.semantic-annotation') {
            inspectReference(value.target, `${path}.target`);
        }
    });

    for (const [pluginId, raw] of Object.entries(portfolio.extensions ?? {})) {
        const parsed = PluginDataEnvelopeSchema.safeParse(raw);
        if (!parsed.success) continue;
        for (const [collectionId, collection] of Object.entries(parsed.data.collections)) {
            collection.items.forEach((item, index) => {
                if (item.details?.context) inspectReference(item.details.context.reference, `extensions.${pluginId}.collections.${collectionId}.items[${index}].details.context.reference`);
            });
        }
    }
    return issues;
}
