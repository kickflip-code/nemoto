import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TagSelector from './TagSelector';

const journalActions = {
    createTag: vi.fn(),
    deleteTag: vi.fn(),
    purgeTag: vi.fn(),
};

vi.mock('../../stores/usePortfolioStore', () => ({
    usePortfolioStore: () => ({
        portfolio: {
            journal: {
                tags: [{ id: 'tag-1', label: 'Risk', color: 'red', archived: false }],
            },
        },
    }),
}));

vi.mock('../../stores/useJournalStore', () => ({
    useJournalStore: () => journalActions,
}));

describe('TagSelector', () => {
    beforeEach(() => {
        Object.values(journalActions).forEach(action => action.mockClear());
    });

    it('opens an accessible picker and toggles an existing tag', () => {
        const onChange = vi.fn();
        render(<TagSelector selectedTagIds={[]} onChange={onChange} />);

        const trigger = screen.getByRole('button', { name: 'Tag' });
        fireEvent.click(trigger);

        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const picker = screen.getByRole('dialog', { name: 'Choose journal tags' });
        expect(picker).toBeInTheDocument();
        expect(picker).toHaveClass('fixed');
        expect(picker.parentElement).toBe(document.body);
        expect(screen.getByRole('textbox', { name: 'Search or create tag' }))
            .toHaveClass('nemoto-field-leading-icon');
        fireEvent.click(screen.getByRole('checkbox', { name: 'Risk' }));
        expect(onChange).toHaveBeenCalledWith(['tag-1']);
    });

    it('closes with Escape and restores focus to the trigger', () => {
        render(<TagSelector selectedTagIds={[]} onChange={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Tag' });

        fireEvent.click(trigger);
        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: 'Choose journal tags' })).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });
});
