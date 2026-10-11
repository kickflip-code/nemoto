import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginComposedView from './PluginComposedView';

vi.mock('./RecordRichTextEditor', () => ({
    default: ({ ariaLabel, editable, onChange, value }: {
        ariaLabel: string;
        editable: boolean;
        onChange: (value: unknown) => void;
        value: unknown;
    }) => (
        <textarea
            aria-label={ariaLabel}
            disabled={!editable}
            value={JSON.stringify(value)}
            onChange={event => onChange(JSON.parse(event.currentTarget.value))}
        />
    ),
}));

const note = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }],
});

const view = (value = note('Original'), draftRevision = 0) => ({
    key: 'root', type: 'stack', direction: 'vertical', gap: 'small', wrap: false,
    children: [
        { key: 'notes', type: 'rich-text', label: 'Notes', actionId: 'notes.change', value, editable: true, draftRevision },
        { key: 'save', type: 'button', label: 'Save', actionId: 'record.save', disabled: false, variant: 'primary' },
    ],
});

afterEach(() => vi.useRealTimers());

describe('generic plugin rich-text adapter', () => {
    it('stages composition locally and flushes its latest revision immediately before Save', () => {
        vi.useFakeTimers();
        const onAction = vi.fn((_action: unknown) => true);
        const onDraftChange = vi.fn();
        render(<PluginComposedView tree={view()} onAction={onAction} onDraftChange={onDraftChange} />);
        const editor = screen.getByRole('textbox', { name: 'Notes' });

        fireEvent.compositionStart(editor);
        fireEvent.change(editor, { target: { value: JSON.stringify(note('日本')) } });
        fireEvent.change(editor, { target: { value: JSON.stringify(note('日本語')) } });
        vi.advanceTimersByTime(1_000);
        expect(onAction).not.toHaveBeenCalled();
        expect(onDraftChange).toHaveBeenLastCalledWith({
            controlKey: 'notes', actionId: 'notes.change', value: note('日本語'), draftRevision: 2,
        });

        fireEvent.compositionEnd(editor);
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onAction.mock.calls.map(call => call[0])).toEqual([
            { controlKey: 'notes', actionId: 'notes.change', value: note('日本語'), draftRevision: 2 },
            { controlKey: 'save', actionId: 'record.save', value: null, draftRevision: null, userGesture: true },
        ]);
    });

    it('keeps the focused editor mounted when the guest acknowledges the draft revision', () => {
        const { rerender } = render(<PluginComposedView tree={view()} />);
        const editor = screen.getByRole('textbox', { name: 'Notes' });
        editor.focus();
        fireEvent.change(editor, { target: { value: JSON.stringify(note('Changed')) } });

        rerender(<PluginComposedView tree={view(note('Changed'), 1)} />);

        expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(editor);
        expect(editor).toHaveFocus();
        expect(editor).toHaveValue(JSON.stringify(note('Changed')));
    });

    it('rejects invalid rich text before staging or dispatching it', () => {
        vi.useFakeTimers();
        const onAction = vi.fn();
        const onDraftChange = vi.fn();
        render(<PluginComposedView tree={view()} onAction={onAction} onDraftChange={onDraftChange} />);

        fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
            target: { value: JSON.stringify({ type: 'doc', content: [] }) },
        });
        vi.advanceTimersByTime(1_000);

        expect(onDraftChange).not.toHaveBeenCalled();
        expect(onAction).not.toHaveBeenCalled();
    });
});
