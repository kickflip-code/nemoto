import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Boxes, FlaskConical, PackageCheck, RotateCcw, X } from 'lucide-react';
import type { PluginDeveloperSandboxSession } from '../../host/pluginDeveloperSandbox';
import {
    NemotoButton,
    NemotoDialog,
    NemotoDialogBody,
    NemotoDialogFooter,
    NemotoDialogHeader,
    NemotoSelect,
} from '../ui';
import { PluginHostServicesProvider } from './PluginHostServicesContext';
const PluginViewHost = lazy(() => import('./PluginViewHost'));

interface DeveloperPluginSandboxDialogProps {
    session: PluginDeveloperSandboxSession;
    onDiscard: () => void;
}

export default function DeveloperPluginSandboxDialog({
    session,
    onDiscard,
}: DeveloperPluginSandboxDialogProps) {
    const hostSnapshot = useSyncExternalStore(
        session.services.subscribe,
        session.services.getSnapshot,
        session.services.getSnapshot,
    );
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const summary = session.getSummary();
    const activeView = session.runtime.content.getPayload(hostSnapshot.activeView, 'views');

    const requestDiscard = () => {
        if (summary.changeCount > 0) {
            setConfirmDiscard(true);
            return;
        }
        onDiscard();
    };

    return (
        <NemotoDialog
            aria-describedby="developer-sandbox-description"
            aria-labelledby="developer-sandbox-title"
            closeOnBackdrop={false}
            onClose={requestDiscard}
            panelClassName="flex h-[90vh] w-[94vw] max-w-[1500px] flex-col overflow-hidden border-2 border-accent-warning/60 shadow-2xl shadow-black/40"
            rootClassName="z-[10140]"
        >
            <NemotoDialogHeader className="flex shrink-0 items-start justify-between gap-4 border-b border-accent-warning/40 bg-accent-warning/10 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent-warning/50 bg-accent-warning/15 text-accent-warning">
                        <FlaskConical size={20} />
                    </div>
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-accent-warning">Disposable sandbox</div>
                        <h2 id="developer-sandbox-title" className="mt-0.5 text-base font-bold text-text-main">Isolated plugin portfolio clone</h2>
                        <p id="developer-sandbox-description" className="mt-1 text-xs leading-relaxed text-text-muted">
                            Changes stay in this in-memory clone. They cannot be saved, merged, or applied to your real portfolio.
                        </p>
                    </div>
                </div>
                <NemotoButton aria-label="Discard and close sandbox" icon onClick={requestDiscard} size="sm" variant="ghost">
                    <X size={16} />
                </NemotoButton>
            </NemotoDialogHeader>

            <div className="grid shrink-0 grid-cols-2 gap-px border-b border-app-border bg-app-border sm:grid-cols-5">
                <SandboxMetric label="Source revision" value={summary.sourceRevision} />
                <SandboxMetric label="Sandbox revision" value={summary.sandboxRevision} warning={summary.changeCount > 0} />
                <SandboxMetric label="Packages" value={summary.packageCount} icon={PackageCheck} />
                <SandboxMetric label="Active plugins" value={summary.activePluginCount} icon={Boxes} />
                <SandboxMetric label="Disposable changes" value={summary.changeCount} warning={summary.changeCount > 0} />
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-app-border bg-app-sidebar px-5 py-3">
                <label className="flex min-w-0 items-center gap-3 text-xs text-text-muted">
                    <span className="shrink-0 font-semibold text-text-main">Plugin view</span>
                    <NemotoSelect
                        aria-label="Sandbox plugin view"
                        className="min-w-56"
                        disabled={session.runtime.navigationViews.length === 0}
                        value={activeView?.id || ''}
                        onChange={event => session.services.navigation.open(event.target.value)}
                    >
                        {session.runtime.navigationViews.length === 0 && <option value="">No navigation views</option>}
                        {session.runtime.navigationViews.map(view => (
                            <option key={view.id} value={view.id}>{view.navigation.label}</option>
                        ))}
                    </NemotoSelect>
                </label>
                <div className="flex items-center gap-2 rounded border border-accent-warning/30 bg-accent-warning/5 px-3 py-1.5 text-[10px] font-semibold text-accent-warning">
                    <AlertTriangle size={13} /> No Core-store or autosave path
                </div>
            </div>

            <NemotoDialogBody className="min-h-0 flex-1 overflow-hidden bg-app-bg p-0">
                <PluginHostServicesProvider services={session.services}>
                    {activeView ? (
                        <Suspense fallback={<p role="status">Loading plugin view...</p>}>
                            <PluginViewHost runtime={session.runtime} sandbox viewId={activeView.id} />
                        </Suspense>
                    ) : (
                        <div className="flex h-full items-center justify-center p-8 text-center">
                            <div className="max-w-md">
                                <FlaskConical size={30} className="mx-auto text-text-faint" />
                                <h3 className="mt-4 text-sm font-bold text-text-main">No sandbox view available</h3>
                                <p className="mt-2 text-xs leading-relaxed text-text-muted">
                                    The cloned portfolio is isolated, but none of its active declarative plugins contributes an App Rail view.
                                </p>
                            </div>
                        </div>
                    )}
                </PluginHostServicesProvider>
            </NemotoDialogBody>

            <NemotoDialogFooter className={`flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3 ${confirmDiscard
                ? 'border-accent-warning/40 bg-accent-warning/10'
                : ''}`}
            >
                {confirmDiscard ? (
                    <>
                        <div role="alert" className="flex items-center gap-2 text-xs font-semibold text-text-main">
                            <AlertTriangle size={15} className="text-accent-warning" />
                            Discard {summary.changeCount} isolated {summary.changeCount === 1 ? 'change' : 'changes'}?
                        </div>
                        <div className="flex items-center gap-2">
                            <NemotoButton onClick={() => setConfirmDiscard(false)}>Keep sandbox open</NemotoButton>
                            <NemotoButton onClick={onDiscard} variant="warning">
                                <RotateCcw size={15} /> Discard changes
                            </NemotoButton>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-[10px] leading-relaxed text-text-faint">
                            Closing destroys the clone. There is intentionally no Save or Apply action.
                        </p>
                        <NemotoButton onClick={requestDiscard} variant={summary.changeCount > 0 ? 'warning' : 'default'}>
                            <RotateCcw size={15} /> {summary.changeCount > 0 ? 'Discard & close' : 'Close sandbox'}
                        </NemotoButton>
                    </>
                )}
            </NemotoDialogFooter>
        </NemotoDialog>
    );
}

function SandboxMetric({
    label,
    value,
    warning = false,
    icon: Icon,
}: {
    label: string;
    value: number;
    warning?: boolean;
    icon?: typeof PackageCheck;
}) {
    return (
        <div className="bg-app-surface px-4 py-2.5">
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-text-faint">
                {Icon && <Icon size={11} />}{label}
            </div>
            <div className={`mt-1 text-xs font-bold ${warning ? 'text-accent-warning' : 'text-text-main'}`}>{value}</div>
        </div>
    );
}
