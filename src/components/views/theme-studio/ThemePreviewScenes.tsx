import type { MouseEvent, ReactNode } from 'react';
import {
    Bold,
    Book,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    FileText,
    Folder,
    FolderInput,
    Grid2X2,
    Heading1,
    Italic,
    Link as LinkIcon,
    List,
    Maximize,
    Minus,
    Plus,
    Quote,
} from 'lucide-react';
import type { BuiltInThemeId } from '../../../theme/themeContract';
import type { ThemeBrandPresentation } from '../../../theme/themePresentation';
import { CanvasThemePreview } from '../../canvas/CanvasThemePreview';
import AppRail from '../../layout/AppRail';
import FloatingDock from '../../layout/FloatingDock';
import Header from '../../layout/Header';
import { JournalToolbarButton } from '../../journal/JournalToolbarButton';
import { ConfirmationDialogSurface } from '../../shared/ConfirmationModal';

interface ThemePreviewSceneProps {
    onSelectElement: (elementId: string) => void;
    selectedElementId: string;
}

interface ApplicationThemePreviewProps extends ThemePreviewSceneProps {
    themeId: BuiltInThemeId;
    brandPresentation?: ThemeBrandPresentation;
}

interface PreviewTargetProps extends ThemePreviewSceneProps {
    children: ReactNode;
    className?: string;
    elementId: string;
    label: string;
}

function PreviewTarget({ children, className = '', elementId, label, onSelectElement, selectedElementId }: PreviewTargetProps) {
    const handleClick = (event: MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        onSelectElement(elementId);
    };

    return (
        <div
            className={`theme-studio-preview-target ${selectedElementId === elementId ? 'is-selected' : ''} ${className}`.trim()}
            onClick={handleClick}
            aria-label={`Theme preview: ${label}`}
        >
            {children}
        </div>
    );
}

export function ApplicationThemePreview({ onSelectElement, selectedElementId, themeId, brandPresentation }: ApplicationThemePreviewProps) {
    const selectionProps = { onSelectElement, selectedElementId };

    return (
        <PreviewTarget
            {...selectionProps}
            elementId="foundations"
            label="Color & Shape"
            className="theme-studio-app-scene h-full flex flex-col bg-app-bg text-text-main"
        >
            <PreviewTarget {...selectionProps} elementId="app-shell" label="Frame" className="shrink-0">
                <Header preview brandPresentation={brandPresentation} />
                <PreviewTarget
                    {...selectionProps}
                    elementId="controls"
                    label="Controls"
                    className="absolute left-1/2 top-2 h-8 w-[38%] min-w-48 -translate-x-1/2"
                >
                    <span />
                </PreviewTarget>
            </PreviewTarget>

            <div className="flex-1 flex min-h-0">
                <PreviewTarget {...selectionProps} elementId="app-shell" label="Navigation" className="shrink-0">
                    <div className="pointer-events-none h-full">
                        <AppRail preview />
                    </div>
                </PreviewTarget>

                <PreviewTarget
                    {...selectionProps}
                    elementId="panels"
                    label="Side Panels"
                    className="axiom-panel axiom-side-panel w-[22%] min-w-[140px] max-w-60 bg-app-sidebar border-r border-app-border flex flex-col min-h-0"
                >
                    <div className="axiom-panel-header h-9 border-b px-3 flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Process Portfolio</span>
                        <Plus size={11} className="text-text-faint" />
                    </div>
                    <div className="axiom-panel-body p-2 space-y-1">
                        {['Operations', 'Incident Management', 'Knowledge Mapping'].map((item, index) => (
                            <div key={item} className={`axiom-panel-row px-2 py-1.5 text-[10px] flex items-center gap-2 ${index === 1 ? 'axiom-panel-row-selected' : ''}`}>
                                {index === 0 ? <ChevronRight size={10} /> : <Folder size={11} className="text-accent-primary" />}
                                <span className="truncate">{item}</span>
                            </div>
                        ))}
                    </div>
                    <div className="axiom-panel-section mt-auto border-t border-app-border">
                        <div className="axiom-panel-header h-8 border-b px-3 flex items-center justify-between">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Resources</span>
                            <span className="text-[8px] text-text-faint">12</span>
                        </div>
                        <div className="p-2 space-y-1">
                            {['Service Desk', 'CRM System', 'Escalation Matrix'].map(item => (
                                <div key={item} className="px-2 py-1 text-[9px] text-text-muted truncate">{item}</div>
                            ))}
                        </div>
                    </div>
                </PreviewTarget>

                <div className="flex-1 min-w-0 flex flex-col bg-app-bg overflow-hidden">
                    <div className="axiom-canvas-toolbar h-10 border-b flex items-center justify-between px-4 shrink-0 backdrop-blur-sm">
                        <span className="text-[10px] text-text-faint">Incident Management</span>
                        <div className="flex items-center gap-2 text-text-faint">
                            <button className="axiom-toolbar-button"><Minus size={12} /></button>
                            <button className="axiom-toolbar-button"><Plus size={12} /></button>
                            <button className="axiom-toolbar-button"><Maximize size={12} /></button>
                            <button className="axiom-toolbar-button"><Grid2X2 size={12} /></button>
                        </div>
                    </div>
                    <div className="flex-shrink-0 bg-app-surface/40 border-b border-app-border px-5 py-3 flex flex-col gap-1.5 select-none">
                        <h2 className="text-base font-bold font-display text-text-main tracking-tight leading-tight">Incident Handling — Service Operations</h2>
                        <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 rounded bg-app-surface shadow-sm border border-app-border text-[8px] font-bold uppercase tracking-wider text-text-muted">Process owner</span>
                            <span className="text-[9px] font-medium text-text-muted/65 italic border-l border-accent-primary/20 pl-2.5">Operational workflow</span>
                        </div>
                    </div>
                    <div className="relative flex-1 min-h-0 overflow-hidden">
                        <CanvasThemePreview themeId={themeId} variant="compact" />
                        <div className="pointer-events-none">
                            <FloatingDock preview />
                        </div>
                    </div>
                    <div className="axiom-journal-topbar h-10 shrink-0 flex items-center gap-2 px-4 border-t border-app-border bg-app-surface">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-text-main">Journal</span>
                        <ChevronDown size={12} className="text-text-faint" />
                    </div>
                </div>

                <PreviewTarget
                    {...selectionProps}
                    elementId="panels"
                    label="Inspector"
                    className="axiom-panel axiom-inspector-panel w-[18%] min-w-[115px] max-w-52 bg-app-sidebar border-l border-app-border flex flex-col"
                >
                    <div className="axiom-panel-header h-9 border-b px-3 flex items-center text-[9px] font-bold uppercase tracking-wider text-text-faint">Inspector</div>
                    <div className="axiom-panel-body p-3 space-y-3">
                        <div>
                            <div className="text-[9px] font-bold text-text-main">Validate Request</div>
                            <div className="mt-1 text-[8px] leading-relaxed text-text-faint">Action node · Service Desk</div>
                        </div>
                        <div className="axiom-panel-card p-2.5">
                            <div className="text-[8px] font-bold uppercase tracking-wider text-text-faint">Owner</div>
                            <div className="mt-2 axiom-field h-6 px-2 flex items-center text-[9px] text-text-muted">Operations</div>
                        </div>
                        <div className="axiom-panel-card p-2.5">
                            <div className="text-[8px] font-bold uppercase tracking-wider text-text-faint">Status</div>
                            <div className="mt-2 flex items-center gap-1.5 text-[9px] text-text-muted">
                                <span className="h-2 w-2 rounded-full bg-accent-success" /> Ready
                            </div>
                        </div>
                    </div>
                </PreviewTarget>
            </div>
        </PreviewTarget>
    );
}

export function JournalThemePreview({ onSelectElement, selectedElementId }: ThemePreviewSceneProps) {
    const selectionProps = { onSelectElement, selectedElementId };

    return (
        <PreviewTarget
            {...selectionProps}
            elementId="journal"
            label="Journal"
            className="journal-panel-wrapper h-full flex flex-col border-t border-app-border bg-app-surface text-text-main"
        >
            <div className="axiom-journal-topbar h-12 shrink-0 flex items-center justify-between px-5 border-b border-app-border bg-app-surface">
                <div className="flex items-center gap-4">
                    <div className="axiom-journal-title-button flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-text-main">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                        Journal
                        <ChevronDown size={14} className="text-text-faint ml-1" />
                    </div>
                    <span className="axiom-journal-location text-[11px] text-text-faint">Incident Management / Escalation Notes</span>
                </div>
                <button className="axiom-journal-primary-action px-3 py-1.5 rounded-sm bg-accent-primary/10 text-accent-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 border border-accent-primary/20">
                    <Plus size={14} /> New Note
                </button>
            </div>

            <div className="flex-1 flex min-h-0 overflow-hidden">
                <div className="axiom-journal-sidebar w-[24%] min-w-[150px] max-w-72 shrink-0 border-r border-app-border bg-app-bg/30 overflow-hidden">
                    <div className="axiom-journal-sidebar-actions flex items-center justify-between gap-2 px-2 py-2 border-b border-app-border/40">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Library</span>
                        <div className="flex items-center gap-1 text-text-faint">
                            <FolderInput size={12} />
                            <Book size={11} />
                        </div>
                    </div>
                    <div className="p-1 space-y-[1px]">
                        <div className="axiom-journal-tree-row axiom-journal-tree-row-notebook flex items-center gap-2 px-2 py-1.5 rounded-sm text-[11px] text-text-muted border border-transparent">
                            <ChevronRight size={10} className="rotate-90 text-text-faint" />
                            <Book size={12} className="axiom-journal-tree-icon text-text-faint" />
                            <span className="axiom-journal-tree-label flex-1 truncate font-medium tracking-tight">Quick Notes</span>
                            <span className="axiom-journal-count text-[9px] text-text-faint font-mono bg-app-active/50 px-1 rounded-sm">4</span>
                        </div>
                        <div className="axiom-journal-tree-row axiom-journal-tree-row-folder flex items-center gap-2 px-2 py-1.5 rounded-sm text-[11px] text-text-muted border border-transparent">
                            <ChevronRight size={10} className="rotate-90 text-text-faint" />
                            <FolderInput size={12} className="axiom-journal-tree-icon text-accent-warning" />
                            <span className="axiom-journal-tree-label flex-1 truncate font-medium tracking-tight">Operations</span>
                        </div>
                        <div className="axiom-journal-tree-row axiom-journal-tree-row-notebook is-selected flex items-center gap-2 px-2 py-1.5 rounded-sm text-[11px] bg-accent-primary/20 text-accent-primary border border-accent-primary/20" style={{ paddingLeft: 20 }}>
                            <ChevronRight size={10} className="rotate-90 text-text-faint" />
                            <Book size={12} className="axiom-journal-tree-icon text-accent-primary" />
                            <span className="axiom-journal-tree-label flex-1 truncate font-medium tracking-tight">Incident Management</span>
                            <span className="axiom-journal-count text-[9px] text-text-faint font-mono bg-app-active/50 px-1 rounded-sm">3</span>
                        </div>
                        {['Welcome', 'Escalation Notes', 'Post-Incident Review'].map((entry, index) => (
                            <div
                                key={entry}
                                className={`axiom-journal-entry-row flex items-center gap-2 px-2 py-1 rounded-sm text-xs ${index === 1 ? 'is-selected bg-accent-primary text-white font-medium' : 'text-text-muted'}`}
                                style={{ paddingLeft: 50 }}
                            >
                                <FileText size={11} className="axiom-journal-entry-icon opacity-70 shrink-0" />
                                <span className="truncate">{entry}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="axiom-journal-editor-shell flex-1 min-w-0 flex flex-col bg-app-surface overflow-hidden">
                    <div className="axiom-journal-document-meta px-6 py-5 border-b border-app-border/30 shrink-0 bg-app-bg/10">
                        <div className="axiom-journal-document-meta-inner space-y-3">
                            <input readOnly value="Incident Escalation Notes" className="axiom-journal-entry-title w-full text-2xl font-bold tracking-tight bg-transparent border-none outline-none text-text-main" />
                            <div className="axiom-journal-meta-row flex items-center gap-3">
                                <div className="axiom-journal-tags flex flex-wrap gap-1.5 items-center">
                                    <span className="axiom-journal-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Incident</span>
                                    <button className="axiom-journal-add-tag flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-text-muted border border-dashed border-app-border">
                                        <Plus size={10} /> Tag
                                    </button>
                                </div>
                                <span className="h-4 w-px bg-app-border/70" />
                                <button className="axiom-journal-meta-action flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-text-faint">
                                    <FolderInput size={12} /> Move
                                </button>
                                <span className="h-4 w-px bg-app-border/70" />
                                <span className="axiom-journal-save-state text-[10px] text-text-faint font-mono uppercase tracking-widest">Saved 10:18</span>
                            </div>
                        </div>
                    </div>

                    <div className="axiom-journal-tiptap flex-1 flex flex-col overflow-hidden">
                        <div className="axiom-journal-toolbar border-b border-app-border/30 bg-app-surface shadow-sm overflow-hidden">
                            <div className="axiom-journal-toolbar-inner flex items-center gap-2 px-6 py-1.5">
                                <div className="axiom-journal-toolbar-group">
                                    <JournalToolbarButton title="Bold"><Bold size={14} /></JournalToolbarButton>
                                    <JournalToolbarButton title="Italic"><Italic size={14} /></JournalToolbarButton>
                                </div>
                                <div className="axiom-journal-toolbar-group">
                                    <JournalToolbarButton active title="Heading 1"><Heading1 size={14} /></JournalToolbarButton>
                                </div>
                                <div className="axiom-journal-toolbar-group">
                                    <JournalToolbarButton title="Bullet List"><List size={14} /></JournalToolbarButton>
                                    <JournalToolbarButton title="Checklist"><CheckSquare size={14} /></JournalToolbarButton>
                                </div>
                                <div className="axiom-journal-toolbar-group">
                                    <JournalToolbarButton title="Link"><LinkIcon size={14} /></JournalToolbarButton>
                                    <JournalToolbarButton title="Blockquote"><Quote size={14} /></JournalToolbarButton>
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <div className="axiom-journal-prose ProseMirror mx-auto max-w-3xl px-8 py-7 text-text-main">
                                <h2 className="text-2xl font-bold text-accent-primary">3.0 — Prioritization</h2>
                                <p className="mt-3 text-sm leading-relaxed text-text-muted">Priority is based on impact and urgency. Capture decisions close to the process and preserve the operational context.</p>
                                <p className="mt-4 text-sm leading-relaxed text-text-muted">Assign <span className="mention">@Tier 2 Analyst</span> when additional diagnosis is required.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="axiom-journal-context-panel w-[20%] min-w-[130px] max-w-60 shrink-0 border-l border-app-border bg-app-bg/30 overflow-hidden">
                    <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase text-text-faint tracking-wider">Linked Context</span>
                                <span className="text-[10px] text-text-faint">(1)</span>
                            </div>
                            <button className="px-2 py-1 rounded bg-accent-primary/20 text-accent-primary text-[10px] flex items-center gap-1"><Plus size={10} /> Add</button>
                        </div>
                        <div className="axiom-linked-entity-card bg-app-bg border border-app-border rounded p-2 flex items-start gap-2.5">
                            <div className="axiom-linked-entity-icon mt-0.5 w-6 h-6 rounded flex items-center justify-center border border-accent-primary/30 bg-accent-primary/10">
                                <FileText size={13} className="text-accent-primary" />
                            </div>
                            <div className="min-w-0">
                                <div className="axiom-linked-entity-title text-xs font-medium text-text-main">Incident Process</div>
                                <div className="text-[10px] text-text-muted mt-0.5">Service Operations</div>
                                <div className="text-[9px] text-text-faint mt-0.5">process</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </PreviewTarget>
    );
}

export function DialogThemePreview({ onSelectElement, selectedElementId }: ThemePreviewSceneProps) {
    return (
        <PreviewTarget
            onSelectElement={onSelectElement}
            selectedElementId={selectedElementId}
            elementId="dialogs"
            label="Dialogs"
            className="h-full flex items-center justify-center bg-app-bg p-8 text-text-main overflow-hidden"
        >
            <div className="axiom-dialog-backdrop absolute inset-0" />
            <div className="relative z-10 w-full max-w-md pointer-events-none">
                <ConfirmationDialogSurface
                    title="Delete Resource?"
                    message="This resource will be removed from the portfolio. Linked references will remain visible in the journal."
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                    variant="danger"
                    onClose={() => undefined}
                    onConfirm={() => undefined}
                />
            </div>
        </PreviewTarget>
    );
}
