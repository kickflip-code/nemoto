import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReactFlowProvider } from 'reactflow';
import { ViewerEventNode, DecisionNode } from './ViewerNodeTypes';

describe('offline viewer Event renderer', () => {
    it('keeps an Event palette choice in the exported rendering', () => {
        const { container } = render(
            <ReactFlowProvider>
                <ViewerEventNode
                    id="event-color"
                    type="event"
                    data={{
                        label: 'Fraud warning published',
                        color: 'red',
                        event: { kind: 'signal', behavior: 'emitted' },
                    }}
                    selected
                    zIndex={1}
                    isConnectable={false}
                    xPos={0}
                    yPos={0}
                    dragging={false}
                />
            </ReactFlowProvider>,
        );

        const colorScope = container.querySelector<HTMLElement>('div[style*="--node-accent-color"]');
        const eventShape = container.querySelector<HTMLElement>('[data-event-kind="signal"]');

        expect(colorScope?.style.getPropertyValue('--node-accent-color')).toBe('var(--palette-red, #ef4444)');
        expect(colorScope?.style.getPropertyValue('--node-border-color')).toBe('var(--palette-red, #ef4444)');
        expect(colorScope?.style.getPropertyValue('--node-bg-color')).toBe('var(--color-node-event-bg)');
        expect(eventShape?.style.borderColor).toBe('var(--node-border-color)');
        expect(eventShape?.style.getPropertyValue('--tw-ring-color')).toBe('var(--node-accent-color)');
    });

    it('renders the same process-event contract as the main canvas', () => {
        render(
            <ReactFlowProvider>
                <ViewerEventNode
                    id="event-1"
                    type="event"
                    data={{
                        label: 'Temperature exceeds 80 °C',
                        event: {
                            kind: 'condition',
                            behavior: 'observed',
                        },
                    }}
                    selected={false}
                    zIndex={1}
                    isConnectable={false}
                    xPos={0}
                    yPos={0}
                    dragging={false}
                />
            </ReactFlowProvider>,
        );

        expect(screen.getByText('Temperature exceeds 80 °C')).toBeInTheDocument();
        expect(screen.getByText(/Condition Event/)).toBeInTheDocument();
        expect(screen.getByText('Observed')).toBeInTheDocument();
        expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
    });

    it('preserves white Event contrast mapping in the offline viewer', () => {
        render(
            <ReactFlowProvider>
                <ViewerEventNode
                    id="event-white"
                    type="event"
                    data={{
                        label: 'White event',
                        color: 'white',
                        event: { kind: 'message', behavior: 'emitted' },
                    }}
                    selected={false}
                    zIndex={1}
                    isConnectable={false}
                    xPos={0}
                    yPos={0}
                    dragging={false}
                />
            </ReactFlowProvider>,
        );

        expect(screen.getByText('Emitted')).toHaveStyle({
            color: 'var(--palette-white-text, var(--color-text-main))',
            backgroundColor: 'color-mix(in srgb, var(--palette-white-text, var(--color-text-main)) 12%, transparent)',
        });
    });

    it('renders decision labels with the same palette accent as the main canvas in Void', () => {
        document.documentElement.setAttribute('data-theme', 'void');
        const { container } = render(
            <ReactFlowProvider>
                <DecisionNode
                    id="decision-1"
                    type="decision"
                    data={{ label: 'Approve refund?' }}
                    selected={false}
                    zIndex={1}
                    isConnectable={false}
                    xPos={0}
                    yPos={0}
                    dragging={false}
                />
            </ReactFlowProvider>,
        );

        const textSpan = container.querySelector('.shape-diamond-content span');
        expect(textSpan).toBeInTheDocument();
        expect(textSpan).toHaveTextContent('Approve refund?');
        expect(textSpan).toHaveStyle({ color: 'var(--palette-white, #e4e4e7)' });
    });
});
