import type { PluginVersionTransitionReview } from '../../plugins/pluginVersionTransition';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, CheckCircle2, FileArchive, Loader2, Trash2 } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { toast } from 'sonner';
import {
    inspectExecutablePluginPackage,
    installExecutablePluginPackage,
} from '../../host/pluginExecutablePackages';
import type {
    ExecutableInstallApproval,
    ExecutablePackageReview,
} from '../../plugins/executablePackageConsent';
import { inspectPluginPackage } from '../../plugins/packageInspection';
import type { InstalledPluginDocument } from '../../plugins/installedPackages';
import { NemotoButton, NemotoSwitch, NemotoDialog } from '../ui';
import { satisfiesVersionRange } from '../../plugins/versionRange';
import { usePluginHostServices, usePluginHostSnapshot } from './PluginHostServicesContext';
import PluginDeviceStoragePanel from './PluginDeviceStoragePanel';
import ExecutablePluginConsentDialog from './ExecutablePluginConsentDialog';

const CAPABILITY_LABELS: Record<string, { title: string; detail: string }> = {
    'plugin-data.write': {
        title: 'Save plugin-owned data in this portfolio',
        detail: 'The plugin can use its own protected namespace. It cannot directly edit processes, resources, notes, or other plugins’ data.',
    },
    'portfolio.read-scoped': {
        title: 'Read bounded public Portfolio fields',
        detail: 'The plugin can use Core-owned search and redacted entity projections. It cannot receive the live Portfolio or sensitive fields.',
    },
    'plugin-device-settings.write': {
        title: 'Device-local settings',
        detail: 'Stores this plugin’s private settings on this device, outside shared Portfolio files.',
    },
    'plugin-secrets.use': {
        title: 'Protected secrets',
        detail: 'Reads and stores this plugin’s credentials in the operating system credential store.',
    },
    'workspace.navigate': {
        title: 'Open referenced items in the workspace',
        detail: 'The plugin can request that Nemoto reveal or inspect an existing process, step, connection, swimlane, resource, or journal entry. It cannot choose internal views or edit portfolio data.',
    },
};

export default function PluginManager() {
    const host = usePluginHostServices();
    const {
        installedPlugins: installed,
        pluginsInitialized: initialized,
        pluginLoadError: loadError,
        pluginRequirements: requirements,
    } = usePluginHostSnapshot();
    const [pending, setPending] = useState<InstalledPluginDocument | null>(null);
    const [pendingExecutable, setPendingExecutable] = useState<{
        path: string;
        review: ExecutablePackageReview;
    } | null>(null);
    const [versionReview, setVersionReview] = useState<PluginVersionTransitionReview | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const missingActiveRequirements = requirements.filter(requirement => (
        requirement.activation === 'active'
        && !installed.some(document => document.manifest.id === requirement.pluginId)
    ));
    const incompatibleActiveRequirements = requirements.flatMap(requirement => {
        if (requirement.activation !== 'active') return [];
        const document = installed.find(item => item.manifest.id === requirement.pluginId);
        if (!document) return [];
        return satisfiesVersionRange(document.manifest.version, requirement.version)
            && document.manifest.dataVersion === requirement.dataVersion
            ? []
            : [{ requirement, document }];
    });

    useEffect(() => {
        if (!initialized) void host.plugins.load();
    }, [host, initialized]);

    const isActive = (pluginId: string): boolean => (
        requirements.some(requirement => (
            requirement.pluginId === pluginId && requirement.activation === 'active'
            && installed.some(document => document.manifest.id === pluginId
                && satisfiesVersionRange(document.manifest.version, requirement.version)
                && document.manifest.dataVersion === requirement.dataVersion)
        ))
    );

    const handlePackage = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            toast.error('Plugin packages may be at most 10 MB.');
            return;
        }
        setBusy(true);
        try {
            setPending(await inspectPluginPackage(await file.arrayBuffer()));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The plugin package could not be inspected.');
        } finally {
            setBusy(false);
        }
    };

    const handleInspectPackage = async () => {
        if (!isTauri()) {
            fileInputRef.current?.click();
            return;
        }
        const selected = await open({
            multiple: false,
            filters: [{ name: 'Nemoto plugin package', extensions: ['axiom-plugin'] }],
        });
        if (typeof selected !== 'string') return;

        setBusy(true);
        try {
            const bytes = await readFile(selected);
            if (bytes.byteLength > 10 * 1024 * 1024) {
                throw new Error('Plugin packages may be at most 10 MB.');
            }
            try {
                setPending(await inspectPluginPackage(bytes));
            } catch (declarativeError) {
                try {
                    const review = await inspectExecutablePluginPackage(selected);
                    setPending(null);
                    setPendingExecutable({ path: selected, review });
                } catch {
                    throw declarativeError;
                }
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The plugin package could not be inspected.');
        } finally {
            setBusy(false);
        }
    };

    const handleInstall = async () => {
        if (!pending) return;
        setBusy(true);
        try {
            await host.plugins.install(pending);
            toast.success(`${pending.manifest.name} installed`);
            setPending(null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The plugin could not be installed.');
        } finally {
            setBusy(false);
        }
    };

    const handleExecutableInstall = async (approval: ExecutableInstallApproval) => {
        if (!pendingExecutable) return;
        setBusy(true);
        try {
            const result = await installExecutablePluginPackage(
                pendingExecutable.path,
                approval,
            );
            await host.plugins.load();
            toast.success(`${result.installedDocument.manifest.name} installed; activate it when you are ready to run its reviewed commands`);
            setPendingExecutable(null);
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : typeof error === 'object' && error !== null && 'message' in error
                    ? String(error.message)
                    : 'The executable plugin could not be installed.';
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    const setActive = (document: InstalledPluginDocument, active: boolean) => {
        try {
            const previous = requirements.find(item => item.pluginId === document.manifest.id);
            if (active && previous && !satisfiesVersionRange(document.manifest.version, previous.version)) {
                setVersionReview(host.plugins.reviewVersionChange(document.manifest.id));
                return;
            }
            host.plugins.setActive(document, active);
            toast.success(`${document.manifest.name} ${active ? 'activated' : 'deactivated'}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The plugin state could not be changed.');
        }
    };

    const handleUninstall = async (document: InstalledPluginDocument) => {
        setBusy(true);
        try {
            await host.plugins.uninstall(document);
            setConfirmUninstall(null);
            toast.success(`${document.manifest.name} uninstalled; its portfolio data was preserved`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'The plugin could not be uninstalled.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 id="settings-plugins-title" className="text-base font-bold text-text-main">Plugins</h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                        Inspect declarative or isolated .axiom-plugin packages from sources you trust. Executable modules run only through bounded Core-owned commands and cannot change Portfolio data without proposal review.
                    </p>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".axiom-plugin,application/zip"
                    className="sr-only"
                    aria-label="Choose Nemoto plugin package"
                    onChange={handlePackage}
                />
                <NemotoButton
                    size="sm"
                    disabled={busy}
                    onClick={() => { void handleInspectPackage(); }}
                    className="shrink-0"
                >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
                    Inspect package
                </NemotoButton>
            </div>

            {loadError && (
                <div role="status" className="flex items-start gap-2 rounded-lg border border-accent-warning/30 bg-accent-warning/5 p-3 text-xs text-accent-warning">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    {loadError}
                </div>
            )}

            {missingActiveRequirements.length > 0 && (
                <div role="status" className="rounded-lg border border-accent-warning/30 bg-accent-warning/5 p-3 text-xs text-accent-warning">
                    <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <div>
                            <div className="font-bold">This portfolio is missing an active plugin</div>
                            <p className="mt-1 leading-relaxed">
                                Its data is preserved, but its views stay unavailable until a compatible package is installed.
                            </p>
                            <ul className="mt-2 space-y-1 font-mono text-[10px]">
                                {missingActiveRequirements.map(requirement => (
                                    <li key={requirement.pluginId}>{requirement.pluginId} · {requirement.version}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {incompatibleActiveRequirements.length > 0 && (
                <div role="status" className="rounded-lg border border-accent-warning/30 bg-accent-warning/5 p-3 text-xs text-accent-warning">
                    <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <div>
                            <div className="font-bold">An installed plugin is incompatible with this portfolio</div>
                            <p className="mt-1 leading-relaxed">
                                Nemoto did not change its data. Activate the installed version to review a compatible version change, or install the expected version. Changed data formats require a migration.
                            </p>
                            <ul className="mt-2 space-y-1 font-mono text-[10px]">
                                {incompatibleActiveRequirements.map(({ requirement, document }) => (
                                    <li key={requirement.pluginId}>
                                        {requirement.pluginId} · expected {requirement.version} / data {requirement.dataVersion}; installed {document.manifest.version} / data {document.manifest.dataVersion}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {pending && (
                <section aria-label="Plugin permission review" className="nemoto-dialog-panel space-y-4 p-4">
                    <div className="flex items-start gap-3">
                        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-accent-success" />
                        <div>
                            <h4 className="text-sm font-bold text-text-main">
                                {pending.manifest.name} <span className="font-normal text-text-muted">v{pending.manifest.version}</span>
                            </h4>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">{pending.manifest.description}</p>
                            <p className="mt-2 font-mono text-[10px] text-text-faint">{pending.manifest.id}</p>
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-faint">Requested access</div>
                        {pending.manifest.capabilities.length === 0 ? (
                            <p className="mt-2 text-xs text-text-muted">No data or device access.</p>
                        ) : (
                            <ul className="mt-2 space-y-2">
                                {pending.manifest.capabilities.map(capability => {
                                    const label = CAPABILITY_LABELS[capability];
                                    return (
                                        <li key={capability} className="rounded-lg border border-app-border p-3">
                                            <div className="text-xs font-bold text-text-main">{label?.title || capability}</div>
                                            {label && <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{label.detail}</p>}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <NemotoButton size="sm" onClick={() => setPending(null)}>Cancel</NemotoButton>
                        <NemotoButton size="sm" variant="primary" disabled={busy} onClick={() => { void handleInstall(); }}>
                            Install and grant access
                        </NemotoButton>
                    </div>
                </section>
            )}

            {versionReview && (
                <NemotoDialog aria-labelledby="plugin-version-review-title" onClose={() => setVersionReview(null)} panelClassName="w-full max-w-lg space-y-3 p-5">
                    <h4 id="plugin-version-review-title" className="font-bold">Review plugin version change</h4>
                    <p>{versionReview.name}: {versionReview.fromVersion} → {versionReview.toVersion} · data {versionReview.dataVersion}</p>
                    <p>All {versionReview.recordCount} saved collection records match the installed package declarations. Their contents will be preserved. This changes the current portfolio requirement and activates the installed version using its existing grants. Save the portfolio to retain the change.</p>
                    <div className="flex gap-2">
                        <NemotoButton size="sm" onClick={() => setVersionReview(null)}>Cancel version change</NemotoButton>
                        <NemotoButton size="sm" variant="primary" onClick={() => {
                            try {
                                versionReview.approve();
                                setVersionReview(null);
                                toast.success('Plugin version changed; saved records were preserved');
                            } catch (error) {
                                setVersionReview(null);
                                toast.error(error instanceof Error ? error.message : 'Review the version change again.');
                            }
                        }}>Use version and activate</NemotoButton>
                    </div>
                </NemotoDialog>
            )}

            {!initialized ? (
                <div className="flex items-center gap-2 py-6 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" /> Loading installed plugins...
                </div>
            ) : installed.length === 0 ? (
                <div className="rounded-xl border border-dashed border-app-border px-6 py-10 text-center">
                    <FileArchive size={24} className="mx-auto text-text-faint" />
                    <div className="mt-3 text-sm font-bold text-text-main">No plugins installed</div>
                    <p className="mt-1 text-xs text-text-muted">Inspect a package to review its identity and access before installing it.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {installed.map(document => {
                        const active = isActive(document.manifest.id);
                        const executable = Boolean(document.manifest.runtime);
                        const confirming = confirmUninstall === document.manifest.id;
                        return (
                            <article key={document.manifest.id} className="nemoto-dialog-row p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <h4 className="text-sm font-bold text-text-main">
                                            {document.manifest.name} <span className="font-normal text-text-muted">v{document.manifest.version}</span>
                                        </h4>
                                        <p className="mt-1 text-xs leading-relaxed text-text-muted">{document.manifest.description}</p>
                                        <p className="mt-2 font-mono text-[10px] text-text-faint">{document.manifest.id}</p>
                                    </div>
                                    <NemotoSwitch
                                        checked={active}
                                        disabled={busy}
                                        label={`${active ? 'Deactivate' : 'Activate'} ${document.manifest.name}`}
                                        onCheckedChange={checked => setActive(document, checked)}
                                    />
                                </div>
                                {executable && (
                                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent-warning/30 bg-accent-warning/5 p-3 text-[11px] leading-relaxed text-text-muted">
                                        <AlertCircle size={14} className="mt-0.5 shrink-0 text-accent-warning" />
                                        <span><strong className="text-text-main">Verified isolated code is installed.</strong> When active, it can run only declared proposal commands with its reviewed grants; Core still validates and applies every accepted change.</span>
                                    </div>
                                )}
                                <div className="mt-3 flex items-center justify-between gap-3 border-t border-app-border/50 pt-3">
                                    <p className="text-[10px] leading-relaxed text-text-faint">
                                        Deactivation or uninstall never removes data saved in this portfolio.
                                    </p>
                                    {confirming ? (
                                        <div className="flex shrink-0 gap-2">
                                            <NemotoButton size="sm" onClick={() => setConfirmUninstall(null)}>Cancel</NemotoButton>
                                            <NemotoButton size="sm" variant="danger" disabled={busy} onClick={() => { void handleUninstall(document); }}>
                                                Confirm uninstall
                                            </NemotoButton>
                                        </div>
                                    ) : (
                                        <NemotoButton
                                            icon
                                            size="sm"
                                            title={`Uninstall ${document.manifest.name}`}
                                            aria-label={`Uninstall ${document.manifest.name}`}
                                            disabled={busy}
                                            onClick={() => setConfirmUninstall(document.manifest.id)}
                                        >
                                            <Trash2 size={14} />
                                        </NemotoButton>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {initialized && (
                <PluginDeviceStoragePanel installedPlugins={installed} />
            )}

            {pendingExecutable && (
                <ExecutablePluginConsentDialog
                    busy={busy}
                    installed={installed}
                    onApprove={approval => { void handleExecutableInstall(approval); }}
                    onCancel={() => { if (!busy) setPendingExecutable(null); }}
                    review={pendingExecutable.review}
                />
            )}
        </div>
    );
}
