import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReactFlowProvider } from 'reactflow';
import { EventNode } from './EventNode';

const nodeProps = {
    id: 'event-node',
    selected: false,
    type: 'event',
    zIndex: 1,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
};

describe('EventNode', () => {
    it('uses an Inspector palette choice for its accent, border, handles, and selection ring', () => {
        const { container } = render(
            <ReactFlowProvider>
                <EventNode
                    {...nodeProps}
                    selected
                    data={{
                        label: 'Payment confirmed',
                        color: 'red',
                        event: { kind: 'message', behavior: 'observed' },
                    }}
                />
            </ReactFlowProvider>,
        );

        const colorScope = container.querySelector<HTMLElement>('div[style*="--node-accent-color"]');
        const eventShape = container.querySelector<HTMLElement>('[data-event-kind="message"]');
        const handle = container.querySelector<HTMLElement>('.react-flow__handle');

        expect(colorScope?.style.getPropertyValue('--node-accent-color')).toBe('var(--palette-red, #ef4444)');
        expect(colorScope?.style.getPropertyValue('--node-border-color')).toBe('var(--palette-red, #ef4444)');
        expect(eventShape?.style.borderColor).toBe('var(--node-border-color)');
        expect(eventShape?.style.getPropertyValue('--tw-ring-color')).toBe('var(--node-accent-color)');
        expect(handle).toHaveStyle({ background: 'var(--node-accent-color)' });
    });

    it('renders process kind and behavior without implying a calendar event', () => {
        render(
            <ReactFlowProvider>
                <EventNode
                    {...nodeProps}
                    data={{
                        label: 'Payment confirmed',
                        event: {
                            kind: 'message',
                            behavior: 'observed',
                        },
                    }}
                />
            </ReactFlowProvider>,
        );

        expect(screen.getByText('Payment confirmed')).toBeInTheDocument();
        expect(screen.getByText(/Message Event/)).toBeInTheDocument();
        expect(screen.getByText('Observed')).toBeInTheDocument();
        expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    });

    it('maps a white Event accent to the theme contrast token', () => {
        render(
            <ReactFlowProvider>
                <EventNode
                    {...nodeProps}
                    data={{
                        label: 'White event',
                        color: 'white',
                        event: { kind: 'message', behavior: 'emitted' },
                    }}
                />
            </ReactFlowProvider>,
        );

        expect(screen.getByText('Emitted')).toHaveStyle({
            color: 'var(--palette-white-text, var(--color-text-main))',
            backgroundColor: 'color-mix(in srgb, var(--palette-white-text, var(--color-text-main)) 12%, transparent)',
        });
    });

    it('renders timing only when the optional facet has a temporal value', () => {
        render(
            <ReactFlowProvider>
                <EventNode
                    {...nodeProps}
                    data={{
                        label: 'SLA expires',
                        event: {
                            kind: 'timer',
                            behavior: 'observed',
                            timing: {
                                start: { kind: 'date', precision: 'day', value: '2026-09-05' },
                                allDay: true,
                            },
                        },
                    }}
                />
            </ReactFlowProvider>,
        );

        expect(screen.getByText(/Timer Event/)).toBeInTheDocument();
        expect(screen.getByText(/2026/)).toBeInTheDocument();
    });

    it('degrades missing Event fields to a generic neutral node without timing', () => {
        render(
            <ReactFlowProvider>
                <EventNode {...nodeProps} data={{ label: '' }} />
            </ReactFlowProvider>,
        );

        expect(screen.getByText('Untitled Event')).toBeInTheDocument();
        expect(screen.getByText(/Generic Event/)).toBeInTheDocument();
        expect(screen.getByText('Neutral')).toBeInTheDocument();
        expect(screen.queryByText('No timing')).not.toBeInTheDocument();
    });
});
