import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReactFlowProvider } from 'reactflow';
import { CANVAS_NODE_TYPES, toFlowNode } from '../../components/canvas/flowConfiguration';
import { THEME_PREVIEW_NODES } from '../../components/canvas/CanvasThemePreview';
import {
    ActionNode,
    DecisionNode,
    EndNode,
    PostItNode,
    StartNode,
    SwimlaneNode,
    SystemNode,
    ViewerResourceNode,
    ViewerNodeTypes,
} from './ViewerNodeTypes';

const nodeProps = {
    id: 'node-1',
    selected: false,
    zIndex: 1,
    isConnectable: false,
    xPos: 0,
    yPos: 0,
    dragging: false,
};

const renderNode = (node: React.ReactElement) => render(
    <ReactFlowProvider>{node}</ReactFlowProvider>,
);

describe('offline viewer node parity', () => {
    it.each(['action', 'start', 'end', 'decision', 'system', 'resource', 'event', 'group', 'post-it'] as const)(
        'shows included resource and Journal indicators on %s nodes', type => {
            const Component = ViewerNodeTypes[type];
            const { rerender } = renderNode(<Component {...nodeProps} type={type} data={{
                label: 'Linked node', linkedContent: { resources: true, journal: true },
            }} />);
            expect(screen.getByRole('img', { name: 'Linked resources' })).toBeInTheDocument();
            expect(screen.getByRole('img', { name: 'Linked Journal notes' })).toBeInTheDocument();
            rerender(<ReactFlowProvider><Component {...nodeProps} type={type} data={{ label: 'Unlinked node' }} /></ReactFlowProvider>);
            expect(screen.queryByRole('img', { name: 'Linked resources' })).not.toBeInTheDocument();
            expect(screen.queryByRole('img', { name: 'Linked Journal notes' })).not.toBeInTheDocument();
        },
    );
    it('registers semantic drilldowns without the removed renderer, including Theme Studio', () => {
        expect(CANVAS_NODE_TYPES).not.toHaveProperty('subprocess');
        expect(ViewerNodeTypes).not.toHaveProperty('subprocess');
        const drilldown = THEME_PREVIEW_NODES.find(node => node.subGraphId);
        expect(drilldown?.type).toBe('action');
        expect(toFlowNode(drilldown!).data.hasDrilldown).toBe(true);
    });
    it.each([
        ['Start', StartNode, 'green', 'var(--palette-green, #22c55e)'],
        ['Action', ActionNode, 'blue', 'var(--palette-blue, #3b82f6)'],
        ['System', SystemNode, 'purple', 'var(--palette-purple, #a855f7)'],
        ['End', EndNode, 'red', 'var(--palette-red, #ef4444)'],
        ['Note', PostItNode, 'purple', 'var(--palette-purple, #a855f7)'],
    ])('uses the exported %s palette token for its label', (label, Component, color, expected) => {
        renderNode(
            <Component
                {...nodeProps}
                type={label.toLowerCase()}
                data={{ label, color }}
            />,
        );

        expect(screen.getByText(label)).toHaveStyle({ color: expected });
    });

    it('keeps the Decision content centered without the viewer-only outer padding', () => {
        document.documentElement.setAttribute('data-theme', 'void');
        const { container } = renderNode(
            <DecisionNode
                {...nodeProps}
                type="decision"
                data={{ label: 'Decision', color: 'white' }}
            />,
        );

        const shape = container.querySelector('.shape-diamond-container');
        const content = container.querySelector('.shape-diamond-content');

        expect(shape).not.toHaveClass('p-4');
        expect(content).toHaveClass('flex', 'items-center', 'justify-center', 'h-full', 'w-full');
        expect(screen.getByText('Decision')).toHaveStyle({ color: 'var(--palette-white, #e4e4e7)' });
    });

    it('renders the Resource badge, body, and metadata footer used by the canvas', () => {
        renderNode(
            <ViewerResourceNode
                {...nodeProps}
                type="resource"
                data={{
                    label: 'Fallback name',
                    color: 'blue',
                    width: 200,
                    height: 72,
                    assetId: 'asset-1',
                    asset: { id: 'asset-1', name: 'Incidenthanteringssystem', type: 'it-system', metadata: { owner: 'IT' } },
                    category: { id: 'it-system', label: 'IT-SYSTEM', color: 'blue', icon: 'database' },
                }}
            />,
        );

        expect(screen.getByText('IT-SYSTEM')).toHaveStyle({ color: 'var(--palette-blue, #3b82f6)' });
        expect(screen.getByText('Incidenthanteringssystem')).toBeInTheDocument();
        expect(screen.getByText('Resource')).toBeInTheDocument();
        expect(screen.getByText('1 prop')).toBeInTheDocument();
        expect(screen.getByText('Incidenthanteringssystem').closest('.shape-resource')).toHaveStyle({
            width: '224px',
            height: '96px',
        });
    });

    it('uses exported palette variables for swimlane accents and labels', () => {
        const { container } = renderNode(
            <SwimlaneNode
                {...nodeProps}
                type="swimlane"
                data={{ label: 'SERVICE DESK', color: 'blue', laneWidth: 2000, laneHeight: 300, isVertical: false }}
            />,
        );

        expect(screen.getByText('SERVICE DESK')).toHaveStyle({ color: 'var(--palette-blue, #3b82f6)' });
        const accents = [...container.querySelectorAll<HTMLElement>('div[style*="background-color"]')];
        expect(accents.some(element => (
            element.style.backgroundColor === 'var(--palette-blue, #3b82f6)'
        ))).toBe(true);
    });
});
