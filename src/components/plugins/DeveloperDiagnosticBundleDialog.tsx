import { useState } from 'react';
import { Download, FileJson2, Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import {
    writePreparedPluginDiagnosticBundleExport,
    type PreparedPluginDiagnosticBundleExport,
} from '../../host/pluginDiagnosticBundleExport';
import {
    NemotoButton,
    NemotoDialog,
    NemotoDialogBody,
    NemotoDialogFooter,
    NemotoDialogHeader,
    NemotoTextarea,
} from '../ui';

interface DeveloperDiagnosticBundleDialogProps {
    prepared: PreparedPluginDiagnosticBundleExport;
    onClose: () => void;
}

const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
};

export default function DeveloperDiagnosticBundleDialog({
    prepared,
    onClose,
}: DeveloperDiagnosticBundleDialogProps) {
    const [exporting, setExporting] = useState(false);

    const closeWhenIdle = () => {
        if (!exporting) onClose();
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const saved = await writePreparedPluginDiagnosticBundleExport(prepared);
            if (saved) toast.success('Support bundle saved');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The support bundle could not be saved.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <NemotoDialog
            aria-describedby="developer-bundle-description"
            aria-labelledby="developer-bundle-title"
            closeOnBackdrop={!exporting}
            onClose={closeWhenIdle}
            panelClassName="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden"
            rootClassName="z-[10130]"
        >
            <NemotoDialogHeader className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent-neutral/30 bg-accent-neutral/10 text-accent-neutral">
                        <FileJson2 size={18} />
                    </div>
                    <div>
                        <h2 id="developer-bundle-title" className="text-base font-bold text-text-main">Preview support bundle</h2>
                        <p id="developer-bundle-description" className="mt-1 text-xs leading-relaxed text-text-muted">
                            Review the complete JSON below. Export writes this exact frozen preview; later diagnostics are not added.
                        </p>
                    </div>
                </div>
                <NemotoButton
                    aria-label="Close support bundle preview"
                    disabled={exporting}
                    icon
                    onClick={closeWhenIdle}
                    size="sm"
                    variant="ghost"
                >
                    <X size={16} />
                </NemotoButton>
            </NemotoDialogHeader>

            <NemotoDialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <div className="flex items-start gap-3 rounded-lg border border-accent-success/25 bg-accent-success/5 p-3">
                    <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent-success" />
                    <div>
                        <div className="text-xs font-bold text-text-main">Support redaction applied</div>
                        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                            Plugin and contribution identifiers are aliases. Diagnostic context is allowlisted and was redacted before retention.
                        </p>
                    </div>
                </div>

                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="nemoto-dialog-panel p-3">
                        <dt className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Schema</dt>
                        <dd className="mt-1 text-xs font-semibold text-text-main">v{prepared.schemaVersion}</dd>
                    </div>
                    <div className="nemoto-dialog-panel p-3">
                        <dt className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Packages</dt>
                        <dd className="mt-1 text-xs font-semibold text-text-main">{prepared.packageCount}</dd>
                    </div>
                    <div className="nemoto-dialog-panel p-3">
                        <dt className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Entries</dt>
                        <dd className="mt-1 text-xs font-semibold text-text-main">{prepared.entryCount}</dd>
                    </div>
                    <div className="nemoto-dialog-panel p-3">
                        <dt className="text-[9px] font-bold uppercase tracking-wider text-text-faint">File size</dt>
                        <dd className="mt-1 text-xs font-semibold text-text-main">{formatBytes(prepared.byteLength)}</dd>
                    </div>
                </dl>

                <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor="developer-bundle-json" className="text-xs font-bold text-text-main">Exact JSON to export</label>
                        <span className="break-all font-mono text-[10px] text-text-faint">{prepared.suggestedFileName}</span>
                    </div>
                    <NemotoTextarea
                        id="developer-bundle-json"
                        aria-label="Exact support bundle JSON"
                        className="min-h-72 resize-y whitespace-pre font-mono text-[11px] leading-relaxed"
                        readOnly
                        spellCheck={false}
                        value={prepared.json}
                    />
                </div>
            </NemotoDialogBody>

            <NemotoDialogFooter className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
                <p className="text-[10px] leading-relaxed text-text-faint">No file is created until you choose Export JSON and confirm a location.</p>
                <div className="flex items-center gap-2">
                    <NemotoButton disabled={exporting} onClick={closeWhenIdle}>Close</NemotoButton>
                    <NemotoButton disabled={exporting} onClick={() => void handleExport()} variant="primary">
                        {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        {exporting ? 'Saving…' : 'Export JSON…'}
                    </NemotoButton>
                </div>
            </NemotoDialogFooter>
        </NemotoDialog>
    );
}
