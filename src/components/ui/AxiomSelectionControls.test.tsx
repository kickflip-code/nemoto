import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    AxiomChoiceCard,
    AxiomColorSwatch,
    AxiomIconTile,
    AxiomSegmented,
    AxiomSegmentedOption,
    AxiomSwitch,
    AxiomToggleCard,
} from './AxiomSelectionControls';

describe('Nemoto selection controls', () => {
    it('exposes the selected segmented option', () => {
        render(
            <AxiomSegmented aria-label="Orientation">
                <AxiomSegmentedOption active>Horizontal</AxiomSegmentedOption>
                <AxiomSegmentedOption active={false}>Vertical</AxiomSegmentedOption>
            </AxiomSegmented>,
        );

        expect(screen.getByRole('group', { name: 'Orientation' })).toHaveClass('axiom-segmented');
        expect(screen.getByRole('button', { name: 'Horizontal' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Vertical' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('represents and changes native switch state', () => {
        const onCheckedChange = vi.fn();
        render(
            <AxiomSwitch
                checked
                label="Show owner in canvas"
                onCheckedChange={onCheckedChange}
            />,
        );

        const control = screen.getByRole('switch', { name: 'Show owner in canvas' });
        expect(control).toHaveAttribute('aria-checked', 'true');
        expect(control).toHaveClass('axiom-toggle-active');

        fireEvent.click(control);
        expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('does not change a disabled switch', () => {
        const onCheckedChange = vi.fn();
        render(
            <AxiomSwitch
                checked={false}
                disabled
                label="Flow animation"
                onCheckedChange={onCheckedChange}
            />,
        );

        fireEvent.click(screen.getByRole('switch', { name: 'Flow animation' }));
        expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('exposes selection state for choice and toggle cards', () => {
        render(
            <>
                <AxiomChoiceCard selected>Void</AxiomChoiceCard>
                <AxiomToggleCard active={false}>Journal</AxiomToggleCard>
                <AxiomColorSwatch aria-label="Amber" selected />
                <AxiomIconTile aria-label="Server icon" selected={false} />
            </>,
        );

        expect(screen.getByRole('button', { name: 'Void' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Journal' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Amber' })).toHaveClass('axiom-color-swatch-active');
        expect(screen.getByRole('button', { name: 'Server icon' })).not.toHaveClass('axiom-icon-tile-active');
    });
});
