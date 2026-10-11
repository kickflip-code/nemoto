import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '../../types';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import UnifiedManagementHub from './UnifiedManagementHub';

const timestamp = '2026-08-25T00:00:00.000Z';

function createPortfolio(): Portfolio {
    return {
        version: '1.0',
        lastModified: timestamp,
        processes: [{
            id: 'process-1',
            title: 'Incident response',
            createdAt: timestamp,
            updatedAt: timestamp,
            mode: 'blank',
            graph: {
                nodes: [{
                    id: 'node-1',
                    type: 'action',
                    label: 'Detect incident',
                    position: { x: 0, y: 0 },
                    assetIds: ['asset-used'],
                }],
                edges: [],
                swimlanes: [],
            },
            subGraphs: {},
        }],
        processFolders: [],
        assets: [
            { id: 'asset-used', name: 'Monitoring', type: 'systems' },
            { id: 'asset-unused', name: 'Unused handbook', type: 'documents' },
        ],
        assetCategories: [
            { id: 'systems', label: 'Systems', icon: 'Box', color: 'blue' },
            { id: 'documents', label: 'Documents', icon: 'FileText', color: 'gray' },
        ],
        incidents: [],
        journal: {
            notebooks: [
                { id: 'notebook-used', title: 'Operations', createdAt: timestamp, updatedAt: timestamp },
                { id: 'notebook-empty', title: 'Empty notebook', createdAt: timestamp, updatedAt: timestamp },
            ],
            folders: [],
            tags: [],
            entries: [
                {
                    id: 'entry-linked',
                    notebookId: 'notebook-used',
                    title: 'Incident notes',
                    content: '<p>Linked</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [{ id: 'asset-used', type: 'asset' }],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
                {
                    id: 'entry-unlinked',
                    notebookId: 'notebook-used',
                    title: 'Loose note',
                    content: '<p>Unlinked</p>',
                    contentFormat: 'html',
                    contentVersion: 1,
                    tags: [],
                    linkedContext: [],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                },
            ],
        },
    };
}

describe('Manage portfolio', () => {
    beforeEach(() => {
        usePortfolioStore.setState({
            portfolio: createPortfolio(),
            deleteAssets: vi.fn(),
            deleteEntry: vi.fn(),
            deleteNotebook: vi.fn(),
            deleteProcess: vi.fn(),
        });
    });

    it('starts with a calm overview and reveals neutral unlinked filters on demand', () => {
        render(<UnifiedManagementHub isOpen onClose={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Manage portfolio' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('3 unlinked items')).toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show unlinked resources' }));

        expect(screen.getByRole('button', { name: 'Content' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Resources' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('searchbox', { name: 'Search resources' })).toHaveClass(
            'axiom-field-leading-icon',
            'axiom-field-trailing-action',
        );
        expect(screen.getByRole('button', { name: 'Unlinked · 1' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Unused handbook')).toBeInTheDocument();
        expect(screen.getByText('Unlinked')).toHaveClass('text-text-muted');
        expect(screen.queryByText('Monitoring')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select Unused handbook' }));
        expect(screen.getByRole('button', { name: 'Delete 1' })).toBeInTheDocument();
    });

    it('removes the unlinked surface when the portfolio is in order', () => {
        const portfolio = createPortfolio();
        portfolio.assets = portfolio.assets.filter(asset => asset.id !== 'asset-unused');
        portfolio.journal.entries = portfolio.journal.entries.filter(entry => entry.id !== 'entry-unlinked');
        portfolio.journal.notebooks = portfolio.journal.notebooks.filter(notebook => notebook.id !== 'notebook-empty');
        usePortfolioStore.setState({ portfolio });

        render(<UnifiedManagementHub isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Everything is in order')).toBeInTheDocument();
        expect(screen.queryByText(/\d+ unlinked items?/)).not.toBeInTheDocument();
    });
});
