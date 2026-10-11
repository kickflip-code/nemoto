import { Search, Download, Upload, Save, Loader2, FileText, ChevronDown, ShieldCheck, MessagesSquare, FilePlus2, FolderPlus } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useState } from 'react';
import { ThemeBrandMark } from '../shared/ThemeBrandMark';
import type { ThemeBrandPresentation } from '../../theme/themePresentation';
import { AxiomButton, AxiomMenu, AxiomMenuDivider, AxiomMenuItem } from '../ui';
import { useProposalReviewStore } from '../../stores/useProposalReviewStore';

interface HeaderProps {
    preview?: boolean;
    brandPresentation?: ThemeBrandPresentation;
}

export default function Header({ preview = false, brandPresentation }: HeaderProps) {
    const {
        openOmnibox,
        openExportDialog,
        openImportDialog,
        openPortfolioChat,
        closePortfolioChat,
        portfolioChatOpen,
        openProcessCreation,
        requestFolderCreation,
    } = useUIStore();
    const { isDirty, isSaving, saveError, savePortfolio } = usePortfolioStore();
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const proposalCount = useProposalReviewStore(state => state.entries.length);
    const pendingProposalCount = useProposalReviewStore(state => (
        state.entries.filter(entry => entry.status === 'pending').length
    ));
    const openProposalReview = useProposalReviewStore(state => state.openReview);

    const handleOpenImport = () => {
        setFileMenuOpen(false);
        openImportDialog();
    };

    const handleOpenExport = () => {
        setFileMenuOpen(false);
        openExportDialog();
    };

    const handleNewProcess = () => {
        setFileMenuOpen(false);
        openProcessCreation();
    };

    const handleNewFolder = () => {
        setFileMenuOpen(false);
        requestFolderCreation();
    };

    const handleSave = async () => {
        try {
            await savePortfolio();
        } catch (error) {
            console.error("Manual save failed", error);
        }
    };

    const handleMenuSave = () => {
        setFileMenuOpen(false);
        void handleSave();
    };

    return (
        <header className={`axiom-app-header h-12 bg-app-header border-b border-app-border flex items-center justify-between px-4 z-50 shrink-0 select-none ${preview ? 'pointer-events-none' : ''}`}>
            <div className={`flex items-center gap-3 ${preview ? 'min-w-0' : 'w-[300px]'}`}>
                <div className="flex items-center gap-3 pointer-events-none">
                    <ThemeBrandMark
                        presentation={brandPresentation}
                        size={28}
                        logoClassName="drop-shadow-glow-primary"
                    />
                    {!preview && isDirty && (
                        <span className="text-[9px] text-accent-warning font-medium">●</span>
                    )}
                </div>

                <div className="w-[1px] h-5 bg-app-border" />

                <div className="flex items-center gap-1">
                    <div className="relative">
                        <AxiomButton
                            aria-expanded={fileMenuOpen}
                            aria-haspopup="menu"
                            onClick={() => setFileMenuOpen((open) => !open)}
                            variant="ghost"
                            className="h-8 px-2 text-xs"
                            title="File actions"
                        >
                            <FileText size={17} />
                            <span className={preview ? 'hidden' : 'hidden xl:inline text-xs font-medium'}>File</span>
                            <ChevronDown size={13} className={fileMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                        </AxiomButton>

                        {fileMenuOpen && (
                            <>
                                <div
                                    aria-hidden="true"
                                    className="fixed inset-0 z-40 bg-transparent cursor-default"
                                    onClick={() => setFileMenuOpen(false)}
                                />
                                <AxiomMenu
                                    aria-label="File actions"
                                    className="absolute left-0 top-10 z-50 w-56"
                                    onClose={() => setFileMenuOpen(false)}
                                    surface="file"
                                >
                                    <AxiomMenuItem
                                        aria-keyshortcuts="Control+N Meta+N"
                                        onClick={handleNewProcess}
                                    >
                                        <FilePlus2 size={15} />
                                        <span>New process...</span>
                                        <kbd className="ml-auto text-[10px] text-text-faint">Ctrl+N</kbd>
                                    </AxiomMenuItem>
                                    <AxiomMenuItem
                                        aria-keyshortcuts="Control+Shift+N Meta+Shift+N"
                                        onClick={handleNewFolder}
                                    >
                                        <FolderPlus size={15} />
                                        <span>New folder...</span>
                                        <kbd className="ml-auto text-[10px] text-text-faint">Ctrl+Shift+N</kbd>
                                    </AxiomMenuItem>
                                    <AxiomMenuDivider />
                                    <AxiomMenuItem
                                        aria-keyshortcuts="Control+S Meta+S"
                                        disabled={isSaving}
                                        onClick={handleMenuSave}
                                    >
                                        {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                        <span>{isSaving ? 'Saving...' : 'Save'}</span>
                                        <kbd className="ml-auto text-[10px] text-text-faint">Ctrl+S</kbd>
                                    </AxiomMenuItem>
                                    <AxiomMenuDivider />
                                    <AxiomMenuItem
                                        onClick={handleOpenImport}
                                    >
                                        <Upload size={15} />
                                        <span>Import...</span>
                                    </AxiomMenuItem>
                                    <AxiomMenuItem
                                        onClick={handleOpenExport}
                                    >
                                        <Download size={15} />
                                        <span>Export...</span>
                                    </AxiomMenuItem>
                                </AxiomMenu>
                            </>
                        )}
                    </div>

                    <AxiomButton
                        aria-label={saveError ? `Save failed: ${saveError}` : isDirty ? "Save changes (Unsaved)" : "Save project"}
                        icon
                        variant="ghost"
                        className={isDirty ? 'axiom-icon-button-warning' : undefined}
                        onClick={handleSave}
                        disabled={isSaving}
                        title={saveError ? `Save failed: ${saveError}` : isDirty ? "Save changes (Unsaved)" : "Save project"}
                    >
                        {isSaving ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : (
                            <Save size={18} />
                        )}
                    </AxiomButton>
                </div>
            </div>

            <div className={`flex-1 min-w-0 ${preview ? 'max-w-sm px-3' : 'max-w-lg'}`}>
                <button
                    type="button"
                    aria-keyshortcuts="Control+K Meta+K"
                    aria-label="Search processes, resources, and notes"
                    onClick={openOmnibox}
                    className="axiom-field relative group flex w-full cursor-pointer items-center py-1.5 pl-9 pr-10 text-left text-xs text-text-faint"
                >
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted group-hover:text-accent-primary transition-colors" />
                    <span className="flex w-full items-center justify-between">
                        <span>Search processes, resources, notes...</span>
                        <span className="flex items-center gap-1 opacity-50" aria-hidden="true">
                            <span className="text-[10px] font-mono bg-app-header px-1 rounded border border-app-border">CTRL</span>
                            <span className="text-[10px] font-mono bg-app-header px-1 rounded border border-app-border">K</span>
                        </span>
                    </span>
                </button>
            </div>

            <div className={`${preview ? 'w-8' : 'w-[300px]'} flex shrink-0 justify-end gap-1`}>
                {!preview && (
                    <AxiomButton
                        aria-label="Open Portfolio Chat"
                        aria-pressed={portfolioChatOpen}
                        className="axiom-portfolio-chat-trigger h-8 gap-2 px-2.5 text-xs"
                        onClick={portfolioChatOpen ? closePortfolioChat : openPortfolioChat}
                        title="Ask your local AI about the current process or selection"
                        variant={portfolioChatOpen ? 'primary' : 'ghost'}
                    >
                        <MessagesSquare size={16} />
                        <span className="hidden xl:inline">Chat</span>
                    </AxiomButton>
                )}
                {!preview && proposalCount > 0 && (
                    <AxiomButton
                        aria-label={`Open proposal review${pendingProposalCount > 0 ? `, ${pendingProposalCount} pending` : ''}`}
                        className="relative h-8 gap-2 px-2.5 text-xs"
                        onClick={() => openProposalReview()}
                        title="Review plugin and AI proposals"
                        variant="ghost"
                    >
                        <ShieldCheck size={16} />
                        <span className="hidden xl:inline">Review</span>
                        {pendingProposalCount > 0 && (
                            <span className="flex min-w-4 items-center justify-center rounded-full bg-accent-warning px-1 text-[9px] font-bold text-app-bg">
                                {pendingProposalCount > 99 ? '99+' : pendingProposalCount}
                            </span>
                        )}
                    </AxiomButton>
                )}
            </div>
        </header>
    );
}
