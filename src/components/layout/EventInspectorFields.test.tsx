import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';
import { EventInspectorFields } from './EventInspectorFields';

const node = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
    id: 'event-1',
    type: 'event',
    label: 'Review',
    position: { x: 0, y: 0 },
    event: {
        kind: 'timer',
        behavior: 'observed',
        timing: {
            start: { kind: 'date', precision: 'day', value: '2026-09-06' },
        },
    },
    ...overrides,
});

describe('Event inspector', () => {
    it('edits process kind and behavior independently', () => {
        const onChange = vi.fn();
        render(<EventInspectorFields node={node({ event: { kind: 'generic', behavior: 'neutral' } })} onChange={onChange} />);

        expect(screen.getByRole('button', { name: /Timing/ })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByLabelText('Event start')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Timing/ }));
        expect(screen.getByLabelText('Event start')).toHaveValue('');
        expect(screen.getByLabelText('Event end')).toHaveValue('');
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Event kind'), { target: { value: 'condition' } });
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'condition', behavior: 'neutral' }));
        expect(screen.getByLabelText('Event start')).toHaveValue('');

        fireEvent.change(screen.getByLabelText('Event behavior'), { target: { value: 'emitted' } });
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'generic', behavior: 'emitted' }));
        expect(screen.getByLabelText('Event start')).toHaveValue('');
    });

    it('commits a valid optional timing interval and supports all-day events', () => {
        const onChange = vi.fn();
        render(<EventInspectorFields node={node()} onChange={onChange} />);

        const end = screen.getByLabelText('Event end');
        fireEvent.change(end, { target: { value: '2026-09-07' } });
        fireEvent.blur(end);

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'timer',
            behavior: 'observed',
            timing: expect.objectContaining({
                start: { kind: 'date', precision: 'day', value: '2026-09-06' },
                end: { kind: 'date', precision: 'day', value: '2026-09-07' },
            }),
        }));

        fireEvent.click(screen.getByLabelText('All-day event'));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
            timing: expect.objectContaining({ allDay: true }),
        }));
    });

    it('shows validation feedback and does not commit an end before start', () => {
        const onChange = vi.fn();
        render(<EventInspectorFields node={node()} onChange={onChange} />);

        const end = screen.getByLabelText('Event end');
        fireEvent.change(end, { target: { value: '2026-09-05' } });
        fireEvent.blur(end);

        expect(screen.getByRole('alert')).toHaveTextContent('cannot be earlier');
        expect(onChange).not.toHaveBeenCalled();
    });
});
