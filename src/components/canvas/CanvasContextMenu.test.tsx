import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useUIStore } from '../../stores/useUIStore';
import CanvasContextMenu from './CanvasContextMenu';

vi.mock('../shared/ContextMenu', () => ({
    default: ({ items }: { items: Array<{ label?: string; action?: () => void; separator?: boolean }> }) => (
        <div>
            {items.filter(item => !item.separator).map(item => (
                <button key={item.label} type="button" onClick={item.action}>{item.label}</button>
            ))}
        </div>
    ),
}));

vi.mock('sonner', () => ({
    toast: { success: vi.fn() },
}));

describe('CanvasContextMenu deletion', () => {
    beforeEach(() => {
        useCanvasStore.temporal.getState().resume();
        useCanvasStore.getState().loadGraph({
            nodes: [
                { id: 'node-1', type: 'action', label: 'A', position: { x: 0, y: 0 } },
                { id: 'node-2', type: 'system', label: 'B', position: { x: 100, y: 0 } },
            ],
            edges: [{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', style: 'solid' }],
            swimlanes: [],
        });
        useCanvasStore.getState().selectElements(['node-1'], []);
        useUIStore.setState({ inspectorOpen: true });
    });

    it('removes the node and every incident connection in one undo step', () => {
        render(<CanvasContextMenu nodeId="node-1" x={10} y={10} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(useCanvasStore.getState().graph.nodes.map(node => node.id)).toEqual(['node-2']);
        expect(useCanvasStore.getState().graph.edges).toEqual([]);
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        expect(useUIStore.getState().inspectorOpen).toBe(false);

        useCanvasStore.temporal.getState().undo();
        expect(useCanvasStore.getState().graph.nodes).toHaveLength(2);
        expect(useCanvasStore.getState().graph.edges).toHaveLength(1);
    });

    it('duplicates Event semantics and extensions with a fresh node identity', () => {
        useCanvasStore.getState().loadGraph({
            nodes: [{
                id: 'event-1',
                type: 'event',
                label: 'Review',
                position: { x: 0, y: 0 },
                event: {
                    kind: 'milestone',
                    behavior: 'neutral',
                    timing: {
                        start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                    },
                    extensions: { 'org.example.process': { id: '42' } },
                },
            }],
            edges: [],
            swimlanes: [],
        });
        render(<CanvasContextMenu nodeId="event-1" x={10} y={10} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

        const [source, duplicate] = useCanvasStore.getState().graph.nodes;
        expect(duplicate.id).not.toBe(source.id);
        expect(duplicate.event).toEqual(source.event);
        expect(duplicate.event).not.toBe(source.event);
    });

    it('duplicates the selected group from its context menu and remaps parent links', () => {
        useCanvasStore.getState().updateNode('node-2', { parentId: 'node-1' });
        useCanvasStore.getState().selectNodes(['node-1', 'node-2']);
        useCanvasStore.temporal.getState().clear();
        render(<CanvasContextMenu nodeId="node-2" x={10} y={10} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        const { graph, selectedNodeIds } = useCanvasStore.getState();
        const [parent, child] = graph.nodes.slice(2);
        expect(child.parentId).toBe(parent.id);
        expect(child.position).toEqual({ x: 100, y: 0 });
        expect(parent.position).toEqual({ x: 32, y: 32 });
        expect(selectedNodeIds).toEqual([parent.id, child.id]);
        expect(graph.edges[1]).toMatchObject({ sourceId: parent.id, targetId: child.id });
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
    });

    it('duplicates only the context node when it is outside the selection', () => {
        render(<CanvasContextMenu nodeId="node-2" x={10} y={10} onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
        const { graph, selectedNodeIds } = useCanvasStore.getState();
        expect(graph.nodes).toHaveLength(3);
        expect(graph.nodes[2].label).toBe('B');
        expect(graph.edges).toHaveLength(1);
        expect(selectedNodeIds).toEqual([graph.nodes[2].id]);
    });
});
