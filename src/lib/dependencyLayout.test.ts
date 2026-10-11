import { describe, expect, it } from 'vitest';
import type { DependencyRelation, DependencyViewNode } from './dependencyGraph';
import {
    layoutDependencyGraph,
    layoutFocusedDependencyGraph,
    layoutProcessScope,
} from './dependencyLayout';

const nodes: DependencyViewNode[] = [
    { id: 'focus', type: 'process', label: 'Focus', depth: 0, isFocal: true },
    { id: 'b', type: 'node', label: 'Beta', depth: 1 },
    { id: 'a', type: 'node', label: 'Alpha', depth: 1 },
    { id: 'asset', type: 'asset', label: 'Asset', depth: 2 },
];

describe('dependency layout', () => {
    it('places a focal node at the origin and distance rings around it', () => {
        const layout = layoutDependencyGraph(nodes);
        const focal = layout.find(item => item.id === 'focus')!;
        const firstHop = layout.find(item => item.id === 'a')!;
        const secondHop = layout.find(item => item.id === 'asset')!;

        expect(focal.position).toEqual({ x: -115, y: -42 });
        expect(Math.hypot(
            firstHop.position.x + firstHop.width / 2,
            firstHop.position.y + firstHop.height / 2,
        )).toBeCloseTo(330, 5);
        expect(Math.hypot(
            secondHop.position.x + secondHop.width / 2,
            secondHop.position.y + secondHop.height / 2,
        )).toBeCloseTo(630, 5);
    });

    it('is deterministic for the same semantic input', () => {
        expect(layoutDependencyGraph(nodes)).toEqual(layoutDependencyGraph([...nodes].reverse()));
    });

    it('places focused dependencies in semantic incoming and outgoing columns', () => {
        const focusedNodes: DependencyViewNode[] = [
            { id: 'focus', type: 'asset', label: 'Incident system', depth: 0, isFocal: true },
            { id: 'step-a', type: 'node', label: 'Detect', depth: 1 },
            { id: 'step-b', type: 'node', label: 'Document', depth: 1 },
            { id: 'next', type: 'asset', label: 'Status page', depth: 1 },
            { id: 'process', type: 'process', label: 'Incident process', depth: 1, isContext: true },
        ];
        const focusedRelations: DependencyRelation[] = [
            { id: 'use-a', source: 'step-a', target: 'focus', type: 'asset-reference' },
            { id: 'use-b', source: 'step-b', target: 'focus', type: 'asset-reference' },
            { id: 'out', source: 'focus', target: 'next', type: 'asset-reference' },
            { id: 'contains-a', source: 'process', target: 'step-a', type: 'contains' },
            { id: 'contains-b', source: 'process', target: 'step-b', type: 'contains' },
        ];

        const layout = layoutFocusedDependencyGraph(focusedNodes, focusedRelations);
        const centerX = (id: string) => {
            const item = layout.find(candidate => candidate.id === id)!;
            return item.position.x + item.width / 2;
        };

        expect(centerX('process')).toBeLessThan(centerX('step-a'));
        expect(centerX('step-a')).toBeLessThan(centerX('focus'));
        expect(centerX('step-b')).toBe(centerX('step-a'));
        expect(centerX('focus')).toBeLessThan(centerX('next'));
        expect(new Set(layout.map(item => `${item.position.x}:${item.position.y}`)).size).toBe(layout.length);
        expect(layoutFocusedDependencyGraph([...focusedNodes].reverse(), [...focusedRelations].reverse()))
            .toEqual(layout);
    });

    it('uses grouped columns when no focal node exists', () => {
        const overview = nodes.map(node => ({ ...node, isFocal: false }));
        const layout = layoutDependencyGraph(overview);
        const process = layout.find(item => item.id === 'focus')!;
        const asset = layout.find(item => item.id === 'asset')!;

        expect(process.position.x).toBeLessThan(asset.position.x);
        expect(new Set(layout.map(item => `${item.position.x}:${item.position.y}`)).size).toBe(layout.length);
    });

    it('separates process-local and shared resources into unambiguous bands', () => {
        const scopeNodes: DependencyViewNode[] = [
            { id: 'p1', type: 'process', label: 'Alpha process', depth: 0 },
            { id: 'p2', type: 'process', label: 'Beta process', depth: 0 },
            { id: 'local', type: 'asset', label: 'Local resource', depth: 1 },
            { id: 'shared', type: 'asset', label: 'Shared resource', depth: 1 },
        ];
        const scopeRelations = [
            { id: 'r1', source: 'p1', target: 'local', type: 'process-resource' as const },
            { id: 'r2', source: 'p1', target: 'shared', type: 'process-resource' as const },
            { id: 'r3', source: 'p2', target: 'shared', type: 'process-resource' as const },
        ];
        const layout = layoutProcessScope(scopeNodes, scopeRelations);
        const local = layout.find(item => item.id === 'local')!;
        const process = layout.find(item => item.id === 'p1')!;
        const shared = layout.find(item => item.id === 'shared')!;

        expect(local.position.x).toBeLessThan(process.position.x);
        expect(process.position.x).toBeLessThan(shared.position.x);
        expect(new Set(layout.map(item => item.id))).toEqual(new Set(scopeNodes.map(item => item.id)));
    });
});
