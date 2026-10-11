import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider, useStoreApi } from 'reactflow';
import CanvasToolbar from './CanvasToolbar';

vi.mock('./BreadcrumbNav', () => ({ default: () => null }));

describe('compact canvas view controls', () => {
    it('tracks the live viewport zoom and keeps view actions icon-only', () => {
        let flowStore: ReturnType<typeof useStoreApi>;
        function Capture() { flowStore = useStoreApi(); return null; }
        render(<ReactFlowProvider><Capture /><CanvasToolbar /></ReactFlowProvider>);
        expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');
        act(() => flowStore.setState({ transform: [20, 40, 0.8] }));
        expect(screen.getByLabelText('Zoom level')).toHaveTextContent('80%');
        act(() => flowStore.setState({ transform: [0, 0, 1.25] }));
        expect(screen.getByLabelText('Zoom level')).toHaveTextContent('125%');
        for (const name of ['Read map', 'Show linked content', 'Toggle Grid']) {
            expect(screen.getByRole('button', { name })).toHaveTextContent('');
            expect(screen.getByRole('button', { name })).toHaveAttribute('title');
        }
        expect(screen.queryByRole('group', { name: 'Division' })).not.toBeInTheDocument();
    });
});
