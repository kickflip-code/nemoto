import type { Portfolio } from '../types';
import { preparePortfolioForPersistence } from '../lib/portfolioCodec';
import { inspectPortfolioIntegrity } from '../lib/portfolioIntegrity';
import type {
    SemanticAnnotation,
    SemanticRecord,
    SemanticRelation,
} from './semanticData';
import { doesUniversalReferenceResolve } from './portfolioDataIntegrity';
import { createPortfolioRevision } from './portfolioRevision';
import {
    parsePluginProposal,
    PluginProposalContractError,
    type PluginProposal,
    type ProposalOperation,
    type ProposalSemanticTarget,
} from './proposals';
import { satisfiesVersionRange } from './versionRange';

export { createPortfolioRevision } from './portfolioRevision';

export type ProposalReviewDiagnosticCode =
    | 'invalid-proposal'
    | 'portfolio-revision-failed'
    | 'stale-base-revision'
    | 'missing-plugin-state'
    | 'missing-plugin-requirement'
    | 'ambiguous-plugin-requirement'
    | 'inactive-plugin'
    | 'incompatible-plugin-version'
    | 'plugin-data-version-mismatch'
    | 'semantic-identity-conflict'
    | 'semantic-target-missing'
    | 'semantic-kind-mismatch'
    | 'semantic-owner-mismatch'
    | 'semantic-created-at-mismatch'
    | 'semantic-update-not-newer'
    | 'resource-id-conflict'
    | 'resource-name-conflict'
    | 'resource-category-missing'
    | 'dangling-affected-entity'
    | 'dangling-proposal-source'
    | 'dangling-proposed-reference'
    | 'invalid-result'
    | 'result-integrity-error';

export interface ProposalReviewDiagnostic {
    severity: 'error' | 'warning';
    code: ProposalReviewDiagnosticCode;
    path: string;
    message: string;
    operationId?: string;
}

export interface ProposalChangePreview {
    operationId: string;
    kind: ProposalOperation['kind'];
    entityId: string;
    semanticType: string;
    label?: string;
    categoryId?: string;
    metadataFieldCount?: number;
    sourceLocation?: {
        sheetName?: string;
        rowNumber?: number;
    };
}

export interface CoreResourceImportPreview {
    before: number;
    after: number;
    created: number;
    categories: number;
    metadataFields: number;
}

export interface PluginProposalPreview {
    valid: boolean;
    proposal?: PluginProposal;
    currentRevision?: string;
    baseRevision?: string;
    changes: ProposalChangePreview[];
    diagnostics: ProposalReviewDiagnostic[];
    before: { records: number; relations: number; annotations: number };
    after: { records: number; relations: number; annotations: number };
    coreResources?: CoreResourceImportPreview;
}

export interface PluginProposalApplicationResult {
    portfolio: Portfolio;
    preview: PluginProposalPreview;
}

export class PluginProposalApplicationError extends Error {
    constructor(
        message: string,
        readonly diagnostics: ProposalReviewDiagnostic[],
    ) {
        super(message);
        this.name = 'PluginProposalApplicationError';
    }
}

type SemanticCollection = 'records' | 'relations' | 'annotations';
type SemanticValue = SemanticRecord | SemanticRelation | SemanticAnnotation;
type SemanticProposalOperation = Exclude<ProposalOperation, { kind: 'core.resource.import' }>;

interface LocatedSemanticValue {
    collection: SemanticCollection;
    index: number;
    value: SemanticValue;
}

interface SimulatedProposal {
    candidate: Portfolio;
    changes: ProposalChangePreview[];
}

const cloneJsonDocument = <T>(value: T): T => (
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T
);

const semanticIdentity = (type: string, id: string): string => `${type}\u0000${id}`;

const semanticCounts = (portfolio: Portfolio) => ({
    records: portfolio.plugins?.semanticData.records.length || 0,
    relations: portfolio.plugins?.semanticData.relations.length || 0,
    annotations: portfolio.plugins?.semanticData.annotations.length || 0,
});

const operationCollection = (operation: SemanticProposalOperation): SemanticCollection => {
    if (operation.kind.startsWith('semantic-record.')) return 'records';
    if (operation.kind.startsWith('semantic-relation.')) return 'relations';
    return 'annotations';
};

const operationPayload = (operation: SemanticProposalOperation): SemanticValue | undefined => {
    switch (operation.kind) {
        case 'semantic-record.create':
        case 'semantic-record.update':
            return operation.record;
        case 'semantic-relation.create':
        case 'semantic-relation.update':
            return operation.relation;
        case 'semantic-annotation.create':
        case 'semantic-annotation.update':
            return operation.annotation;
        case 'semantic-record.delete':
        case 'semantic-relation.delete':
        case 'semantic-annotation.delete':
            return undefined;
    }
};

const operationTarget = (operation: SemanticProposalOperation): ProposalSemanticTarget => {
    switch (operation.kind) {
        case 'semantic-record.create':
        case 'semantic-record.update':
            return { type: operation.record.type, id: operation.record.id };
        case 'semantic-relation.create':
        case 'semantic-relation.update':
            return { type: operation.relation.type, id: operation.relation.id };
        case 'semantic-annotation.create':
        case 'semantic-annotation.update':
            return { type: operation.annotation.type, id: operation.annotation.id };
        case 'semantic-record.delete':
        case 'semantic-relation.delete':
        case 'semantic-annotation.delete':
            return operation.target;
    }
};

function locateSemanticValue(portfolio: Portfolio, target: ProposalSemanticTarget): LocatedSemanticValue | undefined {
    const semanticData = portfolio.plugins?.semanticData;
    if (!semanticData) return undefined;
    const collections: SemanticCollection[] = ['records', 'relations', 'annotations'];
    for (const collection of collections) {
        const index = semanticData[collection].findIndex(value => (
            semanticIdentity(value.type, value.id) === semanticIdentity(target.type, target.id)
        ));
        if (index >= 0) {
            return {
                collection,
                index,
                value: semanticData[collection][index] as SemanticValue,
            };
        }
    }
    return undefined;
}

function pushSemanticValue(
    portfolio: Portfolio,
    collection: SemanticCollection,
    value: SemanticValue,
): void {
    if (!portfolio.plugins) return;
    if (collection === 'records') {
        portfolio.plugins.semanticData.records.push(cloneJsonDocument(value as SemanticRecord));
    } else if (collection === 'relations') {
        portfolio.plugins.semanticData.relations.push(cloneJsonDocument(value as SemanticRelation));
    } else {
        portfolio.plugins.semanticData.annotations.push(cloneJsonDocument(value as SemanticAnnotation));
    }
}

function replaceSemanticValue(
    portfolio: Portfolio,
    located: LocatedSemanticValue,
    value: SemanticValue,
): void {
    if (!portfolio.plugins) return;
    if (located.collection === 'records') {
        portfolio.plugins.semanticData.records[located.index] = cloneJsonDocument(value as SemanticRecord);
    } else if (located.collection === 'relations') {
        portfolio.plugins.semanticData.relations[located.index] = cloneJsonDocument(value as SemanticRelation);
    } else {
        portfolio.plugins.semanticData.annotations[located.index] = cloneJsonDocument(value as SemanticAnnotation);
    }
}

function removeSemanticValue(portfolio: Portfolio, located: LocatedSemanticValue): void {
    if (!portfolio.plugins) return;
    portfolio.plugins.semanticData[located.collection].splice(located.index, 1);
}

function simulateProposalOperations(
    portfolio: Portfolio,
    proposal: PluginProposal,
    diagnostics: ProposalReviewDiagnostic[],
    requiredDataVersion: number | undefined,
): SimulatedProposal {
    const candidate = cloneJsonDocument(portfolio);
    const changes: ProposalChangePreview[] = [];

    proposal.operations.forEach((operation, index) => {
        const path = `operations[${index}]`;
        if (operation.kind === 'core.resource.import') {
            const resource = operation.resource;
            const categoryExists = candidate.assetCategories.some(category => category.id === resource.categoryId);
            const idExists = candidate.assets.some(asset => asset.id === resource.id);
            const normalizedName = resource.name.trim().toLocaleLowerCase();
            const nameExists = candidate.assets.some(asset => (
                asset.type === resource.categoryId
                && asset.name.trim().toLocaleLowerCase() === normalizedName
            ));

            if (!categoryExists) {
                diagnostics.push({
                    severity: 'error',
                    code: 'resource-category-missing',
                    path: `${path}.resource.categoryId`,
                    operationId: operation.operationId,
                    message: `Resource category '${resource.categoryId}' does not exist in the current portfolio.`,
                });
            }
            if (idExists) {
                diagnostics.push({
                    severity: 'error',
                    code: 'resource-id-conflict',
                    path: `${path}.resource.id`,
                    operationId: operation.operationId,
                    message: `Resource ID '${resource.id}' already exists.`,
                });
            }
            if (nameExists) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'resource-name-conflict',
                    path: `${path}.resource.name`,
                    operationId: operation.operationId,
                    message: `A resource named '${resource.name}' already exists in this category.`,
                });
            }
            if (categoryExists && !idExists) {
                candidate.assets.push({
                    id: resource.id,
                    name: resource.name,
                    type: resource.categoryId,
                    ...(resource.metadata ? { metadata: cloneJsonDocument(resource.metadata) } : {}),
                });
            }
            changes.push({
                operationId: operation.operationId,
                kind: operation.kind,
                entityId: resource.id,
                semanticType: 'core.asset',
                label: resource.name,
                categoryId: resource.categoryId,
                metadataFieldCount: Object.keys(resource.metadata || {}).length,
                ...(operation.sourceLocation ? { sourceLocation: operation.sourceLocation } : {}),
            });
            return;
        }

        const collection = operationCollection(operation);
        const payload = operationPayload(operation);
        const target = operationTarget(operation);
        const located = locateSemanticValue(candidate, target);
        const action = operation.kind.split('.')[1];

        if (payload && requiredDataVersion !== undefined
            && payload.owner.dataVersion !== requiredDataVersion) {
            diagnostics.push({
                severity: 'error',
                code: 'plugin-data-version-mismatch',
                path: `${path}.owner.dataVersion`,
                operationId: operation.operationId,
                message: `Operation data version ${payload.owner.dataVersion} does not match declared version ${requiredDataVersion}.`,
            });
        }

        if (action === 'create') {
            if (located) {
                diagnostics.push({
                    severity: 'error',
                    code: 'semantic-identity-conflict',
                    path,
                    operationId: operation.operationId,
                    message: `Semantic identity '${target.type}'/'${target.id}' already exists.`,
                });
            } else if (payload) {
                pushSemanticValue(candidate, collection, payload);
            }
        } else if (!located) {
            diagnostics.push({
                severity: 'error',
                code: 'semantic-target-missing',
                path,
                operationId: operation.operationId,
                message: `Semantic target '${target.type}'/'${target.id}' does not exist.`,
            });
        } else {
            let operationValid = true;
            if (located.collection !== collection) {
                operationValid = false;
                diagnostics.push({
                    severity: 'error',
                    code: 'semantic-kind-mismatch',
                    path,
                    operationId: operation.operationId,
                    message: `Operation kind does not match the stored semantic entity kind for '${target.id}'.`,
                });
            }
            if (located.value.owner.pluginId !== proposal.proposedBy.pluginId) {
                operationValid = false;
                diagnostics.push({
                    severity: 'error',
                    code: 'semantic-owner-mismatch',
                    path,
                    operationId: operation.operationId,
                    message: `Plugin '${proposal.proposedBy.pluginId}' does not own semantic target '${target.id}'.`,
                });
            }
            if (requiredDataVersion !== undefined
                && located.value.owner.dataVersion !== requiredDataVersion) {
                operationValid = false;
                diagnostics.push({
                    severity: 'error',
                    code: 'plugin-data-version-mismatch',
                    path,
                    operationId: operation.operationId,
                    message: `Stored semantic target '${target.id}' does not use declared data version ${requiredDataVersion}.`,
                });
            }
            if (action === 'update' && payload) {
                if (payload.createdAt !== located.value.createdAt) {
                    operationValid = false;
                    diagnostics.push({
                        severity: 'error',
                        code: 'semantic-created-at-mismatch',
                        path: `${path}.createdAt`,
                        operationId: operation.operationId,
                        message: 'Updates must preserve the original creation timestamp.',
                    });
                }
                if (Date.parse(payload.updatedAt) <= Date.parse(located.value.updatedAt)) {
                    operationValid = false;
                    diagnostics.push({
                        severity: 'error',
                        code: 'semantic-update-not-newer',
                        path: `${path}.updatedAt`,
                        operationId: operation.operationId,
                        message: 'Updates must advance the semantic entity update timestamp.',
                    });
                }
                if (operationValid) replaceSemanticValue(candidate, located, payload);
            } else if (action === 'delete' && operationValid) {
                removeSemanticValue(candidate, located);
            }
        }

        changes.push({
            operationId: operation.operationId,
            kind: operation.kind,
            entityId: target.id,
            semanticType: target.type,
            ...(payload && 'label' in payload
                ? { label: payload.label }
                : located?.value && 'label' in located.value
                    ? { label: located.value.label }
                    : {}),
        });
    });

    return { candidate, changes };
}

const integrityKey = (issue: ReturnType<typeof inspectPortfolioIntegrity>['issues'][number]): string => (
    `${issue.severity}\u0000${issue.code}\u0000${issue.path}\u0000${issue.id || ''}\u0000${issue.message}`
);

export function previewPluginProposal(input: unknown, portfolio: Portfolio): PluginProposalPreview {
    const before = semanticCounts(portfolio);
    const diagnostics: ProposalReviewDiagnostic[] = [];
    let proposal: PluginProposal;

    try {
        proposal = parsePluginProposal(input);
    } catch (error) {
        if (error instanceof PluginProposalContractError) {
            const issues = error.issues.length > 0 ? error.issues : [undefined];
            issues.forEach(issue => diagnostics.push({
                severity: 'error',
                code: 'invalid-proposal',
                path: issue?.path.join('.') || 'proposal',
                message: issue?.message || error.message,
            }));
            return { valid: false, changes: [], diagnostics, before, after: before };
        }
        throw error;
    }

    let currentRevision: string | undefined;
    try {
        currentRevision = createPortfolioRevision(portfolio);
    } catch (error) {
        diagnostics.push({
            severity: 'error',
            code: 'portfolio-revision-failed',
            path: 'portfolio',
            message: error instanceof Error ? error.message : 'The current portfolio could not be revisioned.',
        });
    }

    if (currentRevision && proposal.baseRevision !== currentRevision) {
        diagnostics.push({
            severity: 'error',
            code: 'stale-base-revision',
            path: 'baseRevision',
            message: 'The portfolio changed after this proposal was created. Generate or review it again against the current revision.',
        });
    }

    const requirements = portfolio.plugins?.requirements.filter(requirement => (
        requirement.pluginId === proposal.proposedBy.pluginId
    )) || [];
    const requirement = requirements[0];
    if (!portfolio.plugins) {
        diagnostics.push({
            severity: 'error',
            code: 'missing-plugin-state',
            path: 'plugins',
            message: 'The portfolio has no canonical plugin state.',
        });
    } else if (requirements.length === 0) {
        diagnostics.push({
            severity: 'error',
            code: 'missing-plugin-requirement',
            path: 'plugins.requirements',
            message: `The portfolio does not declare '${proposal.proposedBy.pluginId}'.`,
        });
    } else if (requirements.length > 1) {
        diagnostics.push({
            severity: 'error',
            code: 'ambiguous-plugin-requirement',
            path: 'plugins.requirements',
            message: `The portfolio declares '${proposal.proposedBy.pluginId}' more than once.`,
        });
    }

    if (requirement) {
        if (requirement.activation !== 'active') {
            diagnostics.push({
                severity: 'error',
                code: 'inactive-plugin',
                path: 'plugins.requirements.activation',
                message: `Plugin '${requirement.pluginId}' is not active for this portfolio.`,
            });
        }
        if (!satisfiesVersionRange(proposal.proposedBy.pluginVersion, requirement.version)) {
            diagnostics.push({
                severity: 'error',
                code: 'incompatible-plugin-version',
                path: 'proposedBy.pluginVersion',
                message: `Proposing version ${proposal.proposedBy.pluginVersion} does not satisfy ${requirement.version}.`,
            });
        }
    }

    const simulated = simulateProposalOperations(
        portfolio,
        proposal,
        diagnostics,
        requirement?.dataVersion,
    );

    proposal.affectedEntities.forEach((reference, index) => {
        if (!doesUniversalReferenceResolve(reference, portfolio)) {
            diagnostics.push({
                severity: 'error',
                code: 'dangling-affected-entity',
                path: `affectedEntities[${index}]`,
                message: `Affected entity '${reference.kind}'/'${reference.id}' does not exist in the current portfolio.`,
            });
        }
    });
    proposal.sources.forEach((source, index) => {
        if (source.kind === 'entity' && !doesUniversalReferenceResolve(source.reference, portfolio)) {
            diagnostics.push({
                severity: 'error',
                code: 'dangling-proposal-source',
                path: `sources[${index}].reference`,
                message: `Proposal source '${source.reference.kind}'/'${source.reference.id}' does not exist in the current portfolio.`,
            });
        }
    });

    let preparedCandidate: Portfolio | undefined;
    if (!diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
        try {
            const baselineIssues = new Set(inspectPortfolioIntegrity(portfolio).issues.map(integrityKey));
            preparedCandidate = preparePortfolioForPersistence(simulated.candidate);
            inspectPortfolioIntegrity(preparedCandidate).issues.forEach(issue => {
                if (baselineIssues.has(integrityKey(issue))) return;
                if (issue.code === 'dangling-semantic-reference') {
                    diagnostics.push({
                        severity: 'error',
                        code: 'dangling-proposed-reference',
                        path: issue.path,
                        message: issue.message,
                    });
                } else if (issue.severity === 'error') {
                    diagnostics.push({
                        severity: 'error',
                        code: 'result-integrity-error',
                        path: issue.path,
                        message: issue.message,
                    });
                }
            });
        } catch (error) {
            diagnostics.push({
                severity: 'error',
                code: 'invalid-result',
                path: 'operations',
                message: error instanceof Error ? error.message : 'The proposal produced invalid portfolio data.',
            });
        }
    }

    const valid = !diagnostics.some(diagnostic => diagnostic.severity === 'error');
    const coreResources = proposal.schemaVersion === 3
        ? {
            before: portfolio.assets.length,
            after: valid && preparedCandidate ? preparedCandidate.assets.length : portfolio.assets.length,
            created: valid && preparedCandidate ? preparedCandidate.assets.length - portfolio.assets.length : 0,
            categories: new Set(proposal.operations.map(operation => operation.resource.categoryId)).size,
            metadataFields: proposal.operations.reduce(
                (total, operation) => total + Object.keys(operation.resource.metadata || {}).length,
                0,
            ),
        }
        : undefined;
    return {
        valid,
        proposal,
        currentRevision,
        baseRevision: proposal.baseRevision,
        changes: simulated.changes,
        diagnostics,
        before,
        after: valid && preparedCandidate ? semanticCounts(preparedCandidate) : before,
        ...(coreResources ? { coreResources } : {}),
    };
}

export function applyPluginProposal(input: unknown, portfolio: Portfolio): PluginProposalApplicationResult {
    const preview = previewPluginProposal(input, portfolio);
    if (!preview.valid || !preview.proposal) {
        throw new PluginProposalApplicationError(
            'Plugin proposal cannot be applied to the current portfolio.',
            preview.diagnostics,
        );
    }

    const diagnostics: ProposalReviewDiagnostic[] = [];
    const requirement = portfolio.plugins?.requirements.find(candidate => (
        candidate.pluginId === preview.proposal!.proposedBy.pluginId
    ));
    const simulated = simulateProposalOperations(
        portfolio,
        preview.proposal,
        diagnostics,
        requirement?.dataVersion,
    );
    if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
        throw new PluginProposalApplicationError(
            'Plugin proposal failed final simulation.',
            [...preview.diagnostics, ...diagnostics],
        );
    }

    try {
        return {
            portfolio: preparePortfolioForPersistence(simulated.candidate),
            preview,
        };
    } catch (error) {
        const diagnostic: ProposalReviewDiagnostic = {
            severity: 'error',
            code: 'invalid-result',
            path: 'operations',
            message: error instanceof Error ? error.message : 'The proposal produced invalid portfolio data.',
        };
        throw new PluginProposalApplicationError(
            'Plugin proposal failed final validation.',
            [...preview.diagnostics, diagnostic],
        );
    }
}
