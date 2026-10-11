import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JournalToolbarButton } from './JournalToolbarButton';

describe('JournalToolbarButton', () => {
    it('exposes its title and invokes its action', () => {
        const onClick = vi.fn();
        render(
            <JournalToolbarButton title="Bold" onClick={onClick}>
                <span>Bold icon</span>
            </JournalToolbarButton>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
        expect(screen.getByTitle('Bold')).toBeInTheDocument();
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('represents disabled and active states', () => {
        const { rerender } = render(
            <JournalToolbarButton title="Action" disabled>Action</JournalToolbarButton>,
        );
        expect(screen.getByRole('button', { name: 'Action' })).toBeDisabled();

        rerender(<JournalToolbarButton title="Action" active>Action</JournalToolbarButton>);
        expect(screen.getByRole('button', { name: 'Action' })).toHaveClass('text-accent-primary');
    });
});
