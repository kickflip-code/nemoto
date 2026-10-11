import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TipTapEditor from './TipTapEditor';

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn(),
}));

describe('TipTapEditor renderer smoke test', () => {
    it('round-trips a note through visual and HTML source modes', async () => {
        const onUpdate = vi.fn();
        const { container } = render(
            <TipTapEditor
                entryId="entry-test"
                content="<p>Hello journal</p>"
                onUpdate={onUpdate}
            />,
        );

        await waitFor(() => {
            expect(container.querySelector('.ProseMirror')).toHaveTextContent('Hello journal');
        });
        expect(screen.getByRole('textbox', { name: 'Journal note content' })).toHaveAttribute('aria-multiline', 'true');

        fireEvent.click(screen.getByTitle('Switch to HTML Source'));
        const source = screen.getByPlaceholderText('Write raw HTML here...');
        expect(screen.getByRole('textbox', { name: 'Journal note HTML source' })).toBe(source);
        expect(source).toHaveValue('<p>Hello journal</p>');

        fireEvent.change(source, { target: { value: '<p>Updated journal</p>' } });
        expect(onUpdate).toHaveBeenLastCalledWith('<p>Updated journal</p>');

        fireEvent.click(screen.getByTitle('Switch to Visual Editor'));
        await waitFor(() => {
            expect(container.querySelector('.ProseMirror')).toHaveTextContent('Updated journal');
        });
    });

    it('switches between notes without calling commands on a destroyed editor', async () => {
        const onUpdate = vi.fn();
        const { container, rerender } = render(
            <TipTapEditor
                entryId="entry-one"
                content="<p>First note</p>"
                onUpdate={onUpdate}
            />,
        );

        await waitFor(() => {
            expect(container.querySelector('.ProseMirror')).toHaveTextContent('First note');
        });

        rerender(
            <TipTapEditor
                entryId="entry-two"
                content="<p>Second note</p>"
                onUpdate={onUpdate}
            />,
        );

        await waitFor(() => {
            expect(container.querySelector('.ProseMirror')).toHaveTextContent('Second note');
        });
    });
});
