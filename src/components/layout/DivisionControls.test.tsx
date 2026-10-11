import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DivisionControls from './DivisionControls';
import { DivisionBackground } from '../canvas/DivisionBackground';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasStore } from '../../stores/useCanvasStore';

describe('division controls', () => {
    beforeEach(() => { useUIStore.getState().selectSwimlane(null); useCanvasStore.getState().loadGraph({ mode: 'blank', nodes: [], edges: [], swimlanes: [] }); });
    it('adds and hides both directions directly in the toolbar without a dialog', async () => {
        const user = userEvent.setup();
        render(<DivisionControls />);
        expect(screen.getByRole('group', { name: 'Division' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Rows' }));
        await user.click(screen.getByRole('button', { name: 'Columns' }));
        expect(useCanvasStore.getState().graph.swimlanes).toHaveLength(2);
        expect(useCanvasStore.getState().graph.swimlanes.map(lane => lane.label)).toEqual(['Row 1', 'Column 1']);
        const before = structuredClone(useCanvasStore.getState().graph);
        await user.click(screen.getByRole('button', { name: 'Rows' }));
        expect(useCanvasStore.getState().graph.swimlanes).toEqual(before.swimlanes);
        expect(useCanvasStore.getState().graph.division!.rowsVisible).toBe(false);
        expect(useCanvasStore.getState().graph.division!.columnsVisible).toBe(true);
        screen.getByRole('button', { name: 'Rows' }).focus();
        await user.keyboard(' ');
        expect(useCanvasStore.getState().graph.swimlanes).toEqual(before.swimlanes);
        expect(screen.getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-pressed', 'true');
    });
    it('keeps selected-heading details out of the toolbar', () => {
        useCanvasStore.getState().addSwimlane('First', 'blue', 'row');
        useUIStore.getState().selectSwimlane(useCanvasStore.getState().graph.swimlanes[0].id);
        render(<DivisionControls />);
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });
    it('renames directly on the canvas with commit and cancel', async () => {
        const user = userEvent.setup();
        useCanvasStore.getState().addSwimlane('First', 'blue', 'row');
        const rename = vi.fn();
        render(<DivisionBackground graph={useCanvasStore.getState().graph} onSelect={vi.fn()} onRename={rename} />);
        await user.dblClick(screen.getByRole('button', { name: 'Edit row: First' }));
        const input = screen.getByRole('textbox', { name: 'Name of row' });
        await user.clear(input); await user.type(input, 'Renamed{Enter}');
        expect(rename).toHaveBeenCalledWith(expect.any(String), 'Renamed');
        await user.click(screen.getByRole('button', { name: 'Edit row: First' }));
        await user.keyboard('{F2}');
        await user.type(screen.getByRole('textbox'), 'Cancelled{Escape}');
        expect(rename).toHaveBeenCalledTimes(1);
    });
    it('resizes by keyboard and pointer at zoom without committing intermediate moves', () => {
        useCanvasStore.getState().addSwimlane('First', 'blue', 'column');
        const resize = vi.fn(); const graph = useCanvasStore.getState().graph;
        render(<DivisionBackground graph={graph} onResize={resize} getZoom={() => 2} />);
        const bar = screen.getByRole('separator', { name: 'Resize width: First' });
        fireEvent.keyDown(bar, { key: 'ArrowRight' });
        expect(resize).toHaveBeenLastCalledWith(graph.swimlanes[0].id, 'column', (graph.swimlanes[0].width ?? 300) + 16);
        resize.mockClear();
        bar.setPointerCapture = vi.fn(); bar.releasePointerCapture = vi.fn();
        fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 100 });
        fireEvent.pointerMove(bar, { pointerId: 1, clientX: 200 });
        expect(resize).not.toHaveBeenCalled();
        fireEvent.pointerUp(bar, { pointerId: 1, clientX: 200 });
        expect(resize).toHaveBeenCalledWith(graph.swimlanes[0].id, 'column', (graph.swimlanes[0].width ?? 300) + 50);
    });
    it('cancels a drag and records a completed resize as one undo step', () => {
        useCanvasStore.getState().addSwimlane('Row', 'blue', 'row');
        const before = structuredClone(useCanvasStore.getState().graph);
        useCanvasStore.temporal.getState().clear();
        function Connected() {
            const { graph, updateSwimlane } = useCanvasStore();
            return <DivisionBackground graph={graph} onResize={(id, axis, size) => updateSwimlane(id, axis === 'row' ? { height: size } : { width: size })} />;
        }
        render(<Connected />);
        const bar = screen.getByRole('separator');
        bar.setPointerCapture = vi.fn(); bar.releasePointerCapture = vi.fn();
        fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(bar, { pointerId: 1, clientY: 160 });
        fireEvent.keyDown(bar, { key: 'Escape' });
        fireEvent.pointerUp(bar, { pointerId: 1 });
        expect(useCanvasStore.getState().graph).toEqual(before);
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(0);
        fireEvent.pointerDown(bar, { button: 0, pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(bar, { pointerId: 2, clientY: 140 });
        fireEvent.pointerMove(bar, { pointerId: 2, clientY: 180 });
        fireEvent.pointerUp(bar, { pointerId: 2 });
        expect(useCanvasStore.getState().graph.swimlanes[0].height).toBe(before.swimlanes[0].height + 80);
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        act(() => useCanvasStore.temporal.getState().undo());
        expect(useCanvasStore.getState().graph).toEqual(before);
        act(() => useCanvasStore.temporal.getState().redo());
        expect(useCanvasStore.getState().graph.swimlanes[0].height).toBe(before.swimlanes[0].height + 80);
    });
    it('provides plus buttons at the canvas edges only in editing mode', () => {
        useCanvasStore.getState().addSwimlane('First', 'blue', 'row');
        useCanvasStore.getState().addSwimlane('Second', 'green', 'column');
        const add = vi.fn();
        const graph = useCanvasStore.getState().graph;
        const { rerender } = render(<DivisionBackground graph={graph} onAdd={add} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
        expect(add).toHaveBeenCalledWith('column');
        fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
        expect(add).toHaveBeenCalledWith('row');
        rerender(<DivisionBackground graph={graph} />);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
    it('opens a heading without bubbling into canvas deselection', () => {
        useCanvasStore.getState().addSwimlane('Heading', 'blue', 'row');
        const selected = vi.fn();
        const deselected = vi.fn();
        render(<div onClick={deselected}><DivisionBackground graph={useCanvasStore.getState().graph} onSelect={selected} /></div>);
        fireEvent.click(screen.getByRole('button', { name: 'Edit row: Heading' }));
        expect(selected).toHaveBeenCalledOnce();
        expect(deselected).not.toHaveBeenCalled();
    });
    it('renders both headers in the shared editor/viewer background and honors visibility', () => {
        useCanvasStore.getState().addSwimlane('Min rad', 'blue', 'row');
        useCanvasStore.getState().addSwimlane('Min kolumn', 'green', 'column');
        const { rerender } = render(<DivisionBackground graph={useCanvasStore.getState().graph} />);
        expect(screen.getByText('Min rad')).toBeInTheDocument();
        expect(screen.getByText('Min kolumn')).toBeInTheDocument();
        useCanvasStore.getState().setDivisionVisible('row', false);
        rerender(<DivisionBackground graph={useCanvasStore.getState().graph} />);
        expect(screen.queryByText('Min rad')).not.toBeInTheDocument();
        expect(screen.getByText('Min kolumn')).toBeInTheDocument();
    });
});
