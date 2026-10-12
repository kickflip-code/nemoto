import { useMemo, useRef, useState } from 'react';
import { Cpu, FileArchive, LockKeyhole, ShieldAlert, X } from 'lucide-react';
import {
    classifyExecutablePackageChange,
    createExecutableInstallApproval,
    type ExecutableInstallApproval,
    type ExecutablePackageReview,
} from '../../plugins/executablePackageConsent';
import type { InstalledPluginDocument } from '../../plugins/installedPackages';
import type { PluginCapability } from '../../plugins/manifest';
import {
    NemotoButton,
    NemotoDialog,
    NemotoDialogBody,
    NemotoDialogFooter,
    NemotoDialogHeader,
} from '../ui';

const CAPABILITY_LABELS: Partial<Record<PluginCapability, { title: string; detail: string }>> = {
    'compute.isolated': {
        title: 'Run isolated WebAssembly',
        detail: 'Required. The module runs without WASI or ambient access and is bounded by Nemoto’s CPU, memory, and deadline policy.',
    },
    'portfolio.read-scoped': {
        title: 'Read approved portfolio snapshots',
        detail: 'Receives only serialized fields and scopes selected by Core. No live Portfolio or store reference is exposed.',
    },
    'portfolio.read-sensitive': {
        title: 'Read sensitive approved fields',
        detail: 'Allows explicitly classified sensitive fields when the future snapshot broker also authorizes them.',
    },
    'proposal.create': {
        title: 'Create reviewable proposals',
        detail: 'Can return proposals for validation and review. It cannot approve or apply its own changes.',
    },
    'plugin-data.write': {
        title: 'Save plugin-owned portfolio data',
        detail: 'Writes only to the plugin’s isolated namespace through Core validation.',
    },
    'plugin-device-settings.write': {
        title: 'Save device-local settings',
        detail: 'Writes bounded private settings on this device through the host broker.',
    },
    'plugin-secrets.use': {
        title: 'Use protected secrets',
        detail: 'Uses credentials through the operating-system credential broker; secret values are not placed in Portfolio files.',
    },
    'workspace.navigate': {
        title: 'Request workspace navigation',
        detail: 'Can ask Core to reveal an existing validated item. It cannot select private application views.',
    },
    'file.read-selected': {
        title: 'Read user-selected files',
        detail: 'Requires a separate user-selected file operation when that broker becomes available.',
    },
    'file.write-selected': {
        title: 'Write user-selected files',
        detail: 'Can save bounded plain text only to a destination you choose for an immediate plugin action.',
    },
    'network.declared': {
        title: 'Use declared network destinations',
        detail: 'Network access remains unavailable until a separately reviewed broker and destination policy exist.',
    },
    'ai.invoke': {
        title: 'Request host AI',
        detail: 'Can request a bounded host-owned AI operation when the relevant broker authorizes it.',
    },
    'clipboard.read': {
        title: 'Read clipboard content',
        detail: 'Clipboard access remains unavailable until its separate consent boundary exists.',
    },
    'clipboard.write': {
        title: 'Write clipboard content',
        detail: 'Can copy bounded plain text only from an immediate plugin action you activate.',
    },
    'background.run': {
        title: 'Run in the background',
        detail: 'Background execution remains unavailable until its lifecycle and resource policy exist.',
    },
};

const AVAILABLE_EXECUTABLE_GRANTS = new Set<PluginCapability>([
    'compute.isolated',
    'portfolio.read-scoped',
    'proposal.create',
    'plugin-data.write',
    'workspace.navigate',
    'file.write-selected',
    'clipboard.write',
]);

interface ExecutablePluginConsentDialogProps {
    busy?: boolean;
    installed: readonly InstalledPluginDocument[];
    onApprove: (approval: ExecutableInstallApproval) => void;
    onCancel: () => void;
    review: ExecutablePackageReview;
}

const formatBytes = (bytes: number): string => (
    bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KiB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
);

export default function ExecutablePluginConsentDialog({
    busy = false,
    installed,
    onApprove,
    onCancel,
    review,
}: ExecutablePluginConsentDialogProps) {
    const change = useMemo(
        () => classifyExecutablePackageChange(review, installed),
        [installed, review],
    );
    const [granted, setGranted] = useState<PluginCapability[]>(
        () => review.requestedCapabilities.filter(capability => (
            capability === 'compute.isolated'
            || Boolean(
                change.current
                && AVAILABLE_EXECUTABLE_GRANTS.has(capability)
                && change.current.grantedCapabilities.includes(capability),
            )
        )),
    );
    const [acknowledged, setAcknowledged] = useState(false);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const newlyRequested = new Set(change.newlyRequestedCapabilities);
    const requiredInteractiveCapabilities = new Set(
        review.interactiveOperations.flatMap(binding => binding.requiredCapabilities),
    );
    const missingInteractiveGrant = [...requiredInteractiveCapabilities]
        .some(capability => !granted.includes(capability));
    const rejected = change.kind === 'rejected';
    const actionLabel = change.kind === 'update'
        ? 'Approve isolated update'
        : change.kind === 'reinstall'
            ? 'Approve reinstall'
            : 'Install isolated plugin';

    const setCapability = (capability: PluginCapability, checked: boolean) => {
        if (capability === 'compute.isolated') return;
        setGranted(current => checked
            ? [...current, capability]
            : current.filter(item => item !== capability));
    };

    const approve = () => {
        onApprove(createExecutableInstallApproval(review, granted, acknowledged));
    };

    return (
        <NemotoDialog
            aria-describedby="executable-plugin-consent-description"
            aria-labelledby="executable-plugin-consent-title"
            closeOnBackdrop={false}
            initialFocusRef={cancelRef}
            onClose={() => { if (!busy) onCancel(); }}
            panelClassName="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border-2 border-accent-warning/60 shadow-2xl shadow-black/40"
            rootClassName="z-[10160]"
        >
            <NemotoDialogHeader className="flex shrink-0 items-start justify-between gap-4 border-b border-accent-warning/40 bg-accent-warning/10 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent-warning/50 bg-accent-warning/15 text-accent-warning">
                        <ShieldAlert size={21} />
                    </div>
                    <div className="min-w-0">
                        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-accent-warning">
                            Executable plugin · explicit approval required
                        </div>
                        <h2 id="executable-plugin-consent-title" className="mt-0.5 text-base font-bold text-text-main">
                            {change.kind === 'update' ? `Review update for ${review.name}` : `Review ${review.name}`}
                        </h2>
                        <p id="executable-plugin-consent-description" className="mt-1 text-xs leading-relaxed text-text-muted">
                            This package contains WebAssembly code. If activated, Nemoto runs only declared, capability-gated commands in an isolated runtime. Results that request portfolio changes must still pass Core validation and your proposal review.
                        </p>
                    </div>
                </div>
                <NemotoButton aria-label="Cancel executable plugin review" disabled={busy} icon onClick={onCancel} size="sm" variant="ghost">
                    <X size={16} />
                </NemotoButton>
            </NemotoDialogHeader>

            <NemotoDialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <section className="rounded-lg border border-app-border bg-app-surface p-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-text-main">{review.name} <span className="font-normal text-text-muted">v{review.identity.pluginVersion}</span></div>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">{review.description}</p>
                            <p className="mt-2 font-mono text-[10px] text-text-faint">{review.identity.pluginId}</p>
                        </div>
                        <FileArchive size={20} className="shrink-0 text-text-faint" />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-app-border/60 pt-3 text-[10px] sm:grid-cols-4">
                        <div><dt className="text-text-faint">Publisher</dt><dd className="mt-0.5 truncate font-semibold text-text-main">{review.publisherName || 'Not declared'}</dd></div>
                        <div><dt className="text-text-faint">Package</dt><dd className="mt-0.5 font-semibold text-text-main">{formatBytes(review.compressedBytes)}</dd></div>
                        <div><dt className="text-text-faint">Content</dt><dd className="mt-0.5 font-semibold text-text-main">{review.contributionCount} contribution{review.contributionCount === 1 ? '' : 's'}</dd></div>
                        <div><dt className="text-text-faint">Module hash</dt><dd className="mt-0.5 font-mono font-semibold text-text-main">{review.moduleSha256.slice(0, 12)}…</dd></div>
                    </dl>
                </section>

                {change.current && (
                    <section className={`rounded-lg border p-3 text-xs ${rejected ? 'border-accent-danger/40 bg-accent-danger/5' : 'border-accent-warning/30 bg-accent-warning/5'}`}>
                        <div className={`font-bold ${rejected ? 'text-accent-danger' : 'text-text-main'}`}>
                            {change.kind === 'reinstall' ? 'Reinstalling the same identity' : 'Installed package change'}
                        </div>
                        <p className="mt-1 leading-relaxed text-text-muted">
                            Current v{change.current.manifest.version} / data {change.current.manifest.dataVersion} → reviewed v{review.identity.pluginVersion} / data {review.identity.dataVersion}.
                        </p>
                        {change.reason && <p role="alert" className="mt-2 font-semibold text-accent-danger">{change.reason}</p>}
                    </section>
                )}

                {review.interactiveOperations.length > 0 && (
                    <section className="rounded-lg border border-app-border bg-app-surface p-4">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Interactive operations</div>
                        <div className="mt-2 space-y-2">
                            {review.interactiveOperations.map(binding => (
                                <div key={binding.operation} className="rounded border border-app-border/70 px-3 py-2">
                                    <div className="font-mono text-[11px] font-semibold text-text-main">{binding.operation}</div>
                                    <div className="mt-0.5 truncate text-[10px] text-text-faint">{binding.viewId}</div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section>
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Requested capabilities</div>
                        {missingInteractiveGrant && (
                            <button
                                type="button"
                                className="text-[10px] font-semibold text-accent-primary hover:underline"
                                onClick={() => {
                                    setGranted(current => {
                                        const next = new Set(current);
                                        requiredInteractiveCapabilities.forEach(capability => {
                                            if (AVAILABLE_EXECUTABLE_GRANTS.has(capability)) {
                                                next.add(capability);
                                            }
                                        });
                                        return [...next];
                                    });
                                }}
                            >
                                Grant all required
                            </button>
                        )}
                    </div>
                    <div className="mt-2 space-y-2">
                        {review.requestedCapabilities.map(capability => {
                            const presentation = CAPABILITY_LABELS[capability];
                            const checked = granted.includes(capability);
                            const available = AVAILABLE_EXECUTABLE_GRANTS.has(capability);
                            return (
                                <label key={capability} className="flex cursor-pointer items-start gap-3 rounded-lg border border-app-border p-3">
                                    <input
                                        aria-label={`Grant ${capability}`}
                                        checked={checked}
                                        className="mt-0.5 h-4 w-4 accent-[var(--accent-primary)]"
                                        disabled={busy || capability === 'compute.isolated' || !available}
                                        onChange={event => setCapability(capability, event.target.checked)}
                                        type="checkbox"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2 text-xs font-bold text-text-main">
                                            {presentation?.title || capability}
                                            {(capability === 'compute.isolated' || requiredInteractiveCapabilities.has(capability)) && <span className="rounded bg-accent-warning/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent-warning">Required</span>}
                                            {!available && <span className="rounded bg-app-hover px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-faint">Not available</span>}
                                            {newlyRequested.has(capability) && change.current && <span className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-accent-primary">New access</span>}
                                        </span>
                                        <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">{presentation?.detail || 'This capability is enforced by the Core broker.'}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </section>

                <section className="rounded-lg border border-accent-warning/40 bg-accent-warning/10 p-4">
                    <div className="flex items-start gap-3">
                        <Cpu size={18} className="mt-0.5 shrink-0 text-accent-warning" />
                        <div>
                            <div className="text-xs font-bold text-text-main">What isolated means</div>
                            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                                The module has no filesystem, network, DOM, Tauri, environment, clock, or operating-system imports. It receives only a bounded Core-authored JSON message. Any Portfolio change must still return through Core validation and user review.
                            </p>
                        </div>
                    </div>
                </section>

                <label className={`flex items-start gap-3 rounded-lg border p-4 ${acknowledged ? 'border-accent-warning/60 bg-accent-warning/10' : 'border-app-border bg-app-surface'}`}>
                    <input
                        aria-label="Acknowledge isolated executable code risk"
                        checked={acknowledged}
                        className="mt-0.5 h-4 w-4 accent-[var(--accent-warning)]"
                        disabled={busy || rejected}
                        onChange={event => setAcknowledged(event.target.checked)}
                        type="checkbox"
                    />
                    <span>
                        <span className="flex items-center gap-2 text-xs font-bold text-text-main"><LockKeyhole size={14} className="text-accent-warning" /> I understand this package contains executable code</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">I approve the exact reviewed archive and the selected capabilities for {review.name} v{review.identity.pluginVersion}.</span>
                    </span>
                </label>
            </NemotoDialogBody>

            <NemotoDialogFooter className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-app-border px-5 py-4">
                <div className="min-w-0 space-y-0.5">
                    <p className="text-[10px] leading-relaxed text-text-faint">
                        Archive {review.archiveSha256.slice(0, 12)}… · changing the file invalidates this approval.
                    </p>
                    {missingInteractiveGrant && (
                        <p className="text-[10px] font-medium text-accent-warning">
                            Grant all required capabilities to enable interactive views.
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <NemotoButton ref={cancelRef} disabled={busy} onClick={onCancel}>Cancel</NemotoButton>
                    <NemotoButton disabled={busy || rejected || !acknowledged || missingInteractiveGrant} onClick={approve} variant="warning">
                        <ShieldAlert size={15} /> {actionLabel}
                    </NemotoButton>
                </div>
            </NemotoDialogFooter>
        </NemotoDialog>
    );
}
