import type { PluginCollectionItem, PluginCollectionTransactionOperation } from '../plugins/collectionStorage';
import type { RecordContext } from '../plugins/contextualRecords';
import type { UniversalEntityReference } from '../plugins/universalReference';

/** Resolve changed links at commit; retain existing missing links for recovery. */
export function prepareCollectionReferences(
    previous: readonly PluginCollectionItem[],
    operations: readonly PluginCollectionTransactionOperation[],
    resolve: (reference: UniversalEntityReference) => RecordContext | null,
): PluginCollectionTransactionOperation[] {
    const existing = new Map(previous.map(item => [item.id, item]));
    return operations.map(operation => {
        if (operation.kind !== 'put' || !operation.item.details?.context) return operation;
        const context = operation.item.details.context;
        const current = resolve(context.reference);
        if (!current) {
            const old = existing.get(operation.item.id)?.details?.context?.reference;
            if (JSON.stringify(old) !== JSON.stringify(context.reference)) {
                throw new Error('The linked object is no longer available. Choose another object or remove the link.');
            }
            return operation;
        }
        return { ...operation, item: { ...operation.item,
            details: { ...operation.item.details, context: current } } };
    });
}
