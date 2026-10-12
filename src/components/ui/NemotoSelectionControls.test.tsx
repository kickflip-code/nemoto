import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    NemotoChoiceCard,
    NemotoColorSwatch,
    NemotoIconTile,
    NemotoSegmented,
    NemotoSegmentedOption,
    NemotoSwitch,
    NemotoToggleCard,
} from './NemotoSelectionControls';

describe('Nemoto selection controls', () => {
    it('exposes the selected segmented option', () => {
        render(
            <NemotoSegmented aria-label="Orientation">
                <NemotoSegmentedOption active>Horizontal</NemotoSegmentedOption>
                <NemotoSegmentedOption active={false}>Vertical</NemotoSegmentedOption>
            </NemotoSegmented>,
        );

        expect(screen.getByRole('group', { name: 'Orientation' })).toHaveClass('nemoto-segmented');
        expect(screen.getByRole('button', { name: 'Horizontal' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Vertical' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('represents and changes native switch state', () => {
        const onCheckedChange = vi.fn();
        render(
            <NemotoSwitch
                checked
                label="Show owner in canvas"
                onCheckedChange={onCheckedChange}
            />,
        );

        const control = screen.getByRole('switch', { name: 'Show owner in canvas' });
        expect(control).toHaveAttribute('aria-checked', 'true');
        expect(control).toHaveClass('nemoto-toggle-active');

        fireEvent.click(control);
        expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('does not change a disabled switch', () => {
        const onCheckedChange = vi.fn();
        render(
            <NemotoSwitch
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
                <NemotoChoiceCard selected>Void</NemotoChoiceCard>
                <NemotoToggleCard active={false}>Journal</NemotoToggleCard>
                <NemotoColorSwatch aria-label="Amber" selected />
                <NemotoIconTile aria-label="Server icon" selected={false} />
            </>,
        );

        expect(screen.getByRole('button', { name: 'Void' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Journal' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Amber' })).toHaveClass('nemoto-color-swatch-active');
        expect(screen.getByRole('button', { name: 'Server icon' })).not.toHaveClass('nemoto-icon-tile-active');
    });
});
