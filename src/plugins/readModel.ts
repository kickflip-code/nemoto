import type { Asset, CanvasGraph, CanvasNode, Portfolio, Process } from '../types';

export interface RoleJourneyOption {
    readonly id: string;
    readonly name: string;
    readonly categoryLabel: string;
}

export interface RoleJourneyProcess {
    readonly id: string;
    readonly title: string;
    readonly relationship: 'owner' | 'participant' | 'owner-and-participant';
}

export interface RoleJourneyStep {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly type: CanvasNode['type'];
    readonly processId: string;
    readonly processTitle: string;
    readonly graphId: 'root' | string;
    readonly relatedResourceIds: readonly string[];
}

export interface RoleJourneyRelatedResource {
    readonly id: string;
    readonly name: string;
    readonly categoryLabel: string;
    readonly sharedStepCount: number;
}

export interface RoleJourneyKnowledge {
    readonly id: string;
    readonly title: string;
    readonly notebookId: string;
    readonly linkedThrough: 'role' | 'touchpoint';
    readonly linkedEntityIds: readonly string[];
}

export interface RoleJourneyProjection {
    readonly projection: 'axiom.read-model/role-journey';
    readonly projectionVersion: 1;
    readonly role: RoleJourneyOption;
    readonly processes: readonly RoleJourneyProcess[];
    readonly steps: readonly RoleJourneyStep[];
    readonly relatedResources: readonly RoleJourneyRelatedResource[];
    readonly linkedKnowledge: readonly RoleJourneyKnowledge[];
    readonly summary: {
        readonly processCount: number;
        readonly touchpointCount: number;
        readonly relatedResourceCount: number;
        readonly knowledgeCount: number;
    };
}

interface LocatedNode {
    node: CanvasNode;
    graphId: 'root' | string;
}

const deepFreeze = <T>(value: T): T => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(child => deepFreeze(child));
    return Object.freeze(value);
};

const assetCategory = (portfolio: Portfolio, asset: Asset) => (
    portfolio.assetCategories.find(category => category.id === asset.type)
);

const roleAssets = (portfolio: Portfolio): Asset[] => portfolio.assets.filter(asset => (
    assetCategory(portfolio, asset)?.baseType === 'role'
));

export function listRoleJourneyOptions(portfolio: Portfolio): readonly RoleJourneyOption[] {
    return deepFreeze(roleAssets(portfolio)
        .map(asset => ({
            id: asset.id,
            name: asset.name,
            categoryLabel: assetCategory(portfolio, asset)?.label || 'Role',
        }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)));
}

const locatedNodes = (process: Process): LocatedNode[] => {
    const fromGraph = (graph: CanvasGraph, graphId: 'root' | string): LocatedNode[] => (
        (graph.nodes || []).map(node => ({ node, graphId }))
    );

    return [
        ...fromGraph(process.graph, 'root'),
        ...Object.entries(process.subGraphs || {})
            .sort(([left], [right]) => left.localeCompare(right))
            .flatMap(([graphId, graph]) => fromGraph(graph, graphId)),
    ];
};

const nodeDescription = (node: CanvasNode): string | undefined => {
    const description = node.data?.description;
    return typeof description === 'string' && description.trim()
        ? description.trim()
        : undefined;
};

export function createRoleJourneyProjection(
    portfolio: Portfolio,
    roleId: string,
): RoleJourneyProjection | null {
    const role = roleAssets(portfolio).find(asset => asset.id === roleId);
    if (!role) return null;

    const roleOption: RoleJourneyOption = {
        id: role.id,
        name: role.name,
        categoryLabel: assetCategory(portfolio, role)?.label || 'Role',
    };
    const relevantProcessIds = new Set<string>();
    const stepNodeIds = new Set<string>();
    const relatedResourceCounts = new Map<string, number>();
    const steps: RoleJourneyStep[] = [];

    portfolio.processes.forEach(process => {
        locatedNodes(process).forEach(({ node, graphId }) => {
            if (!node.assetIds?.includes(role.id)) return;

            relevantProcessIds.add(process.id);
            stepNodeIds.add(node.id);
            const relatedResourceIds = [...new Set(
                node.assetIds.filter(assetId => assetId !== role.id),
            )].sort();
            relatedResourceIds.forEach(assetId => {
                relatedResourceCounts.set(assetId, (relatedResourceCounts.get(assetId) || 0) + 1);
            });

            steps.push({
                id: node.id,
                label: node.label?.trim() || 'Untitled step',
                description: nodeDescription(node),
                type: node.type,
                processId: process.id,
                processTitle: process.title,
                graphId,
                relatedResourceIds,
            });
        });

        if (process.ownerId === role.id) relevantProcessIds.add(process.id);
    });

    steps.sort((left, right) => (
        left.processTitle.localeCompare(right.processTitle)
        || left.label.localeCompare(right.label)
        || left.id.localeCompare(right.id)
    ));

    const processes: RoleJourneyProcess[] = portfolio.processes
        .filter(process => relevantProcessIds.has(process.id))
        .map(process => {
            const owner = process.ownerId === role.id;
            const participant = steps.some(step => step.processId === process.id);
            return {
                id: process.id,
                title: process.title,
                relationship: owner && participant
                    ? 'owner-and-participant' as const
                    : owner
                        ? 'owner' as const
                        : 'participant' as const,
            };
        })
        .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));

    const relatedResources: RoleJourneyRelatedResource[] = [...relatedResourceCounts.entries()]
        .map(([assetId, sharedStepCount]) => {
            const asset = portfolio.assets.find(candidate => candidate.id === assetId);
            if (!asset) return null;
            return {
                id: asset.id,
                name: asset.name,
                categoryLabel: assetCategory(portfolio, asset)?.label || 'Resource',
                sharedStepCount,
            };
        })
        .filter((resource): resource is RoleJourneyRelatedResource => resource !== null)
        .sort((left, right) => (
            right.sharedStepCount - left.sharedStepCount
            || left.name.localeCompare(right.name)
            || left.id.localeCompare(right.id)
        ));

    const linkedKnowledge: RoleJourneyKnowledge[] = portfolio.journal.entries
        .flatMap<RoleJourneyKnowledge>(entry => {
            const linkedIds = [...new Set((entry.linkedContext || []).map(reference => reference.id))];
            const roleLinked = linkedIds.includes(role.id);
            const touchpointLinks = linkedIds.filter(id => stepNodeIds.has(id));
            if (!roleLinked && touchpointLinks.length === 0) return [];

            return [{
                id: entry.id,
                title: entry.title,
                notebookId: entry.notebookId,
                linkedThrough: roleLinked ? 'role' as const : 'touchpoint' as const,
                linkedEntityIds: roleLinked ? [role.id, ...touchpointLinks] : touchpointLinks,
            }];
        })
        .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));

    return deepFreeze({
        projection: 'axiom.read-model/role-journey',
        projectionVersion: 1,
        role: roleOption,
        processes,
        steps,
        relatedResources,
        linkedKnowledge,
        summary: {
            processCount: processes.length,
            touchpointCount: steps.length,
            relatedResourceCount: relatedResources.length,
            knowledgeCount: linkedKnowledge.length,
        },
    });
}
