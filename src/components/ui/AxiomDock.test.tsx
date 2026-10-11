import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AxiomDock, AxiomDockButton, AxiomDockDivider } from './AxiomDock';

describe('AxiomDock', () => {
    it('provides a toolbar contract for canvas creation tools', () => {
        render(
            <AxiomDock aria-label="Canvas tools">
                <AxiomDockButton active label="Select">S</AxiomDockButton>
                <AxiomDockDivider />
                <AxiomDockButton label="Add action">A</AxiomDockButton>
            </AxiomDock>,
        );

        expect(screen.getByRole('toolbar', { name: 'Canvas tools' })).toHaveClass('floating-dock-shell');
        expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Add action' })).not.toHaveAttribute('aria-pressed');
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
    });
});
