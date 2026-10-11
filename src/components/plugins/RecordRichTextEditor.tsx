import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useRef } from 'react';
import type { RecordRichText } from '../../plugins/contextualRecords';
import { AxiomToolbarButton } from '../ui';
import { Bold, Italic, Strikethrough, List } from 'lucide-react';

/** The host renders a bounded TipTap subset; plugins cannot inject extensions. */
export default function RecordRichTextEditor({ value, onChange, editable = true, ariaLabel = 'Description' }: { value: RecordRichText; onChange: (value: RecordRichText) => void; editable?: boolean; ariaLabel?: string }) {
    const onChangeRef = useRef(onChange);
    const applyingExternalValue = useRef(false);
    const initialized = useRef(false);
    const lastValueJson = useRef(JSON.stringify(value));
    const extensions = useMemo(() => [StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, link: false, underline: false, trailingNode: false, orderedList: false })], []);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    const editor = useEditor({
        extensions,
        content: value,
        editable,
        editorProps: { attributes: { role: 'textbox', 'aria-label': ariaLabel, 'aria-multiline': 'true', class: 'p-3 outline-none text-sm' } },
        onUpdate: ({ editor: current }) => {
            const next = current.getJSON() as RecordRichText;
            const serialized = JSON.stringify(next);
            if (!initialized.current || applyingExternalValue.current || serialized === lastValueJson.current) return;
            lastValueJson.current = serialized;
            onChangeRef.current(next);
        },
    }, []);
    useEffect(() => {
        if (editor) initialized.current = true;
        return () => { initialized.current = false; };
    }, [editor]);
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        editor.setEditable(editable);
        editor.setOptions({
            editorProps: {
                ...editor.options.editorProps,
                attributes: {
                    ...editor.options.editorProps.attributes,
                    role: 'textbox',
                    'aria-label': ariaLabel,
                    'aria-multiline': 'true',
                    class: 'p-3 outline-none text-sm',
                },
            },
        });
    }, [ariaLabel, editable, editor]);
    useEffect(() => {
        if (!editor || editor.isDestroyed || JSON.stringify(editor.getJSON()) === JSON.stringify(value)) return;
        applyingExternalValue.current = true;
        try {
            lastValueJson.current = JSON.stringify(value);
            editor.commands.setContent(value, { emitUpdate: false });
        } finally {
            applyingExternalValue.current = false;
        }
    }, [editor, value]);
    const active = useEditorState({ editor, selector: ({ editor: current }) => ({
        bold: current?.isActive('bold') ?? false,
        italic: current?.isActive('italic') ?? false,
        strike: current?.isActive('strike') ?? false,
        bulletList: current?.isActive('bulletList') ?? false,
    }) });
    return <div className="axiom-record-editor rounded bg-app-bg">
        {editable && <div className="axiom-record-toolbar" role="toolbar" aria-label="Text formatting">
            <AxiomToolbarButton surface="journal" label="Bold (Ctrl+B)" active={active?.bold} disabled={!editor} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={15} /></AxiomToolbarButton>
            <AxiomToolbarButton surface="journal" label="Italic (Ctrl+I)" active={active?.italic} disabled={!editor} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={15} /></AxiomToolbarButton>
            <AxiomToolbarButton surface="journal" label="Strikethrough" active={active?.strike} disabled={!editor} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough size={15} /></AxiomToolbarButton>
            <span className="axiom-record-toolbar-divider" aria-hidden="true" />
            <AxiomToolbarButton surface="journal" label="Bullet List" active={active?.bulletList} disabled={!editor} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={15} /></AxiomToolbarButton>
        </div>}
        <EditorContent editor={editor} />
    </div>;
}
