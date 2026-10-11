import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { JOURNAL_IMAGE_PROMPT_EVENT, JOURNAL_LOCAL_IMAGE_EVENT } from './extensions/suggestion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { toast } from 'sonner';
import JournalFindReplaceBar from './JournalFindReplaceBar';
import JournalEditorToolbar from './JournalEditorToolbar';
import JournalImageMetadataBar from './JournalImageMetadataBar';
import JournalEditorDialogs, {
    type JournalImagePromptState,
    type JournalLinkPopoverState,
    type JournalLinkPromptState,
} from './JournalEditorDialogs';
import type { JournalMentionMenuState } from './JournalMentionContextMenu';
import {
    createJournalEditorExtensions,
    createJournalEditorProps,
} from './journalEditorConfig';
import { normalizeJournalContent } from '../../lib/journalContent';
import { findJournalTextMatches } from '../../lib/journalSearch';
import { normalizeJournalLink } from '../../lib/journalLinks';
import {
    estimateEmbeddedJournalMediaBytes,
    formatJournalMediaBytes,
    isSupportedJournalImage,
    JOURNAL_IMAGE_ACCEPT,
    JOURNAL_MEDIA_PORTFOLIO_WARNING_BYTES,
    prepareJournalImage,
    type JournalImageAttributes,
} from '../../lib/journalMedia';
import {
    mentionAttributesToReference,
    mentionElementToReference,
    referenceToMentionAttributes,
} from '../../lib/journalMentions';
import { resolveEntityReference } from '../../lib/entityResolver';
import './TipTapEditor.css';

interface TipTapEditorProps {
    content: string;
    entryId: string;
    onUpdate: (html: string) => void;
}

export default function TipTapEditor({ content, entryId, onUpdate }: TipTapEditorProps) {
    const normalizedContent = normalizeJournalContent(content);
    const [isHtmlMode, setIsHtmlMode] = useState(false);
    const [htmlContent, setHtmlContent] = useState(normalizedContent);
    const onUpdateRef = useRef(onUpdate);
    const [mentionContextMenu, setMentionContextMenu] = useState<JournalMentionMenuState | null>(null);
    const [promptState, setPromptState] = useState<JournalLinkPromptState>({ isOpen: false, defaultValue: '' });
    const [imagePromptState, setImagePromptState] = useState<JournalImagePromptState>({ isOpen: false, range: null });
    const [linkPopover, setLinkPopover] = useState<JournalLinkPopoverState | null>(null);
    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [replacement, setReplacement] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [currentMatch, setCurrentMatch] = useState(0);
    const [documentRevision, setDocumentRevision] = useState(0);
    const editorRef = useRef<NonNullable<ReturnType<typeof useEditor>> | null>(null);
    const localImageInputRef = useRef<HTMLInputElement>(null);
    const pendingLocalImageRangeRef = useRef<{ from: number; to: number } | null>(null);

    useEffect(() => {
        onUpdateRef.current = onUpdate;
    }, [onUpdate]);

    const persistContent = useCallback((nextContent: string) => {
        onUpdateRef.current(normalizeJournalContent(nextContent));
    }, []);

    const insertLocalImageFiles = useCallback((
        fileList: File[] | FileList,
        range?: { from: number; to: number },
    ): boolean => {
        const candidates = Array.from(fileList).filter(file => file.type.toLowerCase().startsWith('image/'));
        if (candidates.length === 0) return false;

        const files = candidates.filter(isSupportedJournalImage);
        if (files.length !== candidates.length) {
            toast.error('Some images were skipped. Use PNG, JPEG, WebP, or GIF files.');
        }
        if (files.length === 0) return true;

        const targetEditor = editorRef.current;
        if (!targetEditor || targetEditor.isDestroyed) return true;
        const insertionRange = range || {
            from: targetEditor.state.selection.from,
            to: targetEditor.state.selection.to,
        };
        const existingMediaBytes = estimateEmbeddedJournalMediaBytes(
            usePortfolioStore.getState().portfolio.journal?.entries,
        );
        const loadingToast = toast.loading(files.length === 1 ? 'Optimizing image…' : `Optimizing ${files.length} images…`);

        void (async () => {
            const preparedImages: JournalImageAttributes[] = [];
            for (const file of files) {
                try {
                    preparedImages.push(await prepareJournalImage(file));
                } catch (error) {
                    toast.error(`${file.name}: ${error instanceof Error ? error.message : 'Could not process image.'}`);
                }
            }
            toast.dismiss(loadingToast);

            if (preparedImages.length === 0) return;
            if (editorRef.current !== targetEditor || targetEditor.isDestroyed) {
                toast.error('The note changed before the image was ready. Please insert it again.');
                return;
            }

            targetEditor.chain().focus().insertContentAt(
                insertionRange,
                preparedImages.map(attributes => ({ type: 'image', attrs: attributes })),
            ).run();

            const addedBytes = preparedImages.reduce((sum, image) => sum + image.embeddedSize, 0);
            const totalBytes = existingMediaBytes + addedBytes;
            if (totalBytes > JOURNAL_MEDIA_PORTFOLIO_WARNING_BYTES) {
                toast.warning(`Embedded journal images now use about ${formatJournalMediaBytes(totalBytes)}. Large portfolios take longer to save and export.`);
            } else {
                toast.success(`${preparedImages.length === 1 ? 'Image' : `${preparedImages.length} images`} embedded · ${formatJournalMediaBytes(addedBytes)}`);
            }
        })();

        return true;
    }, []);

    const editor = useEditor({
        extensions: createJournalEditorExtensions(),
        content: normalizedContent,
        editorProps: createJournalEditorProps(insertLocalImageFiles),
        onUpdate: ({ editor }) => {
            setDocumentRevision(revision => revision + 1);
            persistContent(editor.getHTML());
        },
    }, []);
    editorRef.current = editor;

    const selectedImage = useEditorState({
        editor,
        selector: ({ editor: currentEditor }) => {
            if (!currentEditor) return null;
            const selection = currentEditor.state.selection;
            const selectedNode = currentEditor.state.doc.nodeAt(selection.from);
            if (
                !selectedNode
                || selectedNode.type.name !== 'image'
                || selection.to !== selection.from + selectedNode.nodeSize
            ) return null;

            return {
                position: selection.from,
                src: String(selectedNode.attrs.src || ''),
                alt: String(selectedNode.attrs.alt || ''),
                caption: String(selectedNode.attrs.caption || ''),
                embeddedSize: Number(selectedNode.attrs.embeddedSize || 0),
            };
        },
    });

    const findMatches = useMemo(
        () => editor
            ? findJournalTextMatches(editor.state.doc, findQuery, caseSensitive)
            : [],
        [editor, findQuery, caseSensitive, documentRevision],
    );

    const selectFindMatch = useCallback((index: number) => {
        if (!editor || findMatches.length === 0) return;
        const normalizedIndex = (index + findMatches.length) % findMatches.length;
        const match = findMatches[normalizedIndex];
        setCurrentMatch(normalizedIndex);
        editor.chain().focus().setTextSelection(match).scrollIntoView().run();
    }, [editor, findMatches]);

    const openFindReplace = useCallback(() => {
        setFindOpen(true);
        window.requestAnimationFrame(() => {
            const input = document.querySelector<HTMLInputElement>('.axiom-journal-findbar input[aria-label="Find in note"]');
            input?.focus();
            input?.select();
        });
    }, []);

    useEffect(() => {
        setCurrentMatch(0);
        if (findOpen && findMatches.length > 0) {
            window.requestAnimationFrame(() => selectFindMatch(0));
        }
    }, [findQuery, caseSensitive, findOpen, entryId]);

    const replaceCurrentMatch = useCallback(() => {
        if (!editor || findMatches.length === 0) return;
        const index = Math.min(currentMatch, findMatches.length - 1);
        editor.chain().focus().insertContentAt(findMatches[index], replacement).run();
        setCurrentMatch(Math.min(index, Math.max(0, findMatches.length - 2)));
    }, [editor, findMatches, currentMatch, replacement]);

    const replaceAllMatches = useCallback(() => {
        if (!editor || findMatches.length === 0) return;

        let transaction = editor.state.tr;
        [...findMatches].reverse().forEach(match => {
            transaction = transaction.insertText(replacement, match.from, match.to);
        });
        editor.view.dispatch(transaction);
        toast.success(`Replaced ${findMatches.length} ${findMatches.length === 1 ? 'match' : 'matches'}`);
        setCurrentMatch(0);
    }, [editor, findMatches, replacement]);

    // Keep labels and typed metadata current after entity renames or legacy
    // portfolio loads. Updates are coalesced to avoid re-entrant editor/store
    // transactions while normal typing is being persisted.
    useEffect(() => {
        if (!editor) return;

        let frameId: number | null = null;
        const refreshMentions = () => {
            frameId = null;
            const portfolio = usePortfolioStore.getState().portfolio;
            let transaction = editor.state.tr;
            let changed = false;

            editor.state.doc.descendants((node, position) => {
                if (node.type.name !== 'mention') return;

                const reference = mentionAttributesToReference({
                    id: node.attrs.id,
                    label: node.attrs.label,
                    entityType: node.attrs.entityType,
                    processId: node.attrs.processId,
                    path: node.attrs.path,
                }, portfolio);
                if (!reference) return;

                const resolved = resolveEntityReference(reference, portfolio);
                const nextAttributes = {
                    ...node.attrs,
                    ...referenceToMentionAttributes(
                        reference,
                        resolved?.displayName || node.attrs.label || reference.id,
                    ),
                };

                if (JSON.stringify(nextAttributes) !== JSON.stringify(node.attrs)) {
                    transaction = transaction.setNodeMarkup(position, undefined, nextAttributes);
                    changed = true;
                }
            });

            if (changed && !editor.isDestroyed) editor.view.dispatch(transaction);
        };

        const scheduleRefresh = () => {
            if (frameId !== null) return;
            frameId = window.requestAnimationFrame(refreshMentions);
        };

        scheduleRefresh();
        const unsubscribe = usePortfolioStore.subscribe((state, previousState) => {
            if (state.portfolio !== previousState.portfolio) scheduleRefresh();
        });

        return () => {
            unsubscribe();
            if (frameId !== null) window.cancelAnimationFrame(frameId);
        };
    }, [editor, entryId]);

    const setLink = useCallback(() => {
        if (!editor) return;
        const previousUrl = editor.getAttributes('link').href;
        setLinkPopover(null);
        setPromptState({ isOpen: true, defaultValue: previousUrl || '' });
    }, [editor]);

    const handlePromptConfirm = (url: string) => {
        if (!editor) return false;

        const normalizedUrl = normalizeJournalLink(url);
        if (normalizedUrl === null) {
            toast.error('Enter a valid HTTP, HTTPS, email, or telephone link.');
            return false;
        }

        // empty
        if (!normalizedUrl) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return true;
        }

        // update
        editor.chain().focus().extendMarkRange('link').setLink({ href: normalizedUrl }).run();
        return true;
    };

    const openJournalLink = useCallback(async (value: string) => {
        const normalizedUrl = normalizeJournalLink(value);
        if (!normalizedUrl) {
            toast.error('This link is not valid.');
            return;
        }

        try {
            await openUrl(normalizedUrl);
        } catch {
            const opened = window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
            if (!opened) toast.error('Could not open the link.');
        }
    }, []);

    const applyPopoverLink = useCallback((value: string) => {
        if (!editor) return;
        const normalizedUrl = normalizeJournalLink(value);
        if (normalizedUrl === null || normalizedUrl === '') {
            toast.error('Enter a valid HTTP, HTTPS, email, or telephone link.');
            return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: normalizedUrl }).run();
        setLinkPopover(null);
    }, [editor]);

    const handleImagePromptConfirm = (url: string) => {
        if (!editor || !imagePromptState.range) return false;
        const normalizedUrl = normalizeJournalLink(url);
        if (!normalizedUrl || !/^https?:/i.test(normalizedUrl)) {
            toast.error('Enter a valid HTTP or HTTPS image URL.');
            return false;
        }

        editor.chain()
            .focus()
            .deleteRange(imagePromptState.range)
            .setImage({ src: normalizedUrl, alt: '' })
            .updateAttributes('image', { caption: '', embeddedSize: 0 })
            .run();
        return true;
    };

    const openLocalImagePicker = useCallback((range: { from: number; to: number } | null = null) => {
        pendingLocalImageRangeRef.current = range;
        if (localImageInputRef.current) {
            localImageInputRef.current.value = '';
            localImageInputRef.current.click();
        }
    }, []);

    const handleLocalImageInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        const range = pendingLocalImageRangeRef.current || undefined;
        pendingLocalImageRangeRef.current = null;
        if (files?.length) insertLocalImageFiles(files, range);
        event.target.value = '';
    };

    // Force focus when entry changes
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;

        const nextContent = normalizeJournalContent(content);
        editor.commands.setContent(nextContent, { emitUpdate: false });
        setHtmlContent(nextContent);
        setLinkPopover(null);
        setCurrentMatch(0);
        pendingLocalImageRangeRef.current = null;
    }, [editor, entryId]);

    useEffect(() => {
        if (!editor) return;

        const handleImagePrompt = (event: Event) => {
            const detail = (event as CustomEvent<{
                editor: typeof editor;
                range: { from: number; to: number };
            }>).detail;

            if (!detail || detail.editor !== editor) return;
            setImagePromptState({ isOpen: true, range: detail.range });
        };

        const handleLocalImagePrompt = (event: Event) => {
            const detail = (event as CustomEvent<{
                editor: typeof editor;
                range: { from: number; to: number };
            }>).detail;

            if (!detail || detail.editor !== editor) return;
            openLocalImagePicker(detail.range);
        };

        window.addEventListener(JOURNAL_IMAGE_PROMPT_EVENT, handleImagePrompt);
        window.addEventListener(JOURNAL_LOCAL_IMAGE_EVENT, handleLocalImagePrompt);
        return () => {
            window.removeEventListener(JOURNAL_IMAGE_PROMPT_EVENT, handleImagePrompt);
            window.removeEventListener(JOURNAL_LOCAL_IMAGE_EVENT, handleLocalImagePrompt);
        };
    }, [editor, openLocalImagePicker]);

    const toggleHtmlMode = useCallback(() => {
        if (!editor) return;

        if (isHtmlMode) {
            // Switching back to Visual Mode
            const nextContent = normalizeJournalContent(htmlContent);
            editor.commands.setContent(nextContent, { emitUpdate: false });
            setHtmlContent(nextContent);
            persistContent(nextContent);
        } else {
            // Switching to HTML Mode
            setHtmlContent(editor.getHTML());
            setFindOpen(false);
            setLinkPopover(null);
        }
        setIsHtmlMode(!isHtmlMode);
    }, [editor, isHtmlMode, htmlContent, persistContent]);

    // Handle typed mentions and regular links from the editor surface.
    const handleEditorClick = useCallback((e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.axiom-journal-tiptap .ProseMirror')) return;

        const mention = target.closest('.mention') as HTMLElement;

        if (mention && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();

            const portfolio = usePortfolioStore.getState().portfolio;
            const reference = mentionElementToReference(mention, portfolio);
            const mentionLabel = mention.textContent?.replace('@', '') || 'Entity';
            if (!reference) return;

            setMentionContextMenu({
                x: e.clientX,
                y: e.clientY,
                reference,
                label: mentionLabel,
                dangling: !resolveEntityReference(reference, portfolio),
            });
            setLinkPopover(null);
            return;
        }

        const anchor = target.closest<HTMLAnchorElement>('a[href]');
        if (anchor) {
            e.preventDefault();
            e.stopPropagation();
            const href = anchor.getAttribute('href') || '';

            if (e.ctrlKey || e.metaKey) {
                void openJournalLink(href);
                setLinkPopover(null);
                return;
            }

            const position = editor?.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
            if (editor && position !== undefined) editor.commands.setTextSelection(position);
            setLinkPopover({ x: e.clientX, y: e.clientY, href });
            setMentionContextMenu(null);
            return;
        }

        setLinkPopover(null);
    }, [editor, openJournalLink]);

    useEffect(() => {
        document.addEventListener('click', handleEditorClick);
        return () => document.removeEventListener('click', handleEditorClick);
    }, [handleEditorClick]);

    useEffect(() => {
        if (!editor) return;

        const handleEditorShortcut = (event: KeyboardEvent) => {
            const modifier = event.ctrlKey || event.metaKey;
            if (!modifier) return;

            const inEditor = editor.isFocused
                || !!(event.target as HTMLElement | null)?.closest?.('.axiom-journal-findbar');
            if (!inEditor) return;

            if (event.key.toLowerCase() === 'f') {
                event.preventDefault();
                openFindReplace();
            } else if (event.key.toLowerCase() === 'h') {
                event.preventDefault();
                openFindReplace();
            } else if (event.key.toLowerCase() === 'k' && editor.isFocused) {
                event.preventDefault();
                setLink();
            }
        };

        window.addEventListener('keydown', handleEditorShortcut);
        return () => window.removeEventListener('keydown', handleEditorShortcut);
    }, [editor, openFindReplace, setLink]);

    if (!editor) {
        return null;
    }

    return (
        <div className="axiom-journal-tiptap flex-1 flex flex-col overflow-hidden">
            <input
                ref={localImageInputRef}
                type="file"
                accept={JOURNAL_IMAGE_ACCEPT}
                multiple
                className="hidden"
                onChange={handleLocalImageInput}
                aria-hidden="true"
                tabIndex={-1}
            />
            <JournalEditorToolbar
                editor={editor}
                isHtmlMode={isHtmlMode}
                findOpen={findOpen}
                onSetLink={setLink}
                onOpenLocalImagePicker={() => openLocalImagePicker(null)}
                onOpenFindReplace={openFindReplace}
                onToggleHtmlMode={toggleHtmlMode}
            />

            {!isHtmlMode && selectedImage && (
                <JournalImageMetadataBar editor={editor} image={selectedImage} />
            )}

            {findOpen && !isHtmlMode && (
                <JournalFindReplaceBar
                    query={findQuery}
                    replacement={replacement}
                    caseSensitive={caseSensitive}
                    currentMatch={Math.min(currentMatch, Math.max(0, findMatches.length - 1))}
                    matchCount={findMatches.length}
                    onQueryChange={setFindQuery}
                    onReplacementChange={setReplacement}
                    onCaseSensitiveChange={setCaseSensitive}
                    onPrevious={() => selectFindMatch(currentMatch - 1)}
                    onNext={() => selectFindMatch(currentMatch + 1)}
                    onReplace={replaceCurrentMatch}
                    onReplaceAll={replaceAllMatches}
                    onClose={() => {
                        setFindOpen(false);
                        editor.commands.focus();
                    }}
                />
            )}

            {/* Editor Area */}
            <div className="flex-1 overflow-hidden relative" onClick={() => !isHtmlMode && editor.commands.focus()}>
                {isHtmlMode ? (
                    <textarea
                        value={htmlContent}
                        onChange={(e) => {
                            setHtmlContent(e.target.value);
                            persistContent(e.target.value);
                        }}
                        placeholder="Write raw HTML here..."
                        aria-label="Journal note HTML source"
                        className="w-full h-full p-8 bg-app-bg text-sm font-mono leading-relaxed text-accent-primary focus:outline-none resize-none custom-scrollbar"
                    />
                ) : (
                    <EditorContent editor={editor} className="w-full h-full overflow-y-auto custom-scrollbar" />
                )}
            </div>

            <JournalEditorDialogs
                editor={editor}
                mentionMenu={mentionContextMenu}
                linkPopover={linkPopover}
                linkPrompt={promptState}
                imagePrompt={imagePromptState}
                onMentionMenuClose={() => setMentionContextMenu(null)}
                onLinkApply={applyPopoverLink}
                onLinkOpen={value => void openJournalLink(value)}
                onLinkPopoverClose={() => setLinkPopover(null)}
                onLinkPromptClose={() => setPromptState(current => ({ ...current, isOpen: false }))}
                onLinkPromptConfirm={handlePromptConfirm}
                onImagePromptClose={() => setImagePromptState({ isOpen: false, range: null })}
                onImagePromptConfirm={handleImagePromptConfirm}
            />
        </div>
    );
}
