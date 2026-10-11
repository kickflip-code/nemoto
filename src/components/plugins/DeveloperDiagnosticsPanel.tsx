import { useEffect, useState, useSyncExternalStore } from 'react';
import {
    Activity,
    AlertTriangle,
    Bug,
    FileJson2,
    FlaskConical,
    Loader2,
    PackageCheck,
    RefreshCw,
    ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    pluginDeveloperDiagnostics,
    type PluginDeveloperDiagnosticsService,
} from '../../host/pluginDeveloperDiagnostics';
import type {
    PluginDeveloperDiagnosticSnapshot,
    PluginDiagnosticEntry,
} from '../../plugins/developerDiagnostics';
import {
    preparePluginDiagnosticBundleExport,
    type PreparedPluginDiagnosticBundleExport,
} from '../../host/pluginDiagnosticBundleExport';
import { pluginDeveloperRuntimeReload } from '../../host/pluginDeveloperRuntimeReload';
import { pluginDeveloperSandbox } from '../../host/pluginDeveloperSandbox';
import { AxiomButton, AxiomSwitch } from '../ui';
import DeveloperDiagnosticBundleDialog from './DeveloperDiagnosticBundleDialog';
import DeveloperPluginSandboxDialog from './DeveloperPluginSandboxDialog';

const MAX_VISIBLE_ENTRIES = 100;

type DeveloperDiagnosticsReader = Pick<
    PluginDeveloperDiagnosticsService,
    'createSanitizedBundle' | 'getSnapshot' | 'subscribe'
>;

interface DeveloperDiagnosticsPanelProps {
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    diagnostics?: DeveloperDiagnosticsReader;
}

const severityClasses: Record<PluginDiagnosticEntry['severity'], string> = {
    debug: 'border-app-border bg-app-bg/40 text-text-muted',
    info: 'border-accent-neutral/25 bg-accent-neutral/5 text-text-main',
    warning: 'border-accent-warning/30 bg-accent-warning/5 text-text-main',
    error: 'border-accent-danger/30 bg-accent-danger/5 text-text-main',
};

const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
};

const formatContextValue = (value: unknown): string => (
    Array.isArray(value) ? value.join(', ') : String(value)
);

export default function DeveloperDiagnosticsPanel({
    enabled,
    onEnabledChange,
    diagnostics = pluginDeveloperDiagnostics,
}: DeveloperDiagnosticsPanelProps) {
    const [snapshot, setSnapshot] = useState<PluginDeveloperDiagnosticSnapshot>(() => (
        diagnostics.getSnapshot()
    ));
    const [preparedBundle, setPreparedBundle] = useState<PreparedPluginDiagnosticBundleExport | null>(null);
    const reloadSnapshot = useSyncExternalStore(
        pluginDeveloperRuntimeReload.subscribe,
        pluginDeveloperRuntimeReload.getSnapshot,
        pluginDeveloperRuntimeReload.getSnapshot,
    );
    const sandboxSnapshot = useSyncExternalStore(
        pluginDeveloperSandbox.subscribe,
        pluginDeveloperSandbox.getSnapshot,
        pluginDeveloperSandbox.getSnapshot,
    );
    const sandboxSession = sandboxSnapshot.active ? pluginDeveloperSandbox.getSession() : null;

    useEffect(() => {
        const update = () => setSnapshot(diagnostics.getSnapshot());
        update();
        return diagnostics.subscribe(update);
    }, [diagnostics]);

    useEffect(() => {
        if (!enabled) {
            setPreparedBundle(null);
            pluginDeveloperSandbox.stop();
        }
    }, [enabled]);

    useEffect(() => () => pluginDeveloperSandbox.stop(), []);

    const handleBundlePreview = () => {
        try {
            setPreparedBundle(preparePluginDiagnosticBundleExport(
                diagnostics.createSanitizedBundle(),
            ));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The support bundle could not be prepared.');
        }
    };

    const handleRuntimeReload = async () => {
        try {
            const result = await pluginDeveloperRuntimeReload.reload();
            toast.success(`Declarative runtime reloaded · generation ${result.generation}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Declarative package reload was rejected.');
        }
    };

    const handleSandboxOpen = () => {
        try {
            pluginDeveloperSandbox.start();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The sandbox clone could not be created.');
        }
    };

    const visibleEntries = snapshot.entries.slice(-MAX_VISIBLE_ENTRIES).reverse();
    const retainedSummary = snapshot.entries.length > visibleEntries.length
        ? `Showing the latest ${visibleEntries.length} of ${snapshot.entries.length} retained entries.`
        : `${snapshot.entries.length} retained ${snapshot.entries.length === 1 ? 'entry' : 'entries'} in this session.`;

    return (
        <section aria-labelledby="settings-developer-title" className="space-y-5">
            <div>
                <h3 id="settings-developer-title" className="text-base font-bold text-text-main">Developer Mode</h3>
                <p className="mt-1 text-xs text-text-muted">
                    Inspect bounded, sanitized plugin diagnostics without exposing a web inspector or bypassing permissions.
                </p>
            </div>

            <div className="axiom-dialog-row flex items-start justify-between gap-5 p-4">
                <div className="flex min-w-0 items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${enabled
                        ? 'border-accent-warning/35 bg-accent-warning/10 text-accent-warning'
                        : 'border-app-border bg-app-bg/50 text-text-muted'}`}
                    >
                        <Bug size={17} />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-text-main">Diagnostic capture</h4>
                        <p className="mt-1 text-xs leading-relaxed text-text-muted">
                            Stored only on this device. Turning it off immediately clears the retained diagnostic log.
                        </p>
                    </div>
                </div>
                <AxiomSwitch
                    checked={enabled}
                    label="Developer Mode diagnostic capture"
                    onCheckedChange={onEnabledChange}
                    className="mt-1 shrink-0"
                />
            </div>

            {!enabled ? (
                <div className="axiom-dialog-panel flex items-start gap-3 p-4 text-xs text-text-muted">
                    <ShieldCheck size={17} className="mt-0.5 shrink-0 text-accent-success" />
                    <p className="leading-relaxed">
                        Developer Mode is off. Nemoto is not retaining plugin diagnostic entries. Package permissions and normal runtime validation remain active.
                    </p>
                </div>
            ) : (
                <>
                    <div
                        role="status"
                        className="flex items-start gap-3 rounded-lg border border-accent-warning/30 bg-accent-warning/5 p-4"
                    >
                        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-accent-warning" />
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-accent-warning">Developer Mode active</div>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                This read-only view contains stable codes and allowlisted metadata only. Raw messages, paths, prompts, queries, portfolio content, secrets, and plugin data are excluded before retention.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <div className="axiom-dialog-panel p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Host plugin API</div>
                            <div className="mt-1 font-mono text-xs text-text-main">{snapshot.hostPluginApiVersion}</div>
                        </div>
                        <div className="axiom-dialog-panel p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Packages</div>
                            <div className="mt-1 text-xs font-semibold text-text-main">{snapshot.packages.length}</div>
                        </div>
                        <div className="axiom-dialog-panel p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Log retention</div>
                            <div className="mt-1 text-xs font-semibold text-text-main">{snapshot.entries.length} / {snapshot.limits.maxEntries}</div>
                        </div>
                        <div className="axiom-dialog-panel p-3">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Context limit</div>
                            <div className="mt-1 text-xs font-semibold text-text-main">{formatBytes(snapshot.limits.maxContextBytes)}</div>
                        </div>
                    </div>

                    <div className="axiom-dialog-row flex flex-wrap items-start justify-between gap-4 p-4">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                            <FileJson2 size={17} className="mt-0.5 shrink-0 text-accent-neutral" />
                            <div>
                                <h4 className="text-sm font-bold text-text-main">Support bundle</h4>
                                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                    Create a frozen, fully aliased JSON preview. No file is written until you review it and explicitly choose an export location.
                                </p>
                            </div>
                        </div>
                        <AxiomButton onClick={handleBundlePreview} size="sm">
                            <FileJson2 size={15} />
                            Preview support bundle
                        </AxiomButton>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2" aria-label="Developer runtime tools">
                        <article className="axiom-dialog-panel flex flex-col p-4">
                            <div className="flex items-start gap-3">
                                <RefreshCw size={17} className="mt-0.5 shrink-0 text-accent-neutral" />
                                <div>
                                    <h4 className="text-sm font-bold text-text-main">Reload declarative packages</h4>
                                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                        Re-read installed documents and rebuild the complete validated catalog and registries. Portfolio data and grants are never changed.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
                                <div className="text-[10px] leading-relaxed text-text-faint">
                                    {reloadSnapshot.status === 'succeeded'
                                        ? `Generation ${reloadSnapshot.generation} · ${reloadSnapshot.activePluginCount} active · ${reloadSnapshot.navigationViewCount} views`
                                        : reloadSnapshot.status === 'rejected'
                                            ? `Last reload rejected · ${reloadSnapshot.lastErrorCode?.replace(/-/g, ' ')}`
                                            : 'Invalid candidates are rejected before publication.'}
                                </div>
                                <AxiomButton
                                    disabled={reloadSnapshot.status === 'reloading'}
                                    onClick={() => void handleRuntimeReload()}
                                    size="sm"
                                >
                                    {reloadSnapshot.status === 'reloading'
                                        ? <Loader2 size={15} className="animate-spin" />
                                        : <RefreshCw size={15} />}
                                    {reloadSnapshot.status === 'reloading' ? 'Validating…' : 'Reload packages'}
                                </AxiomButton>
                            </div>
                        </article>

                        <article className="axiom-dialog-panel flex flex-col border-accent-warning/20 p-4">
                            <div className="flex items-start gap-3">
                                <FlaskConical size={17} className="mt-0.5 shrink-0 text-accent-warning" />
                                <div>
                                    <h4 className="text-sm font-bold text-text-main">Disposable sandbox clone</h4>
                                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                        Open active plugin views against an isolated in-memory copy. Closing destroys every sandbox change; there is no Save or Apply path.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
                                <div className="text-[10px] leading-relaxed text-text-faint">
                                    {sandboxSnapshot.session
                                        ? `${sandboxSnapshot.session.changeCount} disposable changes · source revision ${sandboxSnapshot.session.sourceRevision}`
                                        : 'Uses the same production capability grants.'}
                                </div>
                                <AxiomButton onClick={handleSandboxOpen} size="sm" variant="warning">
                                    <FlaskConical size={15} /> Open sandbox clone
                                </AxiomButton>
                            </div>
                        </article>
                    </div>

                    <div className="space-y-2" aria-labelledby="developer-packages-title">
                        <div className="flex items-center justify-between gap-3">
                            <h4 id="developer-packages-title" className="flex items-center gap-2 text-sm font-bold text-text-main">
                                <PackageCheck size={15} className="text-accent-neutral" />
                                Package inventory
                            </h4>
                            <span className="text-[10px] text-text-faint">Read-only effective state</span>
                        </div>
                        {snapshot.packages.length === 0 ? (
                            <div className="axiom-dialog-panel p-4 text-xs text-text-muted">No installed or portfolio-requested plugins.</div>
                        ) : (
                            <div className="space-y-2">
                                {snapshot.packages.map(item => (
                                    <article key={item.pluginId} className="axiom-dialog-panel p-3">
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="truncate font-mono text-xs font-semibold text-text-main">{item.pluginId}</div>
                                                <div className="mt-1 text-[10px] text-text-faint">
                                                    {item.installedVersion ? `v${item.installedVersion}` : 'Package missing'} · data {item.installedDataVersion ?? item.requiredDataVersion ?? '—'}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap justify-end gap-1.5 text-[9px] font-bold uppercase tracking-wider">
                                                <span className="rounded border border-app-border px-1.5 py-0.5 text-text-muted">{item.activation}</span>
                                                <span className={`rounded border px-1.5 py-0.5 ${item.compatibility === 'compatible'
                                                    ? 'border-accent-success/30 text-accent-success'
                                                    : 'border-accent-danger/30 text-accent-danger'}`}
                                                >
                                                    {item.compatibility}
                                                </span>
                                            </div>
                                        </div>
                                        <dl className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                                            <div>
                                                <dt className="text-text-faint">Effective grants</dt>
                                                <dd className="mt-0.5 break-words text-text-muted">{item.effectiveGrants.join(', ') || 'None'}</dd>
                                            </div>
                                            <div>
                                                <dt className="text-text-faint">Contributions</dt>
                                                <dd className="mt-0.5 break-words text-text-muted">
                                                    {Object.entries(item.contributionCounts).map(([family, count]) => `${family}: ${count}`).join(', ') || 'None'}
                                                </dd>
                                            </div>
                                        </dl>
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2" aria-labelledby="developer-log-title">
                        <div className="flex items-center justify-between gap-3">
                            <h4 id="developer-log-title" className="flex items-center gap-2 text-sm font-bold text-text-main">
                                <Activity size={15} className="text-accent-primary" />
                                Recent diagnostics
                            </h4>
                            <span className="text-[10px] text-text-faint">{retainedSummary}</span>
                        </div>
                        {visibleEntries.length === 0 ? (
                            <div className="axiom-dialog-panel p-4 text-xs text-text-muted">No diagnostics captured in this session.</div>
                        ) : (
                            <ol className="space-y-2">
                                {visibleEntries.map(entry => (
                                    <li key={entry.sequence} className={`rounded-lg border p-3 ${severityClasses[entry.severity]}`}>
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div>
                                                <div className="font-mono text-xs font-semibold">{entry.code}</div>
                                                <div className="mt-1 text-[10px] text-text-faint">
                                                    {entry.source} · {new Date(entry.timestamp).toLocaleTimeString()}
                                                    {entry.durationMs === undefined ? '' : ` · ${entry.durationMs.toFixed(1)} ms`}
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-bold uppercase tracking-wider">{entry.severity}</span>
                                        </div>
                                        {(entry.pluginId || entry.contributionId) && (
                                            <div className="mt-2 break-all font-mono text-[10px] text-text-muted">
                                                {entry.pluginId || 'host'}{entry.pluginVersion ? `@${entry.pluginVersion}` : ''}
                                                {entry.contributionId ? ` · ${entry.contributionId}` : ''}
                                            </div>
                                        )}
                                        {entry.context && Object.keys(entry.context).length > 0 && (
                                            <dl className="mt-2 grid gap-x-3 gap-y-1 border-t border-current/10 pt-2 text-[10px] sm:grid-cols-2">
                                                {Object.entries(entry.context).map(([key, value]) => (
                                                    <div key={key} className="flex min-w-0 gap-1.5">
                                                        <dt className="shrink-0 text-text-faint">{key}</dt>
                                                        <dd className="min-w-0 break-words text-text-muted">{formatContextValue(value)}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>

                    <p className="border-t border-app-border/50 pt-4 text-[10px] leading-relaxed text-text-faint">
                        Developer tools continue to use the production permission broker. They cannot grant capabilities, execute package code, or mutate Core outside reviewed host boundaries.
                    </p>
                </>
            )}
            {preparedBundle && (
                <DeveloperDiagnosticBundleDialog
                    prepared={preparedBundle}
                    onClose={() => setPreparedBundle(null)}
                />
            )}
            {sandboxSession && (
                <DeveloperPluginSandboxDialog
                    session={sandboxSession}
                    onDiscard={() => pluginDeveloperSandbox.stop(sandboxSession.id)}
                />
            )}
        </section>
    );
}
