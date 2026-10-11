import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { useUIStore } from '../../../stores/useUIStore';
import { EditableLabel } from './EditableLabel';

describe('EditableLabel text interaction', () => {
    beforeEach(() => {
        useCanvasStore.temporal.getState().resume();
        useCanvasStore.getState().loadGraph({
            nodes: [{ id: 'node-1', type: 'decision', label: 'Produktspecifika frågor', position: { x: 0, y: 0 } }],
            edges: [],
            swimlanes: [],
        });
        useUIStore.setState({ editingNodeId: null });
    });

    it('allows text selection without starting a canvas drag', () => {
        const onMouseDown = vi.fn();
        const onPointerDown = vi.fn();
        render(
            <div data-testid="native-drag-parent" onMouseDown={onMouseDown} onPointerDown={onPointerDown}>
                <EditableLabel
                    id="node-1"
                    label="Produktspecifika frågor"
                    color="#000"
                    multiline
                />
            </div>,
        );

        const nativeMouseDown = vi.fn();
        const nativePointerDown = vi.fn();
        const nativeParent = screen.getByTestId('native-drag-parent');
        nativeParent.addEventListener('mousedown', nativeMouseDown);
        nativeParent.addEventListener('pointerdown', nativePointerDown);

        const label = screen.getByText('Produktspecifika frågor');
        expect(label).toHaveClass('select-text', 'nodrag', 'nopan');
        expect(label).toHaveStyle({ userSelect: 'text' });

        fireEvent.mouseDown(label);
        fireEvent.pointerDown(label);
        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onPointerDown).not.toHaveBeenCalled();
        nativeMouseDown.mockClear();
        nativePointerDown.mockClear();

        fireEvent.doubleClick(label);
        const editor = screen.getByRole('textbox', { name: 'Edit node label' }) as HTMLTextAreaElement;

        expect(editor).toHaveStyle({ userSelect: 'text' });
        expect(editor).toHaveClass('select-text', 'nodrag', 'nopan');
        expect(editor).toHaveFocus();
        expect(editor.selectionStart).toBe(editor.value.length);
        expect(editor.selectionEnd).toBe(editor.value.length);
        expect(editor).toHaveAttribute('draggable', 'false');
        expect(useUIStore.getState().editingNodeId).toBe('node-1');
        editor.setSelectionRange(0, 14);
        expect(editor.selectionStart).toBe(0);
        expect(editor.selectionEnd).toBe(14);

        fireEvent.mouseDown(editor);
        fireEvent.pointerDown(editor);
        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onPointerDown).not.toHaveBeenCalled();
        expect(nativeMouseDown).not.toHaveBeenCalled();
        expect(nativePointerDown).not.toHaveBeenCalled();
    });

    it('keeps the editor open when an existing word is double-clicked', () => {
        const onParentDoubleClick = vi.fn();
        const onEditStart = vi.fn();
        const onEditEnd = vi.fn();
        render(
            <div onDoubleClick={onParentDoubleClick}>
                <EditableLabel
                    id="node-1"
                    label="Produktspecifika frågor"
                    color="#000"
                    multiline
                    onEditStart={onEditStart}
                    onEditEnd={onEditEnd}
                />
            </div>,
        );

        fireEvent.doubleClick(screen.getByText('Produktspecifika frågor'));
        const editor = screen.getByRole('textbox', { name: 'Edit node label' }) as HTMLTextAreaElement;
        editor.setSelectionRange(0, 15);

        fireEvent.doubleClick(editor);

        expect(screen.getByRole('textbox', { name: 'Edit node label' })).toBe(editor);
        expect(editor.selectionStart).toBe(0);
        expect(editor.selectionEnd).toBe(15);
        expect(onEditStart).toHaveBeenCalledTimes(1);
        expect(onEditEnd).not.toHaveBeenCalled();
        expect(onParentDoubleClick).not.toHaveBeenCalled();
        expect(useUIStore.getState().editingNodeId).toBe('node-1');
    });

    it('commits the edited label on blur', () => {
        render(
            <EditableLabel
                id="node-1"
                label="Produktspecifika frågor"
                color="#000"
                multiline
            />,
        );

        fireEvent.doubleClick(screen.getByText('Produktspecifika frågor'));
        const editor = screen.getByRole('textbox', { name: 'Edit node label' });
        fireEvent.change(editor, { target: { value: 'Valda produktspecifika frågor' } });
        fireEvent.blur(editor);

        expect(useCanvasStore.getState().graph.nodes[0].label).toBe('Valda produktspecifika frågor');
        expect(useCanvasStore.temporal.getState().pastStates).toHaveLength(1);
        expect(useUIStore.getState().editingNodeId).toBeNull();
    });
});
