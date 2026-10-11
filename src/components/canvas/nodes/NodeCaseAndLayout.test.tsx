import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReactFlowProvider, type NodeProps } from 'reactflow';
import { ThemeProvider } from '../../../context/ThemeContext';
import { DecisionNode, SystemNode } from './index';

const nodeProps = (id: string, label: string): NodeProps => ({
    id,
    data: { label },
    selected: false,
    type: 'test',
    zIndex: 1,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    dragging: false,
});

describe('case-preserving canvas nodes', () => {
    it('preserves decision label casing and gives compound words a wider wrapping area', () => {
        render(
            <ThemeProvider>
                <ReactFlowProvider>
                    <DecisionNode {...nodeProps('decision-1', 'Produktspecifika frågor')} />
                </ReactFlowProvider>
            </ThemeProvider>,
        );

        const label = screen.getByText('Produktspecifika frågor');
        expect(label).not.toHaveClass('uppercase');
        expect(label).toHaveClass('w-[152px]', 'max-w-[152px]');
        expect(label).toHaveStyle({ textTransform: 'none' });
    });

    it('preserves system label casing', () => {
        render(
            <ThemeProvider>
                <ReactFlowProvider>
                    <SystemNode {...nodeProps('system-1', 'Plexus API')} />
                </ReactFlowProvider>
            </ThemeProvider>,
        );

        const label = screen.getByText('Plexus API');
        expect(label).not.toHaveClass('uppercase');
        expect(label).toHaveStyle({ textTransform: 'none' });
    });
});
