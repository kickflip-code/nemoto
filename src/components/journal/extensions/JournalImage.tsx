import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import {
    estimateBase64Bytes,
    type JournalImageAlignment,
} from '../../../lib/journalMedia';

function normalizeAlignment(value: unknown): JournalImageAlignment {
    return value === 'left' || value === 'right' ? value : 'center';
}

function imageElement(element: Element): HTMLImageElement | null {
    return element.tagName.toLowerCase() === 'figure'
        ? element.querySelector('img')
        : element as HTMLImageElement;
}

function embeddedDataUrlSize(src: string | null | undefined): number {
    const base64 = src?.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i)?.[1];
    return base64 ? estimateBase64Bytes(base64) : 0;
}

function JournalImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
    const { src, alt, title, caption } = node.attrs;
    const width = node.attrs.width || '100%';
    const alignment = normalizeAlignment(node.attrs.alignment);
    const [isResizing, setIsResizing] = useState(false);
    const cleanupResizeRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => () => {
        mountedRef.current = false;
        cleanupResizeRef.current?.();
    }, []);

    const handleResizeStart = (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const image = event.currentTarget.parentElement?.querySelector('img');
        if (!image) return;

        const startX = event.clientX;
        const currentWidth = image.clientWidth;
        const editorWidth = image.closest('.ProseMirror')?.clientWidth || image.parentElement?.clientWidth || 1;
        setIsResizing(true);

        const cleanup = () => {
            if (mountedRef.current) setIsResizing(false);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', cleanup);
            cleanupResizeRef.current = null;
        };
        const handleMouseMove = (moveEvent: MouseEvent) => {
            const nextWidth = currentWidth + moveEvent.clientX - startX;
            const percentage = Math.max(15, Math.min(100, Math.round((nextWidth / editorWidth) * 100)));
            updateAttributes({ width: `${percentage}%` });
        };

        cleanupResizeRef.current = cleanup;
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', cleanup);
    };

    return (
        <NodeViewWrapper
            as="figure"
            className={`nemoto-journal-image nemoto-journal-image-align-${alignment} relative my-5 max-w-full ${selected ? 'is-selected' : ''}`}
            style={{ width }}
            data-type="journal-image"
            data-align={alignment}
        >
            <div className={`relative group rounded-md border overflow-hidden ${selected ? 'border-accent-primary outline outline-2 outline-accent-primary/40' : 'border-app-border/70 hover:border-app-border'}`}>
                <img
                    src={src}
                    alt={alt || ''}
                    title={title || undefined}
                    draggable={false}
                    className="block w-full h-auto select-none"
                />
                <div
                    contentEditable={false}
                    onMouseDown={handleResizeStart}
                    className="absolute bottom-1.5 right-1.5 w-5 h-5 bg-accent-primary text-app-bg rounded-sm flex items-center justify-center cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
                    title="Drag to resize image"
                >
                    <svg width="9" height="9" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="1" y1="7" x2="7" y2="1" />
                        <line x1="4" y1="7" x2="7" y2="4" />
                    </svg>
                </div>
                {(isResizing || selected) && (
                    <div contentEditable={false} className="absolute top-2 left-2 bg-app-sidebar/95 border border-app-border text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm text-text-main">
                        {width}
                    </div>
                )}
            </div>

            {caption && (
                <figcaption contentEditable={false} className="mt-2 px-2 text-center text-xs text-text-muted italic">
                    {caption}
                </figcaption>
            )}
        </NodeViewWrapper>
    );
}

const JournalImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: '100%',
                parseHTML: element => {
                    const image = imageElement(element);
                    return element.getAttribute('data-width')
                        || image?.getAttribute('data-width')
                        || image?.style.width
                        || image?.getAttribute('width')
                        || '100%';
                },
                renderHTML: attributes => ({
                    'data-width': attributes.width || '100%',
                    style: `width: ${attributes.width || '100%'}; max-width: 100%; height: auto;`,
                }),
            },
            caption: {
                default: '',
                parseHTML: element => element.getAttribute('data-caption')
                    || element.querySelector('figcaption')?.textContent
                    || '',
                renderHTML: attributes => attributes.caption
                    ? { 'data-caption': attributes.caption }
                    : {},
            },
            embeddedSize: {
                default: 0,
                parseHTML: element => Number(element.getAttribute('data-embedded-size') || 0)
                    || embeddedDataUrlSize(imageElement(element)?.getAttribute('src')),
                renderHTML: attributes => attributes.embeddedSize
                    ? { 'data-embedded-size': String(attributes.embeddedSize) }
                    : {},
            },
            alignment: {
                default: 'center',
                parseHTML: element => normalizeAlignment(element.getAttribute('data-align')),
                renderHTML: () => ({}),
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'figure[data-type="journal-image"]',
                getAttrs: element => {
                    const figure = element as HTMLElement;
                    const image = figure.querySelector('img');
                    if (!image) return false;
                    return {
                        src: image.getAttribute('src'),
                        alt: image.getAttribute('alt'),
                        title: image.getAttribute('title'),
                        width: figure.getAttribute('data-width') || image.getAttribute('data-width') || image.style.width || '100%',
                        alignment: normalizeAlignment(figure.getAttribute('data-align')),
                        caption: figure.getAttribute('data-caption') || figure.querySelector('figcaption')?.textContent || '',
                        embeddedSize: Number(figure.getAttribute('data-embedded-size') || 0),
                    };
                },
            },
            {
                tag: this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])',
            },
        ];
    },
    renderHTML({ node, HTMLAttributes }) {
        const caption = node.attrs.caption || '';
        const embeddedSize = Number(node.attrs.embeddedSize || 0);
        const alignment = normalizeAlignment(node.attrs.alignment);
        const imageAttributes = { ...HTMLAttributes };
        delete imageAttributes['data-caption'];
        delete imageAttributes['data-embedded-size'];
        delete imageAttributes['data-align'];
        delete imageAttributes['data-width'];
        imageAttributes.style = 'width: 100%; max-width: 100%; height: auto;';

        const figureAttributes: Record<string, string> = {
            'data-type': 'journal-image',
            'data-width': node.attrs.width || '100%',
            'data-align': alignment,
            class: `journal-image journal-image-align-${alignment}`,
            style: `width: ${node.attrs.width || '100%'}; max-width: 100%;`,
        };
        if (caption) figureAttributes['data-caption'] = caption;
        if (embeddedSize) figureAttributes['data-embedded-size'] = String(embeddedSize);

        const output: any[] = ['figure', figureAttributes, ['img', imageAttributes]];
        if (caption) output.push(['figcaption', {}, caption]);
        return output as any;
    },
    addNodeView() {
        return ReactNodeViewRenderer(JournalImageNodeView);
    },
});

export default JournalImage;
