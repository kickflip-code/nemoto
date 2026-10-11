import type { Portfolio } from '../types';
import { preparePortfolioForPersistence } from '../lib/portfolioCodec';

function canonicalJsonValue(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map(item => canonicalJsonValue(item, seen) ?? null);
    }
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) throw new TypeError('Portfolio revision input must be acyclic JSON data.');
    seen.add(value);
    const result: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>).sort().forEach(key => {
        const normalized = canonicalJsonValue((value as Record<string, unknown>)[key], seen);
        if (normalized !== undefined) result[key] = normalized;
    });
    seen.delete(value);
    return result;
}

const stableJson = (value: unknown): string => JSON.stringify(
    canonicalJsonValue(value, new WeakSet<object>()),
);

function revisionHash(value: string): string {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193);
        right = Math.imul(right ^ code, 0x85ebca6b);
        right ^= right >>> 13;
    }
    return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

/** Opaque optimistic-concurrency token over the durable portfolio projection. */
export function createPortfolioRevision(portfolio: Portfolio): string {
    const durable = preparePortfolioForPersistence(portfolio);
    return `portfolio-revision-${revisionHash(stableJson(durable))}`;
}
