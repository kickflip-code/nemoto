import type { EditorOptions } from '@tiptap/core';
import { Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Suggestion from '@tiptap/suggestion';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { toast } from 'sonner';
import suggestion from './extensions/suggestion';
import mentionSuggestion from './extensions/mentionSuggestion';
import TypedMention from './extensions/TypedMention';
import JournalImage from './extensions/JournalImage';
import { normalizeJournalPasteHtml } from '../../lib/journalPaste';
import {
    estimateBase64Bytes,
    JOURNAL_MAX_EMBEDDED_IMAGE_BYTES,
} from '../../lib/journalMedia';
import {
    getMentionHtmlAttributes,
    mentionAttributesToReference,
} from '../../lib/journalMentions';
import { resolveEntityReference } from '../../lib/entityResolver';
import { usePortfolioStore } from '../../stores/usePortfolioStore';

export type JournalEditorRange = { from: number; to: number };
export type InsertLocalImageFiles = (
    fileList: File[] | FileList,
    range?: JournalEditorRange,
) => boolean;

const SlashCommands = Extension.create({
    name: 'slash-commands',
    addOptions() {
        return {
            suggestion: {
                char: '/',
                command: ({ editor, range, props }: any) => {
                    props.command({ editor, range });
                },
            },
        };
    },
    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ];
    },
});

export function createJournalEditorExtensions() {
    return [
        StarterKit.configure({
            // @ts-ignore - Link may be included in newer StarterKit versions.
            link: false,
            heading: {
                levels: [1, 2, 3],
            },
        }),
        Placeholder.configure({
            placeholder: 'Start writing...',
        }),
        TaskList,
        TaskItem.configure({
            nested: true,
        }),
        Link.configure({
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
        }),
        JournalImage.configure({
            inline: false,
            allowBase64: true,
        }),
        SlashCommands.configure({
            suggestion,
        }),
        Table.configure({
            resizable: true,
            HTMLAttributes: {
                class: 'w-full border-collapse border border-app-border my-4 rounded-md overflow-hidden',
            },
        }),
        TableRow.configure({
            HTMLAttributes: {
                class: 'border-b border-app-border/50 hover:bg-app-hover/50 transition-colors',
            },
        }),
        TableHeader.configure({
            HTMLAttributes: {
                class: 'border border-app-border bg-app-header px-4 py-2 text-left font-semibold text-text-main',
            },
        }),
        TableCell.configure({
            HTMLAttributes: {
                class: 'border border-app-border px-4 py-2 text-text-muted relative',
            },
        }),
        TypedMention.configure({
            HTMLAttributes: {
                class: 'mention',
            },
            suggestion: mentionSuggestion,
            renderHTML({ options, node }) {
                const portfolio = usePortfolioStore.getState().portfolio;
                const reference = mentionAttributesToReference({
                    id: node.attrs.id,
                    label: node.attrs.label,
                    entityType: node.attrs.entityType,
                    processId: node.attrs.processId,
                    path: node.attrs.path,
                }, portfolio);
                const resolved = reference ? resolveEntityReference(reference, portfolio) : null;
                const label = resolved?.displayName || node.attrs.label || node.attrs.id || 'Missing reference';
                const hint = resolved?.subtitle || (reference
                    ? `Missing ${reference.type}: ${reference.id}`
                    : 'Invalid mention reference');
                const mentionAttributes = reference
                    ? getMentionHtmlAttributes(reference, label)
                    : {};

                return [
                    'span',
                    {
                        ...options.HTMLAttributes,
                        ...mentionAttributes,
                        class: resolved ? 'mention' : 'mention mention-dangling',
                        'data-dangling': resolved ? undefined : 'true',
                        'data-hint': hint,
                    },
                    `@${label}`,
                ];
            },
        }),
    ];
}

export function createJournalEditorProps(
    insertLocalImageFiles: InsertLocalImageFiles,
): NonNullable<EditorOptions['editorProps']> {
    return {
        attributes: {
            role: 'textbox',
            'aria-label': 'Journal note content',
            'aria-multiline': 'true',
            class: 'axiom-journal-prose w-full h-full bg-transparent text-base leading-relaxed text-text-main focus:outline-none prose prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5',
        },
        transformPastedHTML: normalizeJournalPasteHtml,
        handlePaste: (_view, event) => {
            const clipboardHtml = event.clipboardData?.getData('text/html') || '';
            const embeddedImages = Array.from(clipboardHtml.matchAll(/src=["']data:image\/[a-z0-9.+-]+;base64,([^"']+)["']/gi));
            const hasOversizedEmbeddedImage = embeddedImages.some(match =>
                estimateBase64Bytes(match[1]) > JOURNAL_MAX_EMBEDDED_IMAGE_BYTES,
            );
            if (hasOversizedEmbeddedImage) {
                event.preventDefault();
                toast.error('A pasted image is larger than 3 MB. Save it locally, then use Insert local image so Nemoto can optimize it.');
                return true;
            }

            const files = event.clipboardData?.files;
            if (!files?.length) return false;
            const clipboardText = event.clipboardData?.getData('text/plain').trim() || '';
            const htmlContainsReadableText = clipboardHtml
                ? new DOMParser().parseFromString(clipboardHtml, 'text/html').body.textContent?.trim()
                : '';
            // Preserve the normal rich-paste path for mixed text/image selections.
            if (clipboardText && htmlContainsReadableText) return false;
            const handled = insertLocalImageFiles(files);
            if (handled) event.preventDefault();
            return handled;
        },
        handleDrop: (view, event, _slice, moved) => {
            if (moved || !event.dataTransfer?.files.length) return false;
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const handled = insertLocalImageFiles(
                event.dataTransfer.files,
                position ? { from: position.pos, to: position.pos } : undefined,
            );
            if (handled) event.preventDefault();
            return handled;
        },
    };
}
