import { describe, expect, it } from 'vitest';
import { PluginCollectionQuerySchema, queryCollectionItems, type PluginCollectionQuery } from './collectionQuery';
import { readPluginCollectionPage, type PluginCollectionItem } from './collectionStorage';
import { emptyPortfolio } from '../stores/slices/coreSlice';
import fixture from '../../fixtures/plugins/protocol/collection-query-v1.json';

const operand = (path: string[], localDate = false) => ({ path, localDate });
const query: PluginCollectionQuery = {
    where: [[{ operand: operand(['values', 'title']), operation: 'contains', value: 'needle' }]],
    order: [{ operand: operand(['values', 'due']), descending: false, emptyLast: true }],
    timezoneOffsetMinutes: -120,
};
const items: PluginCollectionItem[] = Array.from({ length: 5000 }, (_, index) => ({
    id: `item-${index}`, createdAt: '2026-09-13T10:00:00.000Z', updatedAt: '2026-09-13T10:00:00.000Z',
    values: { title: index >= 4900 ? `Needle ${index}` : `Other ${index}`, due: index === 4999 ? '' : '2026-09-13' },
}));

describe('bounded own-collection queries', () => {
    it.each(fixture.cases)('agrees with native validation: $name', test => {
        const value = structuredClone(fixture.query);
        if (test.pointer) {
            const path = test.pointer.slice(1).split('/');
            let parent: any = value;
            for (const key of path.slice(0, -1)) parent = parent[key];
            parent[path[path.length - 1]] = test.value;
        }
        expect(PluginCollectionQuerySchema.safeParse(value).success).toBe(test.valid);
    });
    it('filters and sorts all 5,000 items before paging, with exact totals and immutable data', () => {
        const portfolio = { ...emptyPortfolio, extensions: { 'org.example.records': {
            schema: 'axiom.plugin-data', schemaVersion: 1, collections: { records: { items } }, documents: {},
        } } };
        const before = JSON.stringify(portfolio);
        const first = readPluginCollectionPage(portfolio, 'org.example.records', 'records', 7, null, 50, query);
        expect(first.totalItems).toBe(100);
        expect(first.items).toHaveLength(50);
        const second = readPluginCollectionPage(portfolio, 'org.example.records', 'records', 7, first.nextCursor, 50, query);
        expect(second.nextCursor).toBeNull();
        expect(second.items[second.items.length - 1]?.id).toBe('item-4999');
        expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(100);
        expect(() => readPluginCollectionPage(portfolio, 'org.example.records', 'records', 8, first.nextCursor, 50, query)).toThrow(/stale/);
        expect(() => readPluginCollectionPage(portfolio, 'org.example.records', 'records', 7, first.nextCursor, 50, { ...query, where: [] })).toThrow(/stale/);
        expect(JSON.stringify(portfolio)).toBe(before);
    });
    it('uses the declared local calendar offset for inclusive timestamp filters', () => {
        const local = { ...query, where: [[{ operand: operand(['updatedAt'], true), operation: 'equals' as const, value: '2026-09-14' }]] };
        expect(queryCollectionItems([{ ...items[0], updatedAt: '2026-09-13T23:00:00.000Z' }, items[1]], local).map(item => item.id)).toEqual(['item-0']);
    });
    it('pages distinct choices over the entire dataset, including fallback keys and late records', () => {
        const records = items.map((item, index) => ({ ...item, values: { ...item.values,
            group: index < 4900 ? 'early' : `late-${index}`, fallback: 'unused' } }));
        records.push({ ...items[0], id: 'fallback', values: { ...items[0].values, group: '', fallback: 'fallback-group' } });
        const distinct = { ...query, where: [], order: [], distinctBy: [operand(['values', 'group']), operand(['values', 'fallback'])] };
        const result = queryCollectionItems(records, distinct);
        expect(result).toHaveLength(102);
        expect(result.some(item => item.values.group === 'late-4999')).toBe(true);
        expect(result.some(item => item.id === 'fallback')).toBe(true);
        expect(PluginCollectionQuerySchema.safeParse({ ...distinct, distinctBy: [] }).success).toBe(false);
        expect(PluginCollectionQuerySchema.safeParse({ ...distinct, distinctBy: Array(3).fill(distinct.distinctBy[0]) }).success).toBe(false);
    });
    it('rejects prototype paths, unknown operators and unbounded expression shapes', () => {
        for (const key of ['__proto__', 'constructor', 'prototype']) {
            expect(PluginCollectionQuerySchema.safeParse({ ...query, order: [{ ...query.order[0], operand: operand([key]) }] }).success).toBe(false);
        }
        expect(PluginCollectionQuerySchema.safeParse({ ...query, where: Array(9).fill(query.where[0]) }).success).toBe(false);
        expect(PluginCollectionQuerySchema.safeParse({ ...query, order: Array(5).fill(query.order[0]) }).success).toBe(false);
        expect(PluginCollectionQuerySchema.safeParse({ ...query, code: 'return true' }).success).toBe(false);
    });
});
