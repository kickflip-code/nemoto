import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import JournalImageMetadataBar, { type SelectedJournalImage } from './JournalImageMetadataBar';
import JournalImage from './extensions/JournalImage';

const editors: Editor[] = [];

function createEditor(): Editor {
    const editor = new Editor({
        extensions: [
            StarterKit,
            JournalImage.configure({ allowBase64: true }),
        ],
        content: '<figure data-type="journal-image" data-width="55%" data-align="center" data-embedded-size="4"><img src="data:image/png;base64,AA==" alt=""></figure><p>After image</p>',
    });
    editors.push(editor);
    return editor;
}

function selectedImage(editor: Editor): SelectedJournalImage {
    const node = editor.state.doc.nodeAt(0);
    if (!node) throw new Error('Expected an image at the start of the document.');

    return {
        position: 0,
        src: String(node.attrs.src || ''),
        alt: String(node.attrs.alt || ''),
        caption: String(node.attrs.caption || ''),
        embeddedSize: Number(node.attrs.embeddedSize || 0),
    };
}

afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
});

describe('JournalImageMetadataBar', () => {
    it('updates alt text and caption without replacing the image node', async () => {
        const user = userEvent.setup();
        const editor = createEditor();
        render(<JournalImageMetadataBar editor={editor} image={selectedImage(editor)} />);

        const altInput = screen.getByPlaceholderText('Describe the image');
        await user.type(altInput, 'Process toolbar');
        fireEvent.blur(altInput);

        const captionInput = screen.getByPlaceholderText('Optional caption');
        await user.type(captionInput, 'Toolbar options');
        fireEvent.blur(captionInput);

        const imageNode = editor.state.doc.nodeAt(0);
        expect(imageNode?.type.name).toBe('image');
        expect(imageNode?.attrs.alt).toBe('Process toolbar');
        expect(imageNode?.attrs.caption).toBe('Toolbar options');
        expect(editor.getHTML()).toContain('alt="Process toolbar"');
        expect(editor.getHTML()).toContain('data-caption="Toolbar options"');
        expect(editor.getText()).toContain('After image');
    });

    it('deletes only the selected image', async () => {
        const user = userEvent.setup();
        const editor = createEditor();
        render(<JournalImageMetadataBar editor={editor} image={selectedImage(editor)} />);

        await user.click(screen.getByRole('button', { name: 'Delete' }));

        expect(editor.getHTML()).not.toContain('data-type="journal-image"');
        expect(editor.getText()).toContain('After image');
    });
});
