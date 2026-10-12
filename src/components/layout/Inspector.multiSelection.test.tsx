import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useUIStore } from '../../stores/useUIStore';
import Inspector from './Inspector';

describe('Inspector multi-selection state', () => {
    it('names the node editing controls and applies label and description edits', () => {
        useCanvasStore.setState({ selectedNodeIds: ['node-1'] });
        render(<Inspector />);
        expect(screen.getByRole('combobox', { name: 'Node Type' })).toHaveValue('action');
        fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Review need' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Check the request.' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Eyebrow Label' }), { target: { value: 'Support' } });
        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject({ label: 'Review need', data: { description: 'Check the request.', eyebrow: 'Support' } });
    });

    beforeEach(() => {
        useCanvasStore.setState({
            graph: {
                nodes: [
                    { id: 'node-1', type: 'action', label: 'A', position: { x: 0, y: 0 } },
                    { id: 'node-2', type: 'system', label: 'B', position: { x: 64, y: 0 } },
                ],
                edges: [],
                swimlanes: [],
            },
            selectedNodeIds: ['node-1', 'node-2'],
            selectedEdgeIds: [],
        });
        useUIStore.setState({
            inspectorOpen: true,
            selectedAssetId: null,
            selectedSwimlaneId: null,
        });
    });

    it.each(['row', 'column'] as const)('uses directional controls for a %s and deletes without node loss', axis => {
        useCanvasStore.getState().addSwimlane('First', 'blue', axis);
        useCanvasStore.getState().addSwimlane('Second', 'green', axis);
        const id = useCanvasStore.getState().graph.swimlanes[0].id;
        useUIStore.getState().selectSwimlane(id);
        render(<Inspector />);
        const previous = axis === 'row' ? 'Move up' : 'Move left';
        const next = axis === 'row' ? 'Move down' : 'Move right';
        expect(screen.getByRole('button', { name: previous })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: next }));
        expect(screen.getByRole('button', { name: next })).toBeDisabled();
        expect(screen.getByRole('button', { name: previous })).toBeEnabled();
        const remove = screen.getByRole('button', { name: `Delete ${axis}` });
        expect(remove).toHaveClass('nemoto-button-danger');
        expect(remove.querySelector('svg')).not.toBeNull();
        fireEvent.click(remove);
        expect(useCanvasStore.getState().graph.swimlanes).toHaveLength(1);
        expect(useCanvasStore.getState().graph.nodes).toHaveLength(2);
    });

    it('shows a group summary instead of the first node properties', () => {
        render(<Inspector />);

        expect(screen.getByText('2 Selected')).toBeInTheDocument();
        expect(screen.getByTestId('multi-selection-inspector')).toHaveTextContent('2 nodes');
        expect(screen.getByText('Drag any selected node to move the entire group.')).toBeInTheDocument();
        expect(screen.queryByText('Identity')).not.toBeInTheDocument();
    });

    it('clears stale dimensions when changing a node shape', () => {
        useCanvasStore.setState({
            graph: {
                nodes: [{
                    id: 'node-1',
                    type: 'decision',
                    label: 'Plexus identifierar produkt',
                    position: { x: 0, y: 0 },
                    width: 224,
                    height: 160,
                }],
                edges: [],
                swimlanes: [],
            },
            selectedNodeIds: ['node-1'],
            selectedEdgeIds: [],
        });
        render(<Inspector />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Node Type' }), { target: { value: 'system' } });

        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject({
            type: 'system',
            width: undefined,
            height: undefined,
        });
    });

    it('converts a normal node into an editable Event with a safe default', () => {
        useCanvasStore.setState({
            graph: {
                nodes: [{
                    id: 'node-1',
                    type: 'action',
                    label: 'Review milestone',
                    position: { x: 0, y: 0 },
                }],
                edges: [],
                swimlanes: [],
            },
            selectedNodeIds: ['node-1'],
            selectedEdgeIds: [],
        });
        render(<Inspector />);

        fireEvent.change(screen.getByRole('combobox', { name: 'Node Type' }), { target: { value: 'event' } });

        expect(useCanvasStore.getState().graph.nodes[0]).toMatchObject({
            type: 'event',
            event: {
                kind: 'generic',
                behavior: 'neutral',
            },
        });
        expect(useCanvasStore.getState().graph.nodes[0].event?.timing).toBeUndefined();
    });
});
