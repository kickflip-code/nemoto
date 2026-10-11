import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '../../types';
import { GravityView } from './GravityView';

vi.mock('reactflow', async () => {
    const ReactModule = await import('react');
    const ReactFlow = ({ nodes, edges, onNodeClick, onPaneClick, onInit }: any) => {
        ReactModule.useEffect(() => {
            onInit?.({ fitView: vi.fn() });
        }, [onInit]);
        return (
            <div data-testid="viewer-dependency-graph" data-node-count={nodes.length} data-edge-count={edges.length}>
                {nodes.map((node: any) => (
                    <button
                        type="button"
                        key={node.id}
                        aria-label={`Graph node ${node.data.label}`}
                        onClick={event => onNodeClick?.(event, node)}
                    >
                        {node.data.label} · {node.data.subtitle}
                    </button>
                ))}
                <button type="button" aria-label="Graph background" onClick={onPaneClick}>Background</button>
            </div>
        );
    };
    return {
        default: ReactFlow,
        Background: () => null,
        BackgroundVariant: { Dots: 'dots' },
        Handle: () => null,
        MarkerType: { ArrowClosed: 'arrowclosed' },
        Position: { Top: 'top', Right: 'right', Bottom: 'bottom', Left: 'left' },
        ReactFlow,
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
                    { id: 'step-2', type: 'action', label: 'Notify owner', position: { x: 100, y: 0 }, assetIds: [] },
                ],
                edges: [{ id: 'flow-1', sourceId: 'step-1', targetId: 'step-2', style: 'solid' }],
            },
            subGraphs: {},
        }],
        processFolders: [],
        assets: [{ id: 'asset-1', name: 'Monitoring', type: 'system' }],
        assetCategories: [{ id: 'system', label: 'IT system', icon: 'database', color: 'blue' }],
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

describe('export viewer Dependency Map', () => {
    const onNodeClick = vi.fn();

    beforeEach(() => onNodeClick.mockReset());

    it('opens on the same calm portfolio overview as the main application', async () => {
        render(<GravityView data={{ rootProcessId: 'process-1', data: createPortfolio() }} onNodeClick={onNodeClick} />);

        expect(screen.getByText('Portfolio overview')).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: 'Search for a focal point' })).toHaveClass('axiom-field-leading-icon');
        await waitFor(() => {
            expect(screen.getByTestId('viewer-dependency-graph')).toHaveAttribute('data-node-count', '2');
            expect(screen.getByTestId('viewer-dependency-graph')).toHaveAttribute('data-edge-count', '1');
        });
    });

    it('uses the same aggregate journal insight and optional note detail as the app', async () => {
        render(<GravityView data={{ rootProcessId: 'process-1', data: createPortfolio() }} onNodeClick={onNodeClick} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Filter by journal tag' }), {
            target: { value: 'tag-1' },
        });

        await waitFor(() => {
            expect(screen.getByTestId('viewer-dependency-graph')).toHaveAttribute('data-node-count', '2');
            expect(screen.getByTestId('viewer-dependency-graph')).toHaveAttribute('data-edge-count', '1');
        });
        expect(screen.getByRole('status')).toHaveTextContent('1 tagged note points to 1 entity.');
        expect(screen.getByRole('button', { name: 'Graph node Detect incident' })).toHaveTextContent('Step · Incident response');
        expect(screen.queryByRole('button', { name: 'Graph node Incident notes' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show 1 individual note' }));
        await waitFor(() => {
            expect(screen.getByTestId('viewer-dependency-graph')).toHaveAttribute('data-node-count', '4');
            expect(screen.getByTestId('viewer-dependency-graph')).toHaveAttribute('data-edge-count', '2');
        });
        expect(screen.getByRole('button', { name: 'Graph node Incident notes' })).toBeInTheDocument();
    });

    it('passes the original source entity to the viewer detail panel', async () => {
        render(<GravityView data={{ rootProcessId: 'process-1', data: createPortfolio() }} onNodeClick={onNodeClick} />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Filter by journal tag' }), {
            target: { value: 'tag-1' },
        });

        const step = await screen.findByRole('button', { name: 'Graph node Detect incident' });
        fireEvent.click(step);

        expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({
            id: 'step-1',
            type: 'node',
            assetIds: ['asset-1'],
            processId: 'process-1',
            dependencyRelations: [expect.objectContaining({
                label: 'Referenced by tagged notes',
                other: expect.objectContaining({ label: 'Critical', type: 'tag' }),
            })],
        }));
    });

    it('keeps graph and detail selection synchronized when clearing a selection', async () => {
        render(<GravityView data={{ rootProcessId: 'process-1', data: createPortfolio() }} onNodeClick={onNodeClick} />);

        const process = await screen.findByRole('button', { name: 'Graph node Incident response' });
        fireEvent.click(process);
        expect(onNodeClick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'process-1' }));

        fireEvent.click(process);
        expect(onNodeClick).toHaveBeenLastCalledWith(null);

        fireEvent.click(process);
        fireEvent.click(screen.getByRole('button', { name: 'Graph background' }));
        expect(onNodeClick).toHaveBeenLastCalledWith(null);
    });
});
