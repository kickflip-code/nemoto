import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NemotoPopover } from './NemotoPopover';

describe('NemotoPopover', () => {
    it('provides a themed non-modal dialog surface by default', () => {
        render(<NemotoPopover aria-label="Link editor">Content</NemotoPopover>);

        expect(screen.getByRole('dialog', { name: 'Link editor' })).toHaveClass('nemoto-popover');
    });

    it('supports listbox semantics for suggestion surfaces', () => {
        render(<NemotoPopover role="listbox" aria-label="Suggestions">Content</NemotoPopover>);

        expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeInTheDocument();
    });
});
