import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/plugins/protocol/tasks-report-v1.json';
import { PluginCollectionItemSchema, type PluginCollectionTransactionOperation } from '../plugins/collectionStorage';
import { prepareCollectionReferences } from './pluginCollectionReferences';

describe('collection reference commits', () => {
    const old = PluginCollectionItemSchema.parse(fixture.items[0]);
    const put: PluginCollectionTransactionOperation = { operationId: 'save', kind: 'put', item: old };
    it('keeps existing unavailable references but refuses new and relinked missing targets atomically', () => {
        expect(prepareCollectionReferences([old], [put], () => null)).toEqual([put]);
        expect(() => prepareCollectionReferences([], [put], () => null)).toThrow(/no longer available/);
        const relink = structuredClone(old);
        relink.details!.context!.reference.id = 'different-missing-target';
        expect(() => prepareCollectionReferences([old], [{ ...put, item: relink }], () => null)).toThrow(/no longer available/);
        expect(old.details!.context!.reference.id).toBe('deleted');
    });
    it('refreshes canonical references and paths while preserving item identity and rich text', () => {
        const current = { ...old.details!.context!, labelSnapshot: 'Renamed', locationSnapshot: 'Service / Nested' };
        const [operation] = prepareCollectionReferences([old], [put], () => current);
        expect(operation.kind).toBe('put');
        if (operation.kind !== 'put') throw new Error('Expected put');
        expect(operation.item).toEqual({ ...old, details: { ...old.details!, context: current } });
        expect(old.details!.context!.labelSnapshot).toBe('Old object');
        const unlinked = { ...old, details: { ...old.details!, context: null } };
        expect(prepareCollectionReferences([old], [{ ...put, item: unlinked }], () => { throw new Error('Unexpected read'); })).toEqual([{ ...put, item: unlinked }]);
    });
});
