import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JournalLinkPopover from './JournalLinkPopover';

const handlers = {
    onApply: vi.fn(),
    onOpen: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
};

function renderPopover(href = 'https://example.com') {
    return render(
        <JournalLinkPopover
            x={100}
            y={100}
            href={href}
            {...handlers}
        />,
    );
}

describe('JournalLinkPopover', () => {
    beforeEach(() => {
        Object.values(handlers).forEach(handler => handler.mockClear());
    });

    it('edits and applies a link with Enter', () => {
        renderPopover();
        expect(screen.getByRole('dialog', { name: 'Edit link' })).toHaveClass('axiom-popover');
        const input = screen.getByRole('textbox', { name: 'Link URL' });

        expect(input).toHaveValue('https://example.com');
        fireEvent.change(input, { target: { value: 'https://axiom.local/docs' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(handlers.onApply).toHaveBeenCalledWith('https://axiom.local/docs');
    });

    it('exposes open, remove and close actions', () => {
        renderPopover('mailto:hello@example.com');

        fireEvent.click(screen.getByTitle('Open link'));
        fireEvent.click(screen.getByTitle('Remove link'));
        fireEvent.click(screen.getByTitle('Close'));

        expect(handlers.onOpen).toHaveBeenCalledWith('mailto:hello@example.com');
        expect(handlers.onRemove).toHaveBeenCalledOnce();
        expect(handlers.onClose).toHaveBeenCalledOnce();
    });

    it('closes when Escape is pressed anywhere in the window', () => {
        renderPopover();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(handlers.onClose).toHaveBeenCalledOnce();
    });
});
