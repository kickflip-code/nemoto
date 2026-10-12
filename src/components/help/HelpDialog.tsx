import { useMemo, useRef, type ReactNode } from 'react';
import { CircleHelp, X } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import helpSource from '../../../_docs/help/in-app-help.md?raw';
import { APP_VERSION } from '../../lib/appVersion';
import {
    NemotoButton,
    NemotoDialog,
    NemotoDialogBody,
    NemotoDialogFooter,
    NemotoDialogHeader,
} from '../ui';

interface HelpDialogProps {
    onClose: () => void;
}

const textFromChildren = (children: ReactNode): string => {
    if (typeof children === 'string' || typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(textFromChildren).join('');
    if (children && typeof children === 'object' && 'props' in children) {
        return textFromChildren((children as { props?: { children?: ReactNode } }).props?.children);
    }
    return '';
};

const sectionId = (label: string): string => `help-${label
    .toLocaleLowerCase('en')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;

export const HELP_SECTIONS = Array.from(helpSource.matchAll(/^##\s+(.+)$/gm), match => ({
    id: sectionId(match[1].trim()),
    label: match[1].trim(),
}));

const markdownComponents: Components = {
    h1: () => null,
    h2: ({ children }) => {
        const label = textFromChildren(children);
        return (
            <h2
                id={sectionId(label)}
                tabIndex={-1}
                className="scroll-mt-5 border-b border-app-border pb-2 pt-2 text-lg font-bold text-text-main outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            >
                {children}
            </h2>
        );
    },
    h3: ({ children }) => <h3 className="pt-1 text-sm font-bold text-text-main">{children}</h3>,
    p: ({ children }) => <p className="text-sm leading-6 text-text-muted">{children}</p>,
    ul: ({ children }) => <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-text-muted">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-text-muted">{children}</ol>,
    li: ({ children }) => <li className="pl-1">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-text-main">{children}</strong>,
    code: ({ children }) => (
        <code className="rounded border border-app-border bg-app-bg px-1 py-0.5 font-mono text-[0.85em] text-accent-primary">
            {children}
        </code>
    ),
    table: ({ children }) => (
        <div className="overflow-x-auto rounded border border-app-border">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs">{children}</table>
        </div>
    ),
    thead: ({ children }) => <thead className="bg-app-header text-text-main">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-app-border">{children}</tbody>,
    tr: ({ children }) => <tr className="align-top">{children}</tr>,
    th: ({ children }) => <th className="border-r border-app-border px-3 py-2 font-semibold last:border-r-0">{children}</th>,
    td: ({ children }) => <td className="border-r border-app-border px-3 py-2 leading-5 text-text-muted last:border-r-0">{children}</td>,
};

export default function HelpDialog({ onClose }: HelpDialogProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const renderedHelp = useMemo(
        () => helpSource.split('{{APP_VERSION}}').join(APP_VERSION),
        [],
    );

    const openSection = (id: string) => {
        const heading = contentRef.current?.querySelector<HTMLElement>(`#${id}`);
        if (!heading) return;
        heading.scrollIntoView?.({ block: 'start' });
        heading.focus({ preventScroll: true });
    };

    return (
        <NemotoDialog
            aria-describedby="help-dialog-description"
            aria-labelledby="help-dialog-title"
            initialFocusRef={closeButtonRef}
            onClose={onClose}
            panelClassName="flex h-[min(780px,calc(100vh-2rem))] w-full max-w-[1040px] flex-col overflow-hidden"
            rootClassName="z-[10150]"
        >
            <NemotoDialogHeader className="flex items-center justify-between gap-4 border-b px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
                        <CircleHelp aria-hidden="true" size={19} />
                    </span>
                    <div className="min-w-0">
                        <h2 id="help-dialog-title" className="text-base font-bold text-text-main">Help</h2>
                        <p id="help-dialog-description" className="mt-0.5 text-xs text-text-muted">
                            Guidance for Nemoto {APP_VERSION}
                        </p>
                    </div>
                </div>
                <NemotoButton
                    ref={closeButtonRef}
                    aria-label="Close Help"
                    icon
                    onClick={onClose}
                    size="sm"
                    title="Close Help"
                    variant="ghost"
                >
                    <X size={16} />
                </NemotoButton>
            </NemotoDialogHeader>

            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
                <nav aria-label="Help topics" className="min-h-0 overflow-y-auto border-r border-app-border bg-app-sidebar p-3">
                    <p className="px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-text-faint">Topics</p>
                    <div className="space-y-0.5">
                        {HELP_SECTIONS.map(section => (
                            <button
                                key={section.id}
                                type="button"
                                className="w-full rounded px-2.5 py-2 text-left text-xs leading-4 text-text-muted transition-colors hover:bg-app-hover hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                                onClick={() => openSection(section.id)}
                            >
                                {section.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <NemotoDialogBody ref={contentRef} className="min-h-0 overflow-y-auto px-7 py-6">
                    <article className="mx-auto max-w-3xl space-y-4 pb-10">
                        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                            {renderedHelp}
                        </ReactMarkdown>
                    </article>
                </NemotoDialogBody>
            </div>

            <NemotoDialogFooter className="flex items-center justify-between border-t px-5 py-3 text-[10px] text-text-faint">
                <span>Included with Nemoto</span>
                <span>F1 opens or closes Help</span>
            </NemotoDialogFooter>
        </NemotoDialog>
    );
}
