import { describe, expect, it } from 'vitest';
import { getDependencyEdgeStroke } from './dependencyEdgeStyles';

describe('Dependency View edge colors', () => {
    it('uses the semantic canvas edge token for structural links', () => {
        expect(getDependencyEdgeStroke('flow')).toBe('var(--color-canvas-edge)');
        expect(getDependencyEdgeStroke('gravity')).toBe('var(--color-canvas-edge)');
    });

    it('keeps accent colors for asset and reference links', () => {
        expect(getDependencyEdgeStroke('asset-link')).toBe('var(--color-accent-primary)');
        expect(getDependencyEdgeStroke('asset-reference')).toBe('var(--color-accent-primary)');
        expect(getDependencyEdgeStroke('process-resource')).toBe('var(--color-accent-primary)');
        expect(getDependencyEdgeStroke('reference')).toBe('var(--color-accent-warning)');
        expect(getDependencyEdgeStroke('journal-reference')).toBe('var(--color-accent-warning)');
        expect(getDependencyEdgeStroke('tag-membership')).toBe('var(--color-accent-purple)');
        expect(getDependencyEdgeStroke('tag-insight')).toBe('var(--color-accent-purple)');
    });
});
