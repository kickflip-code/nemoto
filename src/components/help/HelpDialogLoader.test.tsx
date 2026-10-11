import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HelpDialogLoader from './HelpDialogLoader';

describe('HelpDialogLoader', () => {
    it('fails safely when the Help chunk cannot be loaded', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onClose = vi.fn();
        const loadDialog = vi.fn().mockRejectedValue(new Error('missing local chunk'));
        render(<HelpDialogLoader loadDialog={loadDialog} onClose={onClose} />);

        expect(await screen.findByRole('heading', { name: 'Help could not be loaded' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('The rest of Nemoto is unaffected');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Close Help' })).toHaveFocus());

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
