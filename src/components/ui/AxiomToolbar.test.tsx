import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AxiomToolbar, AxiomToolbarButton, AxiomToolbarGroup } from './AxiomToolbar';

describe('AxiomToolbar', () => {
    it('provides toolbar and grouped-control semantics', () => {
        render(
            <AxiomToolbar aria-label="Canvas controls">
                <AxiomToolbarGroup aria-label="Zoom">
                    <AxiomToolbarButton label="Zoom out">−</AxiomToolbarButton>
                </AxiomToolbarGroup>
            </AxiomToolbar>,
        );

        expect(screen.getByRole('toolbar', { name: 'Canvas controls' })).toHaveClass('axiom-canvas-toolbar');
        expect(screen.getByRole('group', { name: 'Zoom' })).toHaveClass('axiom-canvas-toolbar-group');
        expect(screen.getByRole('button', { name: 'Zoom out' })).not.toHaveAttribute('aria-pressed');
    });

    it('exposes toggle state only for stateful toolbar actions', () => {
        render(<AxiomToolbarButton active={false} label="Bold" surface="journal">B</AxiomToolbarButton>);

        const button = screen.getByRole('button', { name: 'Bold' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(button).toHaveAttribute('data-state', 'off');
        expect(button).toHaveClass('axiom-journal-toolbar-button');
    });

    it('supports destructive toolbar actions', () => {
        render(<AxiomToolbarButton danger label="Delete">D</AxiomToolbarButton>);

        expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('axiom-toolbar-button-danger');
    });
});
