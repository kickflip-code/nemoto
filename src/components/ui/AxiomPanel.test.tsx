import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
    AxiomPanel,
    AxiomPanelBody,
    AxiomPanelCard,
    AxiomPanelDivider,
    AxiomPanelHeader,
    AxiomPanelIconButton,
    AxiomPanelRowButton,
} from './AxiomPanel';

describe('AxiomPanel', () => {
    it('composes the shared panel structure without hiding native semantics', () => {
        render(
            <AxiomPanel as="aside" aria-label="Inspector">
                <AxiomPanelHeader>Properties</AxiomPanelHeader>
                <AxiomPanelBody>
                    <AxiomPanelCard>Card</AxiomPanelCard>
                    <AxiomPanelDivider />
                    <AxiomPanelRowButton selected>Selected row</AxiomPanelRowButton>
                    <AxiomPanelIconButton aria-label="Close inspector">×</AxiomPanelIconButton>
                </AxiomPanelBody>
            </AxiomPanel>,
        );

        expect(screen.getByRole('complementary', { name: 'Inspector' })).toHaveClass('axiom-panel');
        expect(screen.getByText('Properties')).toHaveClass('axiom-panel-header');
        expect(screen.getByText('Card')).toHaveClass('axiom-panel-card');
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
        expect(screen.getByRole('button', { name: 'Selected row' })).toHaveClass('axiom-panel-row-selected');
        expect(screen.getByRole('button', { name: 'Close inspector' })).toHaveClass('axiom-panel-icon-button');
    });
});
