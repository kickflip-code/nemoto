import type { CanvasNode } from '../types';

type ResourceReferenceNode = Pick<CanvasNode, 'type' | 'assetIds' | 'data'>;

function firstString(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.find((item): item is string => typeof item === 'string' && item.length > 0);
}

/**
 * Resolve the central asset represented by a placed resource node.
 *
 * `assetIds[0]` is the durable canonical reference. The data fields are kept
 * as read fallbacks for files produced by the first resource-node prototype.
 */
export function getResourceReferenceAssetId(
    node: ResourceReferenceNode | null | undefined,
): string | undefined {
    if (!node || node.type !== 'resource') return undefined;

    const canonicalId = firstString(node.assetIds);
    if (canonicalId) return canonicalId;

    const legacyId = node.data?.assetId;
    if (typeof legacyId === 'string' && legacyId.length > 0) return legacyId;

    return firstString(node.data?.assetIds);
}

export function getLegacyResourceReferenceAssetId(
    node: ResourceReferenceNode | null | undefined,
): string | undefined {
    return getLegacyResourceReferenceAssetIds(node)[0];
}

export function getLegacyResourceReferenceAssetIds(
    node: ResourceReferenceNode | null | undefined,
): string[] {
    if (!node || node.type !== 'resource') return [];
    const ids: string[] = [];
    const directId = node.data?.assetId;
    if (typeof directId === 'string' && directId.length > 0) ids.push(directId);
    if (Array.isArray(node.data?.assetIds)) {
        node.data.assetIds.forEach(id => {
            if (typeof id === 'string' && id.length > 0) ids.push(id);
        });
    }
    return [...new Set(ids)];
}

/** Add the canonical field to legacy resource placements without deleting data. */
export function canonicalizeResourceReferenceNode<T extends CanvasNode>(node: T): T {
    if (node.type !== 'resource' || firstString(node.assetIds)) return node;
    const assetId = getResourceReferenceAssetId(node);
    if (!assetId) return node;
    return { ...node, assetIds: [assetId] };
}
