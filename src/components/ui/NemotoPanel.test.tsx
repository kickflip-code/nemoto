import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
    NemotoPanel,
    NemotoPanelBody,
    NemotoPanelCard,
    NemotoPanelDivider,
    NemotoPanelHeader,
    NemotoPanelIconButton,
    NemotoPanelRowButton,
} from './NemotoPanel';

describe('NemotoPanel', () => {
    it('composes the shared panel structure without hiding native semantics', () => {
        render(
            <NemotoPanel as="aside" aria-label="Inspector">
                <NemotoPanelHeader>Properties</NemotoPanelHeader>
                <NemotoPanelBody>
                    <NemotoPanelCard>Card</NemotoPanelCard>
                    <NemotoPanelDivider />
                    <NemotoPanelRowButton selected>Selected row</NemotoPanelRowButton>
                    <NemotoPanelIconButton aria-label="Close inspector">×</NemotoPanelIconButton>
                </NemotoPanelBody>
            </NemotoPanel>,
        );

        expect(screen.getByRole('complementary', { name: 'Inspector' })).toHaveClass('nemoto-panel');
        expect(screen.getByText('Properties')).toHaveClass('nemoto-panel-header');
        expect(screen.getByText('Card')).toHaveClass('nemoto-panel-card');
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
        expect(screen.getByRole('button', { name: 'Selected row' })).toHaveClass('nemoto-panel-row-selected');
        expect(screen.getByRole('button', { name: 'Close inspector' })).toHaveClass('nemoto-panel-icon-button');
    });
});
