import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Asset, CanvasNode } from '../../types';
import type { JournalEntry } from '../../types/journal';
import { buildNodeLinkedContent, NodeLinkedContent } from './NodeLinkedContent';

describe('node linked content', () => {
    it('resolves existing resources and typed Journal links, including scoped references', () => {
        const nodes = ['both', 'missing', 'wrong-type', 'other-process', 'legacy'].map(id => ({
            id, type: 'action', label: id, position: { x: 0, y: 0 }, assetIds: ['deleted'],
        })) as CanvasNode[];
        nodes[0].assetIds = ['asset'];
        nodes[4] = { ...nodes[4], type: 'resource', assetIds: [], data: { assetId: 'asset' } };
        const assets = [{ id: 'asset' }] as Asset[];
        const entries = [{ linkedContext: [
            { type: 'node', id: 'both', processId: 'process' },
            { type: 'asset', id: 'wrong-type' },
            { type: 'node', id: 'other-process', processId: 'elsewhere' },
        ] }] as JournalEntry[];
        const result = buildNodeLinkedContent(nodes, assets, entries, 'process', true);
        expect([...result]).toEqual([
            ['both', { resources: true, journal: true }],
            ['legacy', { resources: true, journal: false }],
        ]);
        expect(buildNodeLinkedContent(nodes, assets, entries, 'process', false).size).toBe(0);
    });

    it('shows only applicable named icons and removes them when hidden', () => {
        const { rerender } = render(<NodeLinkedContent content={{ resources: true, journal: true }} />);
        expect(screen.getByRole('img', { name: 'Linked resources' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Linked Journal notes' })).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        rerender(<NodeLinkedContent content={{ resources: false, journal: true }} />);
        expect(screen.queryByRole('img', { name: 'Linked resources' })).not.toBeInTheDocument();
        rerender(<NodeLinkedContent content={null} />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('renders package-owned indicator icon and singular/plural labels', () => {
        const indicator = {
            key: 'org.example.reviews\u0000reviews',
            count: 1,
            icon: 'ShieldCheck' as const,
            singularLabel: 'pending review',
            pluralLabel: 'pending reviews',
        };
        const { rerender } = render(<NodeLinkedContent content={{ resources: false, journal: false, indicators: [indicator] }} />);
        expect(screen.getByRole('img', { name: '1 pending review' })).toBeInTheDocument();

        rerender(<NodeLinkedContent content={{ resources: false, journal: false, indicators: [{ ...indicator, count: 2 }] }} />);
        expect(screen.getByRole('img', { name: '2 pending reviews' })).toBeInTheDocument();
        expect(screen.queryByText(/task/i)).not.toBeInTheDocument();
    });
});
