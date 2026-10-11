import { X, Shield, Share2, Download, AlertCircle, Globe, LockKeyhole } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { useProcessSessionStore } from '../../stores/useProcessSessionStore';
import { BackupService } from '../../services/BackupService';
import { HtmlExportService } from '../../export/HtmlExportService';
import { formatError } from '../../lib/errorUtils';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import { AxiomDialog } from '../ui';
import { exportProcessWithFeedback } from '../shared/exportProcessWithFeedback';

export default function ExportDialog() {
    const { closeExportDialog } = useUIStore();
    const portfolio = usePortfolioStore(s => s.portfolio);
    const activeProcessId = useProcessSessionStore(s => s.activeProcessId);
    const [includeDependencies, setIncludeDependencies] = useState(true);
    const [includeLinkedRecords, setIncludeLinkedRecords] = useState(false);

    const activeProcess = portfolio.processes.find(p => p.id === activeProcessId);
    const exportSummary = useMemo(() => {
        if (!activeProcessId || !includeDependencies) return null;
        try {
            return BackupService.getPartialExportSummary(activeProcessId, true);
        } catch {
            return null;
        }
    }, [activeProcessId, includeDependencies, portfolio]);

    const handleExportFull = async () => {
        const toastId = toast.loading('Preparing portfolio archive...');
        try {
            const success = await BackupService.downloadBackup();
            if (success) {
                toast.success('Portfolio archive saved', { id: toastId });
                closeExportDialog();
            } else {
                toast.dismiss(toastId);
            }
        } catch (error: any) {
            toast.error(`Failed to create portfolio archive: ${formatError(error)}`, { id: toastId });
            console.error(error);
        }
    };

    const handleExportPartial = async () => {
        if (!activeProcessId) return;
        if (await exportProcessWithFeedback(activeProcessId, includeDependencies, includeLinkedRecords)) closeExportDialog();
    };

    const handleExportHtml = async () => {
        if (!activeProcessId) return;
        const toastId = toast.loading('Generating offline HTML viewer...');
        try {
            const success = await HtmlExportService.downloadHtmlExport(activeProcessId, {
                includeJournal: includeDependencies,
                includeAssets: includeDependencies,
                includeDependencyView: includeDependencies
            });

            if (success) {
                toast.success('Offline HTML viewer saved', { id: toastId });
                closeExportDialog();
            } else {
                toast.dismiss(toastId);
            }
        } catch (error: any) {
            toast.error(`Failed to generate HTML viewer: ${formatError(error)}`, { id: toastId });
            console.error(error);
        }
    };

    return (
        <AxiomDialog
            aria-labelledby="export-dialog-title"
            onClose={closeExportDialog}
            panelClassName="w-full max-w-[500px] overflow-hidden flex flex-col"
        >

                {/* Header */}
                <div className="axiom-dialog-header flex items-center justify-between px-6 py-4 border-b">
                    <h2 id="export-dialog-title" className="text-lg font-bold text-text-main flex items-center gap-2">
                        <Download size={18} className="text-accent-primary" />
                        Export
                    </h2>
                    <button
                        aria-label="Close export dialog"
                        onClick={closeExportDialog}
                        className="axiom-icon-button axiom-icon-button-sm axiom-icon-button-ghost"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="axiom-dialog-body p-6 space-y-6">
                    <p className="text-sm text-text-muted leading-relaxed">
                        Choose the export format. Full portfolios use <span className="text-accent-primary font-mono text-xs">.nemoto</span>, process fragments use <span className="text-accent-primary font-mono text-xs">.nemoto-process</span>, and HTML viewers are standalone offline files.
                    </p>

                    <label className="flex items-start gap-2 text-sm text-text-muted"><input type="checkbox" checked={includeLinkedRecords} onChange={event => setIncludeLinkedRecords(event.target.checked)} />Include linked tasks in process file (.nemoto-process). Unlinked tasks and other processes are excluded.</label>
                    <p className="text-xs text-text-muted">HTML viewers do not include tasks. Full Portfolio exports preserve all tasks.</p>
                    <div className="grid grid-cols-1 gap-4">
                        {/* FULL BACKUP */}
                        <button
                            onClick={handleExportFull}
                            className="axiom-dialog-row group p-4 flex items-start gap-4 text-left"
                        >
                            <div className="w-10 h-10 rounded-lg bg-accent-primary/10 flex items-center justify-center text-accent-primary shrink-0 group-hover:scale-110 transition-transform">
                                <Shield size={20} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-text-main mb-1">Export Portfolio (.nemoto)</h4>
                                <p className="text-xs text-text-faint">Contains all Portfolio data plus a portable snapshot of the active appearance. Other installed themes stay device-local.</p>
                            </div>
                        </button>

                        {/* PARTIAL EXPORT */}
                        <button
                            onClick={handleExportPartial}
                            disabled={!activeProcessId}
                            className={`
                                axiom-dialog-row group p-4 flex items-start gap-4 text-left
                                ${activeProcessId
                                    ? ''
                                    : 'opacity-50 grayscale cursor-not-allowed'}
                            `}
                        >
                            <div className="w-10 h-10 rounded-lg bg-accent-neutral/10 flex items-center justify-center text-accent-neutral shrink-0 group-hover:scale-110 transition-transform">
                                <Share2 size={20} />
                            </div>
                            <div className="flex-1">
                                <h4 className="text-sm font-bold text-text-main mb-1">Export Active Process (.nemoto-process)</h4>
                                <p className="text-xs text-text-faint">
                                    {activeProcess
                                        ? `Exports "${activeProcess.title}" and its linked resources.`
                                        : "Open a process to enable partial export."}
                                </p>
                            </div>
                        </button>

                        {/* HTML REPORT EXPORT */}
                        <button
                            onClick={handleExportHtml}
                            disabled={!activeProcessId}
                            className={`
                                axiom-dialog-row group p-4 flex items-start gap-4 text-left
                                ${activeProcessId
                                    ? ''
                                    : 'opacity-50 grayscale cursor-not-allowed'}
                            `}
                        >
                            <div className="w-10 h-10 rounded-lg bg-accent-success/10 flex items-center justify-center text-accent-success shrink-0 group-hover:scale-110 transition-transform">
                                <Globe size={20} />
                            </div>
                            <div className="flex-1">
                                <h4 className="text-sm font-bold text-text-main mb-1">Interactive HTML Viewer</h4>
                                <p className="text-xs text-text-faint">
                                    Generates a standalone offline web viewer for sharing a process without requiring Nemoto.
                                </p>
                            </div>
                        </button>
                    </div>

                    {activeProcessId && (
                        <div className="space-y-2 px-2 py-1">
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="include-deps"
                                    checked={includeDependencies}
                                    onChange={(e) => setIncludeDependencies(e.target.checked)}
                                    className="w-4 h-4 rounded border-app-border bg-app-surface text-accent-primary focus:ring-accent-primary transition-colors cursor-pointer"
                                />
                                <label htmlFor="include-deps" className="text-xs text-text-muted cursor-pointer hover:text-text-main transition-colors">
                                    Include linked resources and shareable journal notes
                                </label>
                            </div>
                            {!!exportSummary?.excludedInternalJournalEntries && (
                                <div
                                    role="status"
                                    className="flex items-center gap-2 pl-7 text-[10px] text-text-faint"
                                >
                                    <LockKeyhole size={11} aria-hidden="true" />
                                    <span>
                                        {exportSummary.excludedInternalJournalEntries}{' '}
                                        internal {exportSummary.excludedInternalJournalEntries === 1 ? 'note' : 'notes'} will be excluded.
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {!activeProcessId && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-warning/5 border border-accent-warning/20 text-accent-warning">
                            <AlertCircle size={14} />
                            <span className="text-[10px] font-medium">Notice: Open a process to export a process fragment or HTML viewer.</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="axiom-dialog-footer px-6 py-4 border-t flex justify-end">
                    <button
                        onClick={closeExportDialog}
                        className="axiom-button text-sm"
                    >
                        Cancel
                    </button>
                </div>
        </AxiomDialog>
    );
}
