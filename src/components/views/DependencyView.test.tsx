import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '../../types';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { useUIStore } from '../../stores/useUIStore';
import DependencyView from './DependencyView';

vi.mock('reactflow', async () => {
    const ReactModule = await import('react');

    const ReactFlow = ({ nodes, edges, onNodeClick, onInit, children }: any) => {
        ReactModule.useEffect(() => {
            onInit?.({ fitView: vi.fn() });
        }, [onInit]);

        return (
            <div
                data-testid="dependency-graph"
                data-node-count={nodes.length}
                data-edge-count={edges.length}
                data-edge-handles={edges.map((edge: any) => `${edge.sourceHandle}:${edge.targetHandle}`).join('|')}
            >
                {nodes.map((node: any) => (
                    <button
                        type="button"
                        key={node.id}
                        aria-label={`Graph node ${node.data.label}`}
                        onClick={event => onNodeClick?.(event, node)}
                    >
                        {node.data.label}
                    </button>
                ))}
                {children}
            </div>
        );
    };

    return {
        Background: () => null,
        BackgroundVariant: { Dots: 'dots' },
        Handle: () => null,
        MarkerType: { ArrowClosed: 'arrowclosed' },
        Panel: ({ children }: any) => <div>{children}</div>,
        Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
        ReactFlow,
        ReactFlowProvider: ({ children }: any) => <>{children}</>,
        useEdgesState: (initial: any[]) => {
            const [value, setValue] = ReactModule.useState(initial);
            return [value, setValue, vi.fn()];
        },
        useNodesState: (initial: any[]) => {
            const [value, setValue] = ReactModule.useState(initial);
            return [value, setValue, vi.fn()];
        },
    };
});

const timestamp = '2026-08-10T00:00:00.000Z';

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
                mode: 'blank',
                swimlanes: [],
                nodes: [
                    { id: 'step-1', type: 'action', label: 'Detect incident', position: { x: 0, y: 0 }, assetIds: ['asset-1'] },
                    { id: 'step-2', type: 'action', label: 'Notify owner', position: { x: 100, y: 0 }, assetIds: ['asset-2'] },
                ],
                edges: [{ id: 'flow-1', sourceId: 'step-1', targetId: 'step-2', style: 'solid' }],
            },
            subGraphs: {},
        }],
        processFolders: [],
        assets: [
            { id: 'asset-1', name: 'Monitoring', type: 'system' },
            { id: 'asset-2', name: 'On-call role', type: 'role' },
            { id: 'asset-3', name: 'Unused handbook', type: 'document' },
        ],
        assetCategories: [],
        incidents: [],
        journal: {
            notebooks: [{ id: 'notebook-1', title: 'Operations', createdAt: timestamp, updatedAt: timestamp }],
            folders: [],
            tags: [{ id: 'tag-1', label: 'Critical', color: 'red' }],
            entries: [{
                id: 'entry-1',
                notebookId: 'notebook-1',
                title: 'Incident notes',
                content: '<p>Notes</p>',
                contentFormat: 'html',
                contentVersion: 1,
                tags: ['tag-1'],
                linkedContext: [{ id: 'step-1', type: 'node', processId: 'process-1' }],
                createdAt: timestamp,
                updatedAt: timestamp,
            }],
        },
    };
}

describe('DependencyView', () => {
    beforeEach(() => {
        usePortfolioStore.setState({ portfolio: createPortfolio() });
        useProcessSessionStore.getState().setActiveProcess('process-1');
        useUIStore.setState({
            gravityWellFocalPoint: null,
            gravityWellProcessIds: [],
            gravityWellFolderId: null,
        });
    });

    it('renders a useful portfolio overview by default', async () => {
        render(<DependencyView />);

        expect(screen.getByRole('heading', { name: 'Dependency Map' })).toBeInTheDocument();
        expect(screen.getByText('Portfolio overview')).toBeInTheDocument();
        const controls = screen.getByRole('complementary', { name: 'Dependency controls' });
        expect(controls.parentElement).toHaveClass('absolute', 'inset-0');
        expect(controls.querySelector('.app-scroll')).toHaveClass('overflow-y-auto');
        expect(screen.getByRole('searchbox', { name: 'Search for a focal point' })).toHaveClass('nemoto-field-leading-icon');

        await waitFor(() => {
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '3');
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '2');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Show 1 unlinked resource' }));
        await waitFor(() => {
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '4');
        });
    });

    it('summarizes a process scope before revealing detailed relationships through focus', async () => {
        render(<DependencyView />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Add a process to scope' }), {
            target: { value: 'process-1' },
        });

        const scopedProcess = await screen.findByRole('button', { name: 'Graph node Incident response' });
        expect(screen.getAllByText('Process scope')).toHaveLength(2);
        expect(screen.getByText('Scoped overview')).toBeInTheDocument();
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '3');
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '2');
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute(
            'data-edge-handles',
            'source-l:target-r|source-l:target-r',
        );
        expect(screen.queryByRole('button', { name: 'Graph node Detect incident' })).not.toBeInTheDocument();

        fireEvent.click(scopedProcess);

        expect(await screen.findByRole('heading', { name: 'Selected entity' })).toBeInTheDocument();
        expect(screen.getByText('Direct relationships (2)')).toBeInTheDocument();
        expect(screen.getAllByText('Monitoring').length).toBeGreaterThan(0);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search for a focal point' }), {
            target: { value: 'Incident response' },
        });
        fireEvent.click(within(screen.getByLabelText('Focal point search results')).getByRole('button', { name: /Incident response/ }));

        expect(await screen.findByRole('button', { name: 'Graph node Detect incident' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Graph node Notify owner' })).toBeInTheDocument();
    });

    it('renders readable punctuation in dependency controls', () => {
        render(<DependencyView />);
        expect(screen.getByRole('searchbox', { name: 'Search for a focal point' })).toHaveAttribute('placeholder', 'Search entities…');
        expect(screen.getByRole('option', { name: 'Add process…' })).toBeInTheDocument();
        expect(screen.getByTestId('dependency-graph').parentElement?.textContent).not.toMatch(/Â|â€|�/);
    });

    it('keeps portfolio data issues compact until expanded', async () => {
        const portfolio = createPortfolio();
        portfolio.journal!.entries[0].linkedContext!.push({ id: 'missing-resource', type: 'asset' });
        usePortfolioStore.setState({ portfolio });

        render(<DependencyView />);

        const issues = await screen.findByRole('button', { name: 'Portfolio issues · 1' });
        expect(issues).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('These portfolio-wide references point to entities that no longer exist and are excluded from the map.')).not.toBeInTheDocument();

        fireEvent.click(issues);

        expect(issues).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('These portfolio-wide references point to entities that no longer exist and are excluded from the map.')).toBeInTheDocument();
        expect(screen.getAllByText('Journal reference').length).toBeGreaterThan(0);
    });

    it('can isolate incoming or outgoing relationships around the focal point', async () => {
        render(<DependencyView />);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Search for a focal point' }), {
            target: { value: 'Monitoring' },
        });
        const results = screen.getByLabelText('Focal point search results');
        fireEvent.click(within(results).getByRole('button', { name: /Monitoring/ }));

        await waitFor(() => {
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '3');
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '1');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Out of' }));
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '1');
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '0');

        fireEvent.click(screen.getByRole('button', { name: 'Into' }));
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '2');
        expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '1');
    });

    it('turns a journal tag into an aggregate insight before showing individual notes', async () => {
        render(<DependencyView />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Filter by journal tag' }), {
            target: { value: 'tag-1' },
        });

        await waitFor(() => {
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '2');
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '1');
        });
        expect(screen.getByRole('status')).toHaveTextContent('1 tagged note points to 1 entity.');
        expect(screen.queryByRole('button', { name: 'Graph node Incident notes' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show 1 individual note' }));

        await waitFor(() => {
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-node-count', '4');
            expect(screen.getByTestId('dependency-graph')).toHaveAttribute('data-edge-count', '2');
        });
        expect(screen.getByRole('button', { name: 'Graph node Incident notes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Return to insight summary' })).toBeInTheDocument();
    });
});
