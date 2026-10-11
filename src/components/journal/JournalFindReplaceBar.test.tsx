import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JournalFindReplaceBar from './JournalFindReplaceBar';

const handlers = {
    onQueryChange: vi.fn(),
    onReplacementChange: vi.fn(),
    onCaseSensitiveChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
};

function renderBar(overrides: Partial<React.ComponentProps<typeof JournalFindReplaceBar>> = {}) {
    return render(
        <JournalFindReplaceBar
            query="issue"
            replacement="incident"
            caseSensitive={false}
            currentMatch={1}
            matchCount={3}
            {...handlers}
            {...overrides}
        />,
    );
}

describe('JournalFindReplaceBar', () => {
    beforeEach(() => {
        Object.values(handlers).forEach(handler => handler.mockClear());
    });

    it('focuses search and reports controlled field changes', () => {
        renderBar();
        const query = screen.getByRole('textbox', { name: 'Find in note' });

        expect(query).toHaveFocus();
        expect(query).toHaveClass('axiom-journal-find-input');
        expect(screen.getByRole('textbox', { name: 'Replace with' })).toHaveClass('axiom-journal-replace-input');
        expect(screen.getByText('2/3')).toBeInTheDocument();
        fireEvent.change(query, { target: { value: 'risk' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), { target: { value: 'control' } });

        expect(handlers.onQueryChange).toHaveBeenCalledWith('risk');
        expect(handlers.onReplacementChange).toHaveBeenCalledWith('control');
    });

    it('supports keyboard navigation and closing', () => {
        renderBar();
        const query = screen.getByRole('textbox', { name: 'Find in note' });

        fireEvent.keyDown(query, { key: 'Enter' });
        fireEvent.keyDown(query, { key: 'Enter', shiftKey: true });
        fireEvent.keyDown(query, { key: 'Escape' });

        expect(handlers.onNext).toHaveBeenCalledOnce();
        expect(handlers.onPrevious).toHaveBeenCalledOnce();
        expect(handlers.onClose).toHaveBeenCalledOnce();
    });

    it('triggers replacement controls and disables them without matches', () => {
        const { rerender } = renderBar();
        fireEvent.click(screen.getByTitle('Match case'));
        expect(screen.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
        fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));

        expect(handlers.onCaseSensitiveChange).toHaveBeenCalledWith(true);
        expect(handlers.onReplace).toHaveBeenCalledOnce();
        expect(handlers.onReplaceAll).toHaveBeenCalledOnce();

        rerender(
            <JournalFindReplaceBar
                query="missing"
                replacement=""
                caseSensitive={false}
                currentMatch={0}
                matchCount={0}
                {...handlers}
            />,
        );
        expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Replace all' })).toBeDisabled();
        expect(screen.getByText('0')).toBeInTheDocument();
    });
});
