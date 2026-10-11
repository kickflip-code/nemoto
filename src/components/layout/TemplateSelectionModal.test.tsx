import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TemplateSelectionModal from './TemplateSelectionModal';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/ThemeContext', () => ({
    useTheme: () => ({ theme: 'hard' }),
}));

describe('TemplateSelectionModal accessibility', () => {
    it('creates one canvas using only keys', async () => {
        const user = userEvent.setup();
        const onCreate = vi.fn();
        render(<TemplateSelectionModal isOpen onClose={() => {}} onCreate={onCreate} />);
        await user.keyboard('Keyboard process{Enter}');
        expect(onCreate).toHaveBeenCalledWith('Keyboard process', 'blank');
        expect(screen.queryByText('Swimlane Process')).not.toBeInTheDocument();
    });
    it('labels and focuses the name field and closes with Escape', () => {
        const onClose = vi.fn();
        render(
            <TemplateSelectionModal
                isOpen
                onClose={onClose}
                onCreate={() => undefined}
            />,
        );

        const dialog = screen.getByRole('dialog', { name: 'New Process' });
        const nameInput = screen.getByRole('textbox', { name: 'Process Name' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(nameInput).toHaveFocus();

        fireEvent.keyDown(nameInput, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
