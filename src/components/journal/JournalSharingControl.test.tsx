import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import JournalSharingControl from './JournalSharingControl';

describe('JournalSharingControl', () => {
    it('switches a shareable note to internal', () => {
        const onChange = vi.fn();
        render(<JournalSharingControl internal={false} onChange={onChange} />);

        const button = screen.getByRole('button', { name: 'Sharing: Shareable' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(button);

        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('explains that internal notes remain in full backups', () => {
        render(<JournalSharingControl internal onChange={() => undefined} />);

        const button = screen.getByRole('button', { name: 'Sharing: Internal' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(button).toHaveAttribute('title', expect.stringContaining('Included in full .nemoto backups'));
    });
});
