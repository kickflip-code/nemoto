import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Database,
    KeyRound,
    Loader2,
    RefreshCw,
    ShieldCheck,
    Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    pluginDeviceStorageAdmin,
    type PluginDeviceStorageAdminEntry,
    type PluginDeviceStorageAdminService,
} from '../../host/pluginDeviceStorageAdmin';
import type { InstalledPluginDocument } from '../../plugins/installedPackages';
import ConfirmationModal from '../shared/ConfirmationModal';
import { AxiomButton } from '../ui';

interface PluginDeviceStoragePanelProps {
    installedPlugins: readonly InstalledPluginDocument[];
    service?: PluginDeviceStorageAdminService;
}

const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
};

export default function PluginDeviceStoragePanel({
    installedPlugins,
    service = pluginDeviceStorageAdmin,
}: PluginDeviceStoragePanelProps) {
    const [entries, setEntries] = useState<readonly PluginDeviceStorageAdminEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [clearingPluginId, setClearingPluginId] = useState<string | null>(null);
    const [pendingClear, setPendingClear] = useState<PluginDeviceStorageAdminEntry | null>(null);
    const names = useMemo(() => new Map(
        installedPlugins.map(document => [document.manifest.id, document.manifest.name]),
    ), [installedPlugins]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadFailed(false);
        try {
            setEntries(await service.list());
        } catch {
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    }, [service]);

    useEffect(() => {
        void load();
    }, [load]);

    const clearPending = async () => {
        if (!pendingClear) return;
        const entry = pendingClear;
        setClearingPluginId(entry.pluginId);
        setPendingClear(null);
        try {
            const result = await service.clear(entry.pluginId);
            setEntries(await service.list());
            toast.success(
                `Cleared ${result.settingsDocumentsCleared} settings and ${result.secretsCleared} protected secrets`,
            );
        } catch {
            toast.error('Plugin device data could not be cleared safely. Portfolio data was not changed.');
            await load();
        } finally {
            setClearingPluginId(null);
        }
    };

    return (
        <section aria-labelledby="plugin-device-storage-title" className="space-y-3 border-t border-app-border pt-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h4 id="plugin-device-storage-title" className="flex items-center gap-2 text-sm font-bold text-text-main">
                        <Database size={15} className="text-accent-neutral" />
                        Device-local plugin data
                    </h4>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
                        Review settings and protected credentials retained outside Portfolio files. Secret values are never displayed. Clearing does not change any Portfolio.
                    </p>
                </div>
                <AxiomButton
                    icon
                    size="sm"
                    title="Refresh device-local plugin data"
                    aria-label="Refresh device-local plugin data"
                    disabled={loading || clearingPluginId !== null}
                    onClick={() => { void load(); }}
                >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </AxiomButton>
            </div>

            {loadFailed ? (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-accent-danger/30 bg-accent-danger/5 p-3 text-xs text-accent-danger">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <div>
                        <div className="font-bold">Device data could not be inspected safely.</div>
                        <p className="mt-1 text-text-muted">No data was changed. Try refreshing this inventory.</p>
                    </div>
                </div>
            ) : loading ? (
                <div role="status" className="flex items-center gap-2 py-4 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" /> Inspecting retained plugin data…
                </div>
            ) : entries.length === 0 ? (
                <div className="axiom-dialog-panel flex items-start gap-3 p-4 text-xs text-text-muted">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent-success" />
                    No device-local plugin settings or secret metadata are retained.
                </div>
            ) : (
                <div className="space-y-2">
                    {entries.map(entry => {
                        const name = names.get(entry.pluginId);
                        const clearing = clearingPluginId === entry.pluginId;
                        return (
                            <article key={entry.pluginId} className="axiom-dialog-row p-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-text-main">
                                            {name || 'Previously installed plugin'}
                                        </div>
                                        <div className="mt-1 break-all font-mono text-[10px] text-text-faint">
                                            {entry.pluginId}
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-muted">
                                            {entry.hasSettings && (
                                                <span className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1">
                                                    <Database size={11} />
                                                    {entry.settingsDocumentCount} settings · {formatBytes(entry.settingsBytes)}
                                                </span>
                                            )}
                                            {entry.hasSecretIndex && (
                                                <span className="inline-flex items-center gap-1 rounded border border-app-border px-2 py-1">
                                                    <KeyRound size={11} />
                                                    {entry.secretCount} protected {entry.secretCount === 1 ? 'secret' : 'secrets'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <AxiomButton
                                        size="sm"
                                        variant="danger"
                                        disabled={clearingPluginId !== null}
                                        onClick={() => setPendingClear(entry)}
                                    >
                                        {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                        {clearing ? 'Clearing…' : 'Clear device data'}
                                    </AxiomButton>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            <ConfirmationModal
                isOpen={pendingClear !== null}
                onClose={() => setPendingClear(null)}
                onConfirm={() => { void clearPending(); }}
                title="Clear retained plugin data?"
                message={pendingClear
                    ? `This permanently deletes ${pendingClear.settingsDocumentCount} device settings and ${pendingClear.secretCount} protected secrets for ${names.get(pendingClear.pluginId) || pendingClear.pluginId}. Portfolio data is not affected. This cannot be undone.`
                    : ''}
                confirmLabel="Clear permanently"
                variant="danger"
            />
        </section>
    );
}
