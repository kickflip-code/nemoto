import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { emptyPortfolio } from '../../stores/slices/coreSlice';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import EntityPickerModal from './EntityPickerModal';

describe('EntityPickerModal', () => {
    afterEach(() => {
        usePortfolioStore.setState({ portfolio: structuredClone(emptyPortfolio) });
    });

    it('reserves space for its search icon', () => {
        render(<EntityPickerModal onClose={vi.fn()} onSelect={vi.fn()} />);

        const search = screen.getByRole('searchbox', { name: 'Search entities' });
        expect(search).toHaveClass('nemoto-field-leading-icon');
        expect(search).toHaveAttribute('placeholder', 'Search entities...');
    });

    it('portals the modal above canvas-local stacking contexts', () => {
        const { container } = render(<EntityPickerModal onClose={vi.fn()} onSelect={vi.fn()} />);

        const dialog = screen.getByRole('dialog', { name: 'Add Linked Context' });
        const overlay = dialog.parentElement;
        expect(container).not.toContainElement(dialog);
        expect(overlay).toHaveClass('z-[10120]');
        expect(overlay?.parentElement).toBe(document.body);
    });
});
