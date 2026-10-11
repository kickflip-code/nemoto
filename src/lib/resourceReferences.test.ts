import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../types';
import {
    canonicalizeResourceReferenceNode,
    getResourceReferenceAssetId,
} from './resourceReferences';

function resourceNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
    return {
        id: 'resource-node',
        type: 'resource',
        label: null,
        position: { x: 0, y: 0 },
        ...overrides,
    };
}

describe('placed resource references', () => {
    it('uses assetIds[0] as the canonical central-asset reference', () => {
        const node = resourceNode({
            assetIds: ['canonical-asset'],
            data: { assetId: 'legacy-asset' },
        });

        expect(getResourceReferenceAssetId(node)).toBe('canonical-asset');
    });

    it('continues to read the legacy data.assetId reference', () => {
        expect(getResourceReferenceAssetId(resourceNode({
            data: { assetId: 'legacy-asset' },
        }))).toBe('legacy-asset');
    });

    it('promotes a legacy reference without discarding legacy data', () => {
        const legacyNode = resourceNode({
            data: { assetId: 'legacy-asset', description: 'Keep me' },
        });

        const canonicalNode = canonicalizeResourceReferenceNode(legacyNode);

        expect(canonicalNode).not.toBe(legacyNode);
        expect(canonicalNode.assetIds).toEqual(['legacy-asset']);
        expect(canonicalNode.data).toEqual(legacyNode.data);
    });

    it('reads the legacy data.assetIds array when data.assetId is absent', () => {
        expect(getResourceReferenceAssetId(resourceNode({
            data: { assetIds: ['legacy-array-asset'] },
        }))).toBe('legacy-array-asset');
    });
});
