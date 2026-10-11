import type { Editor } from '@tiptap/core';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Bold,
    CheckSquare,
    Code,
    FileCode,
    ImagePlus,
    Italic,
    Link as LinkIcon,
    List,
    ListOrdered,
    Minus,
    Quote,
    Redo2,
    RemoveFormatting,
    Search,
    Strikethrough,
    Table as TableIcon,
    TableProperties,
    Undo2,
    Unlink,
} from 'lucide-react';
import { JournalToolbarButton as ToolbarButton } from './JournalToolbarButton';
import { AxiomSelect, AxiomToolbar, AxiomToolbarGroup } from '../ui';

interface JournalEditorToolbarProps {
    editor: Editor;
    isHtmlMode: boolean;
    findOpen: boolean;
    onSetLink: () => void;
    onOpenLocalImagePicker: () => void;
    onOpenFindReplace: () => void;
    onToggleHtmlMode: () => void;
}

function getActiveBlockType(editor: Editor) {
    if (editor.isActive('codeBlock')) return 'codeBlock';
    if (editor.isActive('heading', { level: 1 })) return 'heading1';
    if (editor.isActive('heading', { level: 2 })) return 'heading2';
    if (editor.isActive('heading', { level: 3 })) return 'heading3';
    return 'paragraph';
}

function setBlockType(editor: Editor, value: string) {
    const chain = editor.chain().focus();
    if (value === 'heading1') chain.setHeading({ level: 1 }).run();
    else if (value === 'heading2') chain.setHeading({ level: 2 }).run();
    else if (value === 'heading3') chain.setHeading({ level: 3 }).run();
    else if (value === 'codeBlock') chain.setCodeBlock().run();
    else chain.setParagraph().run();
}

function runTableAction(editor: Editor, action: string) {
    if (!action) return;
    const chain = editor.chain().focus();
    if (action === 'row-before') chain.addRowBefore().run();
    else if (action === 'row-after') chain.addRowAfter().run();
    else if (action === 'delete-row') chain.deleteRow().run();
    else if (action === 'column-before') chain.addColumnBefore().run();
    else if (action === 'column-after') chain.addColumnAfter().run();
    else if (action === 'delete-column') chain.deleteColumn().run();
    else if (action === 'toggle-header') chain.toggleHeaderRow().run();
    else if (action === 'delete-table') chain.deleteTable().run();
}

export default function JournalEditorToolbar({
    editor,
    isHtmlMode,
    findOpen,
    onSetLink,
    onOpenLocalImagePicker,
    onOpenFindReplace,
    onToggleHtmlMode,
}: JournalEditorToolbarProps) {
    const activeBlockType = getActiveBlockType(editor);
    const imageAlignment = !isHtmlMode && editor.isActive('image')
        ? editor.getAttributes('image').alignment || 'center'
        : null;

    return (
        <AxiomToolbar
            aria-label="Journal editor formatting"
            surface="journal"
            className="border-b border-app-border/30 bg-app-surface shadow-sm overflow-x-auto custom-scrollbar"
        >
            <div className="axiom-journal-toolbar-inner flex items-center gap-2 px-6 py-1.5">
                <AxiomToolbarGroup aria-label="History and formatting reset" surface="journal">
                    <ToolbarButton
                        onClick={() => editor.chain().focus().undo().run()}
                        disabled={isHtmlMode || !editor.can().chain().focus().undo().run()}
                        title="Undo (Ctrl+Z)"
                    >
                        <Undo2 size={14} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().redo().run()}
                        disabled={isHtmlMode || !editor.can().chain().focus().redo().run()}
                        title="Redo (Ctrl+Shift+Z)"
                    >
                        <Redo2 size={14} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
                        disabled={isHtmlMode}
                        title="Clear formatting"
                    >
                        <RemoveFormatting size={14} />
                    </ToolbarButton>
                </AxiomToolbarGroup>

                <AxiomToolbarGroup aria-label="Text block type" surface="journal">
                    <AxiomSelect
                        value={activeBlockType}
                        onChange={event => setBlockType(editor, event.target.value)}
                        disabled={isHtmlMode}
                        aria-label="Text block type"
                        title="Text block type"
                        className="axiom-field h-7 min-w-[108px] px-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40"
                    >
                        <option value="paragraph">Paragraph</option>
                        <option value="heading1">Heading 1</option>
                        <option value="heading2">Heading 2</option>
                        <option value="heading3">Heading 3</option>
                        <option value="codeBlock">Code block</option>
                    </AxiomSelect>
                </AxiomToolbarGroup>

                <AxiomToolbarGroup aria-label="Text emphasis" surface="journal">
                    <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
                        <Bold size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
                        <Italic size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
                        <Strikethrough size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline Code">
                        <Code size={14} />
                    </ToolbarButton>
                </AxiomToolbarGroup>

                <AxiomToolbarGroup aria-label="Lists" surface="journal">
                    <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
                        <List size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
                        <ListOrdered size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist">
                        <CheckSquare size={14} />
                    </ToolbarButton>
                </AxiomToolbarGroup>

                <AxiomToolbarGroup aria-label="Insert and block formatting" surface="journal">
                    <ToolbarButton onClick={onSetLink} active={editor.isActive('link')} title="Link (Ctrl+K)">
                        <LinkIcon size={14} />
                    </ToolbarButton>
                    {editor.isActive('link') && (
                        <ToolbarButton onClick={() => editor.chain().focus().unsetLink().run()} title="Unlink">
                            <Unlink size={14} />
                        </ToolbarButton>
                    )}
                    <ToolbarButton onClick={onOpenLocalImagePicker} disabled={isHtmlMode} title="Insert local image">
                        <ImagePlus size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
                        <Quote size={14} />
                    </ToolbarButton>
                    <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Rule">
                        <Minus size={14} />
                    </ToolbarButton>
                </AxiomToolbarGroup>

                {imageAlignment && (
                    <AxiomToolbarGroup aria-label="Image alignment" surface="journal">
                        <ToolbarButton
                            onClick={() => editor.chain().focus().updateAttributes('image', { alignment: 'left' }).run()}
                            active={imageAlignment === 'left'}
                            title="Align image left"
                        >
                            <AlignLeft size={14} />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().updateAttributes('image', { alignment: 'center' }).run()}
                            active={imageAlignment === 'center'}
                            title="Align image center"
                        >
                            <AlignCenter size={14} />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().updateAttributes('image', { alignment: 'right' }).run()}
                            active={imageAlignment === 'right'}
                            title="Align image right"
                        >
                            <AlignRight size={14} />
                        </ToolbarButton>
                    </AxiomToolbarGroup>
                )}

                <AxiomToolbarGroup aria-label="Tables" surface="journal">
                    <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert Table">
                        <TableIcon size={14} />
                    </ToolbarButton>
                    {editor.isActive('table') && (
                        <div className="flex items-center gap-1">
                            <TableProperties size={13} className="text-text-faint ml-1" />
                            <AxiomSelect
                                value=""
                                onChange={event => runTableAction(editor, event.target.value)}
                                aria-label="Table actions"
                                title="Table actions"
                                className="axiom-field h-7 min-w-[126px] px-2 text-[10px]"
                            >
                                <option value="" disabled>Table actions…</option>
                                <option value="row-before">Add row above</option>
                                <option value="row-after">Add row below</option>
                                <option value="delete-row">Delete row</option>
                                <option value="column-before">Add column left</option>
                                <option value="column-after">Add column right</option>
                                <option value="delete-column">Delete column</option>
                                <option value="toggle-header">Toggle header row</option>
                                <option value="delete-table">Delete table</option>
                            </AxiomSelect>
                        </div>
                    )}
                </AxiomToolbarGroup>

                <div className="ml-auto flex items-center gap-2">
                    <ToolbarButton onClick={onOpenFindReplace} active={findOpen} disabled={isHtmlMode} title="Find and replace (Ctrl+F)">
                        <Search size={14} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={onToggleHtmlMode}
                        active={isHtmlMode}
                        title={isHtmlMode ? 'Switch to Visual Editor' : 'Switch to HTML Source'}
                    >
                        <div className="flex items-center gap-1.5 px-1">
                            <FileCode size={14} className={isHtmlMode ? 'text-accent-primary' : ''} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">{isHtmlMode ? 'Source' : 'HTML'}</span>
                        </div>
                    </ToolbarButton>
                </div>
            </div>
        </AxiomToolbar>
    );
}
