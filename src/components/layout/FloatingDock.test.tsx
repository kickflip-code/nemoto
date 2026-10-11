import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../../stores/useCanvasStore';
import { useUIStore } from '../../stores/useUIStore';
import FloatingDock from './FloatingDock';

describe('FloatingDock Event creation', () => {
    beforeEach(() => {
        useCanvasStore.getState().loadGraph({ nodes: [], edges: [], swimlanes: [] });
        useUIStore.setState({ activeTool: 'select' });
    });

    it('exposes divisions in the dock and keeps theme preview inert', () => {
        const { rerender } = render(<FloatingDock preview />);
        fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
        expect(useCanvasStore.getState().graph.swimlanes).toHaveLength(0);
        rerender(<FloatingDock />);
        fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
        expect(useCanvasStore.getState().graph.swimlanes).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Columns' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('creates a generic neutral Event without timing', () => {
        render(<FloatingDock />);

        fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));

        expect(useCanvasStore.getState().graph.nodes).toEqual([
            expect.objectContaining({
                type: 'event',
                label: 'New Event',
                event: {
                    kind: 'generic',
                    behavior: 'neutral',
                },
            }),
        ]);
        expect(useCanvasStore.getState().graph.nodes[0].event?.timing).toBeUndefined();
    });

    it('hides creation controls while an imported graph is being previewed', () => {
        useCanvasStore.getState().setPreviewGraph({ nodes: [], edges: [], swimlanes: [] });
        render(<FloatingDock />);
        expect(screen.queryByRole('button', { name: 'Add Event' })).not.toBeInTheDocument();
    });
});
