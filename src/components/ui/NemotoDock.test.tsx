import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NemotoDock, NemotoDockButton, NemotoDockDivider } from './NemotoDock';

describe('NemotoDock', () => {
    it('provides a toolbar contract for canvas creation tools', () => {
        render(
            <NemotoDock aria-label="Canvas tools">
                <NemotoDockButton active label="Select">S</NemotoDockButton>
                <NemotoDockDivider />
                <NemotoDockButton label="Add action">A</NemotoDockButton>
            </NemotoDock>,
        );

        expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toHaveClass('floating-dock-shell');
        expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Add action' })).not.toHaveAttribute('aria-pressed');
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
    });
});
