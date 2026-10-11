import { z } from 'zod';
import type { PluginCollectionItem } from './collectionStorage';

// Scalar own-record reads only. No evaluation, callbacks, writes or prototype traversal.
const path = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine(key => !['__proto__', 'prototype', 'constructor'].includes(key))).min(1).max(5);
const operand = z.object({ path, localDate: z.boolean() }).strict();
const predicate = z.object({
    operand, operation: z.enum(['equals', 'contains', 'at-least', 'at-most']),
    value: z.union([z.string().max(500), z.boolean(), z.null()]),
}).strict();
export const PluginCollectionQuerySchema = z.object({
    // AND of bounded OR groups; no recursive expression language.
    where: z.array(z.array(predicate).min(1).max(4)).max(8),
    order: z.array(z.object({ operand, descending: z.boolean(), emptyLast: z.boolean() }).strict()).max(4),
    timezoneOffsetMinutes: z.number().int().min(-840).max(840),
    // First nonempty scalar identifies a group; return its first sorted record.
    distinctBy: z.array(operand).min(1).max(2).optional(),
}).strict();
export type PluginCollectionQuery = z.infer<typeof PluginCollectionQuerySchema>;

type QueryOperand = z.infer<typeof operand>;
function scalar(item: PluginCollectionItem, operand: QueryOperand, offset: number): string | boolean | null {
    let value: unknown = item;
    for (const key of operand.path) {
        if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return null;
        value = (value as Record<string, unknown>)[key];
    }
    if (operand.localDate) {
        if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
        const shifted = new Date(Date.parse(value) - offset * 60_000);
        return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : null;
    }
    return typeof value === 'string' || typeof value === 'boolean' ? value : null;
}

export function queryCollectionItems(items: readonly PluginCollectionItem[], input: PluginCollectionQuery): PluginCollectionItem[] {
    const query = PluginCollectionQuerySchema.parse(input);
    const ordered = items.filter(item => query.where.every(group => group.some(test => {
        const value = scalar(item, test.operand, query.timezoneOffsetMinutes);
        if (test.operation === 'equals') return value === test.value;
        if (typeof value !== 'string' || typeof test.value !== 'string') return false;
        if (test.operation === 'contains') return value.toLocaleLowerCase().includes(test.value.toLocaleLowerCase());
        return test.operation === 'at-least' ? value >= test.value : value <= test.value;
    }))).sort((a, b) => {
        for (const order of query.order) {
            const left = scalar(a, order.operand, query.timezoneOffsetMinutes);
            const right = scalar(b, order.operand, query.timezoneOffsetMinutes);
            const leftEmpty = left === null || left === '';
            const rightEmpty = right === null || right === '';
            if (order.emptyLast && leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
            const compared = String(left ?? '').localeCompare(String(right ?? ''));
            if (compared) return order.descending ? -compared : compared;
        }
        return a.id.localeCompare(b.id);
    });
    if (!query.distinctBy) return ordered;
    const seen = new Set<string>();
    return ordered.filter(item => {
        const value = query.distinctBy!.map(operand => scalar(item, operand, query.timezoneOffsetMinutes))
            .find(value => value !== null && value !== '');
        if (value === undefined) return false;
        const key = JSON.stringify(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
