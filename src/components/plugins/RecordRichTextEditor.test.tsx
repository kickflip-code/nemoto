import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RecordRichText } from '../../plugins/contextualRecords';
import RecordRichTextEditor from './RecordRichTextEditor';

const note = (text: string): RecordRichText => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }],
});

describe('controlled record rich-text editor', () => {
    it('renders an existing bounded note without normalizing or emitting it', async () => {
        const onChange = vi.fn();
        render(<RecordRichTextEditor ariaLabel="Notes" value={note('Existing')} onChange={onChange} />);
        const editor = await screen.findByRole('textbox', { name: 'Notes' });

        expect(editor).toHaveTextContent('Existing');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('applies an acknowledged external value without remounting, losing focus or emitting a loop', async () => {
        const onChange = vi.fn();
        const { rerender } = render(
            <RecordRichTextEditor ariaLabel="Notes" value={note('First')} onChange={onChange} />,
        );
        const editor = await screen.findByRole('textbox', { name: 'Notes' });
        editor.focus();

        rerender(<RecordRichTextEditor ariaLabel="Notes" value={note('Second')} onChange={onChange} />);

        await waitFor(() => expect(editor).toHaveTextContent('Second'));
        expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(editor);
        expect(editor).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
    });
});
