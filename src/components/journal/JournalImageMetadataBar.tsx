import type { Editor } from '@tiptap/core';
import { Image as ImageIcon, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatJournalMediaBytes } from '../../lib/journalMedia';
import { NemotoButton, NemotoInput } from '../ui';

export interface SelectedJournalImage {
    position: number;
    src: string;
    alt: string;
    caption: string;
    embeddedSize: number;
}

interface JournalImageMetadataBarProps {
    editor: Editor;
    image: SelectedJournalImage;
}

function updateImageAtPosition(
    editor: Editor,
    position: number,
    attributes: Record<string, string>,
): boolean {
    return editor.commands.command(({ state, tr }) => {
        const node = state.doc.nodeAt(position);
        if (!node || node.type.name !== 'image') return false;

        tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            ...attributes,
        });
        return true;
    });
}

export default function JournalImageMetadataBar({ editor, image }: JournalImageMetadataBarProps) {
    const [altDraft, setAltDraft] = useState(image.alt);
    const [captionDraft, setCaptionDraft] = useState(image.caption);

    useEffect(() => {
        setAltDraft(image.alt);
        setCaptionDraft(image.caption);
    }, [image.position, image.alt, image.caption]);

    const deleteImage = () => {
        editor.commands.command(({ state, tr }) => {
            const node = state.doc.nodeAt(image.position);
            if (!node || node.type.name !== 'image') return false;

            tr.delete(image.position, image.position + node.nodeSize);
            return true;
        });
        editor.commands.focus();
    };

    const handleInputKeyDown = (
        event: React.KeyboardEvent<HTMLInputElement>,
        originalValue: string,
        resetDraft: (value: string) => void,
    ) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            resetDraft(originalValue);
            const input = event.currentTarget;
            window.requestAnimationFrame(() => input.blur());
        }
    };

    return (
        <div className="nemoto-journal-image-metadata-bar shrink-0 border-b border-app-border/40 bg-app-header">
            <div className="nemoto-journal-toolbar-inner flex items-end gap-3 px-6 py-2">
                <div className="flex min-w-24 items-center gap-2 self-center text-[10px] font-bold uppercase tracking-wider text-text-faint">
                    <ImageIcon size={13} />
                    <span>Image details</span>
                </div>

                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-text-faint">
                    Alt text
                    <NemotoInput
                        value={altDraft}
                        onChange={event => setAltDraft(event.target.value)}
                        onBlur={event => updateImageAtPosition(editor, image.position, { alt: event.currentTarget.value })}
                        onKeyDown={event => handleInputKeyDown(event, image.alt, setAltDraft)}
                        placeholder="Describe the image"
                        controlSize="sm"
                        className="h-8 px-2.5 text-xs normal-case font-normal tracking-normal"
                    />
                </label>

                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[9px] font-bold uppercase tracking-wider text-text-faint">
                    Caption
                    <NemotoInput
                        value={captionDraft}
                        onChange={event => setCaptionDraft(event.target.value)}
                        onBlur={event => updateImageAtPosition(editor, image.position, { caption: event.currentTarget.value })}
                        onKeyDown={event => handleInputKeyDown(event, image.caption, setCaptionDraft)}
                        placeholder="Optional caption"
                        controlSize="sm"
                        className="h-8 px-2.5 text-xs normal-case font-normal tracking-normal"
                    />
                </label>

                <div className="flex min-w-fit items-center gap-3 self-end pb-0.5 text-[9px] text-text-faint">
                    <span>
                        {image.src.startsWith('data:image/')
                            ? `Embedded${image.embeddedSize ? ` · ${formatJournalMediaBytes(image.embeddedSize)}` : ''}`
                            : 'External image'}
                    </span>
                    <NemotoButton
                        size="sm"
                        variant="ghost"
                        onClick={deleteImage}
                        className="flex items-center gap-1 text-text-faint hover:text-accent-danger"
                        title="Delete image"
                    >
                        <Trash2 size={11} /> Delete
                    </NemotoButton>
                </div>
            </div>
        </div>
    );
}
