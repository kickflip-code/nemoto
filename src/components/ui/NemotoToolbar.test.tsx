import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NemotoToolbar, NemotoToolbarButton, NemotoToolbarGroup } from './NemotoToolbar';

describe('NemotoToolbar', () => {
    it('provides toolbar and grouped-control semantics', () => {
        render(
            <NemotoToolbar aria-label="Canvas controls">
                <NemotoToolbarGroup aria-label="Zoom">
                    <NemotoToolbarButton label="Zoom out">−</NemotoToolbarButton>
                </NemotoToolbarGroup>
            </NemotoToolbar>,
        );

        expect(screen.getByRole('toolbar', { name: 'Canvas controls' })).toHaveClass('nemoto-canvas-toolbar');
        expect(screen.getByRole('group', { name: 'Zoom' })).toHaveClass('nemoto-canvas-toolbar-group');
        expect(screen.getByRole('button', { name: 'Zoom out' })).not.toHaveAttribute('aria-pressed');
    });

    it('exposes toggle state only for stateful toolbar actions', () => {
        render(<NemotoToolbarButton active={false} label="Bold" surface="journal">B</NemotoToolbarButton>);

        const button = screen.getByRole('button', { name: 'Bold' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        expect(button).toHaveAttribute('data-state', 'off');
        expect(button).toHaveClass('nemoto-journal-toolbar-button');
    });

    it('supports destructive toolbar actions', () => {
        render(<NemotoToolbarButton danger label="Delete">D</NemotoToolbarButton>);

        expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('nemoto-toolbar-button-danger');
    });
});
