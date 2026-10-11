import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AxiomPopover } from './AxiomPopover';

describe('AxiomPopover', () => {
    it('provides a themed non-modal dialog surface by default', () => {
        render(<AxiomPopover aria-label="Link editor">Content</AxiomPopover>);

        expect(screen.getByRole('dialog', { name: 'Link editor' })).toHaveClass('axiom-popover');
    });

    it('supports listbox semantics for suggestion surfaces', () => {
        render(<AxiomPopover role="listbox" aria-label="Suggestions">Content</AxiomPopover>);

        expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeInTheDocument();
    });
});
