import type { Editor } from '@tiptap/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import JournalEditorToolbar from './JournalEditorToolbar';

const commandNames = [
    'focus', 'undo', 'redo', 'unsetAllMarks', 'clearNodes',
    'setHeading', 'setCodeBlock', 'setParagraph',
    'toggleBold', 'toggleItalic', 'toggleStrike', 'toggleCode',
    'toggleBulletList', 'toggleOrderedList', 'toggleTaskList',
    'unsetLink', 'toggleBlockquote', 'setHorizontalRule', 'insertTable',
    'addRowBefore', 'addRowAfter', 'deleteRow', 'addColumnBefore',
    'addColumnAfter', 'deleteColumn', 'toggleHeaderRow', 'deleteTable',
    'updateAttributes',
] as const;

function createChain() {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    commandNames.forEach(name => {
        chain[name] = vi.fn(() => chain);
    });
    chain.run = vi.fn(() => true);
    return chain;
}

function createEditor(active: string[] = [], attributes: Record<string, unknown> = {}) {
    const chain = createChain();
    const canChain = createChain();
    const editor = {
        chain: vi.fn(() => chain),
        can: vi.fn(() => ({ chain: () => canChain })),
        isActive: vi.fn((name: string) => active.includes(name)),
        getAttributes: vi.fn(() => attributes),
    } as unknown as Editor;

    return { editor, chain };
}

const callbacks = {
    onSetLink: vi.fn(),
    onOpenLocalImagePicker: vi.fn(),
    onOpenFindReplace: vi.fn(),
    onToggleHtmlMode: vi.fn(),
};

function renderToolbar(editor: Editor, overrides: Partial<React.ComponentProps<typeof JournalEditorToolbar>> = {}) {
    return render(
        <JournalEditorToolbar
            editor={editor}
            isHtmlMode={false}
            findOpen={false}
            {...callbacks}
            {...overrides}
        />,
    );
}

describe('JournalEditorToolbar', () => {
    it('runs common formatting commands', () => {
        const { editor, chain } = createEditor(['bold']);
        renderToolbar(editor);

        fireEvent.click(screen.getByTitle('Bold (Ctrl+B)'));
        fireEvent.click(screen.getByTitle('Checklist'));

        expect(chain.toggleBold).toHaveBeenCalledOnce();
        expect(chain.toggleTaskList).toHaveBeenCalledOnce();
        expect(screen.getByTitle('Bold (Ctrl+B)')).toHaveClass('text-accent-primary');
    });

    it('changes block type and runs contextual table actions', () => {
        const { editor, chain } = createEditor(['table']);
        renderToolbar(editor);

        fireEvent.change(screen.getByRole('combobox', { name: 'Text block type' }), { target: { value: 'heading2' } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Table actions' }), { target: { value: 'row-after' } });

        expect(chain.setHeading).toHaveBeenCalledWith({ level: 2 });
        expect(chain.addRowAfter).toHaveBeenCalledOnce();
    });

    it('shows contextual image alignment controls and updates the image', () => {
        const { editor, chain } = createEditor(['image'], { alignment: 'right' });
        renderToolbar(editor);

        expect(screen.getByTitle('Align image right')).toHaveClass('text-accent-primary');
        fireEvent.click(screen.getByTitle('Align image left'));

        expect(chain.updateAttributes).toHaveBeenCalledWith('image', { alignment: 'left' });
    });

    it('disables visual-only actions in HTML mode', () => {
        const { editor } = createEditor(['image']);
        renderToolbar(editor, { isHtmlMode: true });

        expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeDisabled();
        expect(screen.getByTitle('Clear formatting')).toBeDisabled();
        expect(screen.getByTitle('Insert local image')).toBeDisabled();
        expect(screen.getByTitle('Find and replace (Ctrl+F)')).toBeDisabled();
        expect(screen.getByTitle('Switch to Visual Editor')).toBeInTheDocument();
        expect(screen.queryByTitle('Align image center')).not.toBeInTheDocument();
    });
});
