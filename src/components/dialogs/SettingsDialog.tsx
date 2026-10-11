import { useEffect, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import {
    X,
    FolderOpen,
    Palette,
    ChevronDown,
    Check,
    RotateCcw,
    Bot,
    AlertCircle,
    CheckCircle2,
    Loader2,
    RefreshCw,
    HardDrive,
    Puzzle,
    Bug,
} from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useTheme, ThemeId } from '../../context/ThemeContext';
import { toast } from 'sonner';
import PromptModal from '../shared/PromptModal';
import ConfirmationModal from '../shared/ConfirmationModal';
import { BackupService } from '../../services/BackupService';
import { decodePortfolioValue } from '../../lib/portfolioCodec';
import { getBuiltInThemeIdForPreset, THEME_PRESET_OPTIONS } from '../../theme/presets';
import {
    applyThemeRestorePlan,
    getDefaultThemeRestoreChoice,
    inspectAppearanceBackup,
    type ThemeRestoreChoice,
    type ThemeRestorePlan,
} from '../../theme/themeBackup';
import { AxiomButton, AxiomDialog, AxiomInput, AxiomMenu, AxiomMenuItem, AxiomSelect } from '../ui';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { APP_VERSION } from '../../lib/appVersion';
import { CURRENT_PORTFOLIO_SCHEMA_VERSION } from '../../lib/import/migrate';
import { discoverLocalAiModels, type LocalAiModelOption } from '../../plugins/localAiAdapter';
import PluginManager from '../plugins/PluginManager';
import DeveloperDiagnosticsPanel from '../plugins/DeveloperDiagnosticsPanel';
import PortfolioRestoreDialog from './PortfolioRestoreDialog';

type LocalAiConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';
type SettingsSection = 'appearance' | 'local-ai' | 'plugins' | 'developer' | 'data-backup';

const SETTINGS_SECTIONS = [
    { id: 'appearance', label: 'Appearance', detail: 'Theme and colors', icon: Palette },
    { id: 'local-ai', label: 'Local AI', detail: 'Model connection', icon: Bot },
    { id: 'plugins', label: 'Plugins', detail: 'Install and activate', icon: Puzzle },
    { id: 'developer', label: 'Developer', detail: 'Sanitized diagnostics', icon: Bug },
    { id: 'data-backup', label: 'Data & Backup', detail: 'Versions and recovery', icon: HardDrive },
] as const satisfies ReadonlyArray<{
    id: SettingsSection;
    label: string;
    detail: string;
    icon: typeof Palette;
}>;

export default function SettingsDialog() {
    const { settingsOpen, closeSettings } = useUIStore();
    const {
        backupPath, setBackupPath,
        autoBackupInterval, setAutoBackupInterval,
        autoBackupRetention, setAutoBackupRetention,
        lastBackupTime,
        autoBackupStatus,
        customThemes, activeThemeId, activateCustomTheme,
        localAiEndpoint, setLocalAiEndpoint,
        localAiModel, setLocalAiModel,
        developerModeEnabled, setDeveloperModeEnabled,
    } = useSettingsStore();

    const { theme, setTheme } = useTheme();
    const [promptOpen, setPromptOpen] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const portfolioSchemaVersion = usePortfolioStore(state => state.portfolio.schemaVersion)
        ?? CURRENT_PORTFOLIO_SCHEMA_VERSION;
    const [pendingRestore, setPendingRestore] = useState<{
        name: string;
        snapshot: unknown;
        sourceSchemaVersion: number;
        sourceAppVersion?: string;
        sourceTimestamp?: string;
        themePlan: ThemeRestorePlan;
        themeChoice: ThemeRestoreChoice;
    } | null>(null);
    const [isRestoring, setIsRestoring] = useState(false);
    const [localAiModels, setLocalAiModels] = useState<LocalAiModelOption[]>([]);
    const [localAiConnectionStatus, setLocalAiConnectionStatus] = useState<LocalAiConnectionStatus>('idle');
    const [localAiConnectionMessage, setLocalAiConnectionMessage] = useState<string | null>(null);
    const [manualModelEntry, setManualModelEntry] = useState(false);
    const [localAiDiscoveryRun, setLocalAiDiscoveryRun] = useState(0);
    const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');
    const [developerModeConfirmationOpen, setDeveloperModeConfirmationOpen] = useState(false);

    useEffect(() => {
        if (!settingsOpen || !localAiEndpoint.trim()) {
            setLocalAiConnectionStatus('idle');
            setLocalAiConnectionMessage(null);
            setLocalAiModels([]);
            return undefined;
        }

        const controller = new AbortController();
        setLocalAiConnectionStatus('checking');
        setLocalAiConnectionMessage('Checking the local server and looking for models...');
        const timer = window.setTimeout(() => {
            void discoverLocalAiModels({
                endpoint: localAiEndpoint,
                signal: controller.signal,
            }).then(models => {
                if (controller.signal.aborted) return;
                const chatModels = models.filter(model => model.kind === 'chat');
                const hiddenEmbeddingModels = models.length - chatModels.length;
                setLocalAiModels(models);
                setLocalAiConnectionStatus('connected');
                if (chatModels.length > 0 && !useSettingsStore.getState().localAiModel.trim()) {
                    setLocalAiModel(chatModels[0].id);
                }
                const chatSummary = chatModels.length === 1
                    ? '1 chat model found.'
                    : `${chatModels.length} chat models found.`;
                const hiddenSummary = hiddenEmbeddingModels > 0
                    ? ` ${hiddenEmbeddingModels} embedding model${hiddenEmbeddingModels === 1 ? '' : 's'} hidden.`
                    : '';
                setLocalAiConnectionMessage(
                    chatModels.length > 0
                        ? `Connected. ${chatSummary}${hiddenSummary}`
                        : `Connected, but no chat model is available.${hiddenSummary} Load a chat model in the local provider.`,
                );
            }).catch(error => {
                if (controller.signal.aborted) return;
                setLocalAiModels([]);
                setLocalAiConnectionStatus('error');
                setLocalAiConnectionMessage(
                    error instanceof Error ? error.message : 'Nemoto could not check the local AI server.',
                );
            });
        }, 450);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [
        settingsOpen,
        localAiEndpoint,
        localAiDiscoveryRun,
        setLocalAiModel,
    ]);

    const handleOpenThemeStudio = async () => {
        try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
            const existing = await WebviewWindow.getByLabel('theme-studio');
            if (existing) {
                await existing.setDecorations(false).catch((error) => {
                    console.warn('Could not disable Theme Studio native titlebar:', error);
                });
                await existing.setFocus();
            } else {
                const webview = new WebviewWindow('theme-studio', {
                    url: 'index.html?view=theme-studio',
                    title: 'Nemoto Theme Studio',
                    width: 1280,
                    height: 800,
                    minWidth: 1000,
                    minHeight: 600,
                    decorations: false,
                });
                webview.once('tauri://created', function () {
                    webview.setDecorations(false).catch((error) => {
                        console.warn('Could not disable Theme Studio native titlebar:', error);
                    });
                    console.log('Theme Studio window created successfully!');
                });
                webview.once('tauri://error', function (e) {
                    console.error('Error creating Theme Studio window:', e);
                });
            }
            closeSettings();
        } catch (error) {
            console.error('Failed to open Theme Studio window:', error);
            toast.error('Could not open Theme Studio window.');
        }
    };

    // Select folder using native dialog
    const handleSelectFolder = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                defaultPath: backupPath || undefined,
            });

            if (selected && typeof selected === 'string') {
                setBackupPath(selected);
            }
        } catch (e) {
            console.warn('Native dialog failed, falling back to prompt', e);
            setPromptOpen(true);
        }
    };

    const handleSelectRestore = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const { readTextFile } = await import('@tauri-apps/plugin-fs');
            const selected = await open({
                multiple: false,
                filters: [{ name: 'Nemoto Portfolio', extensions: ['nemoto', 'axiom'] }],
            });
            if (!selected || typeof selected !== 'string') return;

            const content = await readTextFile(selected);
            const snapshot: unknown = JSON.parse(content);
            const decoded = decodePortfolioValue(snapshot);
            if (decoded.kind !== 'portfolio') {
                throw new Error('Process fragments must be imported and cannot replace the full portfolio.');
            }
            const themePlan = await inspectAppearanceBackup(
                snapshot,
                useSettingsStore.getState().customThemes,
            );
            setPendingRestore({
                name: selected.split(/[\\/]/).pop() || 'portfolio archive',
                snapshot,
                sourceSchemaVersion: decoded.sourceSchemaVersion,
                sourceAppVersion: decoded.sourceAppVersion,
                sourceTimestamp: decoded.sourceTimestamp,
                themePlan,
                themeChoice: getDefaultThemeRestoreChoice(themePlan),
            });
        } catch (error) {
            console.error('Could not prepare portfolio restore:', error);
            toast.error(error instanceof Error ? error.message : 'Could not read this portfolio archive.');
        }
    };

    const handleConfirmRestore = async () => {
        if (!pendingRestore || isRestoring) return;
        setIsRestoring(true);
        let portfolioRestored = false;
        try {
            const migration = await BackupService.restoreBackup(pendingRestore.snapshot);
            portfolioRestored = true;
            const themeOutcome = await applyThemeRestorePlan(
                pendingRestore.themePlan,
                pendingRestore.themeChoice,
                {
                    activateBuiltIn: async presetId => {
                        await setTheme(getBuiltInThemeIdForPreset(presetId));
                    },
                    restoreCustom: async (themeToInstall, replace) => {
                        await useSettingsStore.getState().restoreAndActivateCustomTheme(themeToInstall, replace);
                    },
                    activateCustom: async themeId => {
                        await useSettingsStore.getState().activateCustomTheme(themeId);
                    },
                },
            );
            if (themeOutcome.status === 'applied') {
                await emit('theme-library-changed', { sender: 'main' });
            }
            if (pendingRestore.themePlan.kind === 'invalid') {
                toast.warning(`Portfolio restored, but its appearance was skipped: ${pendingRestore.themePlan.message}`);
            } else {
                toast.success(migration.migrated
                    ? 'Portfolio and appearance restored; Portfolio data was migrated safely'
                    : themeOutcome.status === 'applied'
                        ? 'Portfolio and appearance restored successfully'
                        : 'Portfolio restored successfully; current appearance kept');
            }
            setPendingRestore(null);
            closeSettings();
        } catch (error) {
            if (portfolioRestored) {
                console.error('Portfolio restored, but appearance restore failed:', error);
                toast.warning(`Portfolio restored, but appearance restore failed: ${error instanceof Error ? error.message : 'Unknown error.'}`);
                setPendingRestore(null);
                closeSettings();
            } else {
                console.error('Portfolio restore failed:', error);
                toast.error(error instanceof Error ? error.message : 'Portfolio restore failed.');
            }
        } finally {
            setIsRestoring(false);
        }
    };

    // Unified theme management
    const builtInThemes = THEME_PRESET_OPTIONS.map(preset => ({
        id: preset.builtInThemeId,
        label: `${preset.label} (Built-in)`,
        colors: {
            bg: preset.tokens['--color-app-bg'],
            accent: preset.tokens['--color-accent-primary']
        }
    }));

    const allThemes = [
        ...builtInThemes,
        ...customThemes.map(t => ({
            id: t.id,
            label: `${t.label} (Custom)`,
            colors: {
                bg: (t.tokens || t.colors)['--color-app-bg'] || '#0d0d10',
                accent: (t.tokens || t.colors)['--color-accent-primary'] || '#F59E0B'
            }
        }))
    ];

    const currentActiveId = activeThemeId || theme;
    const activeThemeDetails = allThemes.find(t => t.id === currentActiveId);

    const handleSelectTheme = async (id: string) => {
        try {
            if (id === 'void' || id === 'soft' || id === 'hard') {
                await setTheme(id as ThemeId);
            } else {
                await activateCustomTheme(id);
            }
            // Notify every window to reload the Core-owned theme library/selection.
            await emit('theme-library-changed', { sender: 'main' });
        } catch (err) {
            console.error('Could not activate theme:', err);
            const message = err instanceof Error
                ? err.message
                : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
                    ? err.message
                    : 'Could not activate the theme.';
            toast.error(message);
        }
    };

    const selectSection = (section: SettingsSection) => {
        setDropdownOpen(false);
        setActiveSection(section);
    };

    return (
        <AxiomDialog
            aria-labelledby="settings-dialog-title"
            onClose={() => { if (!isRestoring) closeSettings(); }}
            closeOnBackdrop={!isRestoring}
            panelClassName="w-[880px] max-w-[calc(100vw-2rem)] h-[min(720px,calc(100vh-2rem))] overflow-hidden flex flex-col"
        >

                {/* Header */}
                <div className="axiom-dialog-header flex items-center justify-between px-6 py-4 border-b">
                    <h2 id="settings-dialog-title" className="text-lg font-bold text-text-main">Settings</h2>
                    <AxiomButton
                        aria-label="Close settings"
                        disabled={isRestoring}
                        icon
                        variant="ghost"
                        onClick={closeSettings}
                        className="text-text-muted hover:text-text-main"
                    >
                        <X size={20} />
                    </AxiomButton>
                </div>

                {/* Section navigation and content */}
                <div className="axiom-settings-layout min-h-0 flex flex-1">
                    <nav
                        aria-label="Settings sections"
                        className="axiom-settings-nav w-48 shrink-0 border-r border-app-border p-3"
                    >
                        <div className="px-2 pb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-text-faint">
                            Settings
                        </div>
                        <div className="space-y-1">
                            {SETTINGS_SECTIONS.map(section => {
                                const Icon = section.icon;
                                const active = activeSection === section.id;
                                return (
                                    <button
                                        key={section.id}
                                        aria-label={`${section.label}: ${section.detail}`}
                                        aria-current={active ? 'page' : undefined}
                                        className={`axiom-settings-nav-item ${active ? 'axiom-settings-nav-item-active' : ''}`}
                                        type="button"
                                        onClick={() => selectSection(section.id)}
                                    >
                                        <Icon size={16} className="axiom-settings-nav-icon shrink-0" />
                                        <span className="min-w-0 text-left">
                                            <span className="block text-xs font-semibold">{section.label}</span>
                                            <span className="axiom-settings-nav-detail mt-0.5 block text-[9px] text-text-faint">{section.detail}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </nav>

                    <main className="axiom-dialog-body min-w-0 flex-1 overflow-y-auto p-6 app-scroll">

                    {activeSection === 'appearance' && (
                    <section aria-labelledby="settings-appearance-title" className="space-y-5">
                        <div>
                            <h3 id="settings-appearance-title" className="text-base font-bold text-text-main">Appearance</h3>
                            <p className="mt-1 text-xs text-text-muted">Choose Nemoto's visual theme and manage custom palettes.</p>
                        </div>

                        {/* Unified custom dropdown */}
                        <div className="relative">
                            <AxiomButton
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                                aria-expanded={dropdownOpen}
                                aria-haspopup="menu"
                                className="w-full px-4 py-2.5 text-sm justify-between"
                            >
                                <div className="flex items-center gap-2.5">
                                    <div className="flex gap-0.5">
                                        <div className="theme-color-swatch h-3.5 w-3.5 rounded-full" style={{ backgroundColor: activeThemeDetails?.colors.bg }} />
                                        <div className="theme-color-swatch h-3.5 w-3.5 rounded-full" style={{ backgroundColor: activeThemeDetails?.colors.accent }} />
                                    </div>
                                    <span className="font-semibold">{activeThemeDetails?.label}</span>
                                </div>
                                <ChevronDown size={16} className="text-text-faint" />
                            </AxiomButton>

                            {dropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                                    <AxiomMenu
                                        aria-label="Available themes"
                                        className="settings-theme-menu axiom-scroll-menu absolute top-full left-0 right-0 mt-1 z-20 py-1"
                                        onClose={() => setDropdownOpen(false)}
                                        surface="file"
                                    >
                                        {allThemes.map(t => (
                                            <AxiomMenuItem
                                                aria-checked={currentActiveId === t.id}
                                                key={t.id}
                                                 onClick={() => {
                                                    handleSelectTheme(t.id);
                                                    setDropdownOpen(false);
                                                }}
                                                 role="menuitemradio"
                                                 autoFocus={currentActiveId === t.id}
                                                className={`w-full px-4 py-2.5 text-sm text-left flex items-center justify-between ${
                                                    currentActiveId === t.id ? 'axiom-dialog-row-selected font-bold text-text-main' : ''
                                                }`}
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <div className="flex gap-0.5">
                                                        <div className="theme-color-swatch h-3 w-3 rounded-full" style={{ backgroundColor: t.colors.bg }} />
                                                        <div className="theme-color-swatch h-3 w-3 rounded-full" style={{ backgroundColor: t.colors.accent }} />
                                                    </div>
                                                    <span>{t.label}</span>
                                                </div>
                                                {currentActiveId === t.id && (
                                                    <Check size={14} className="text-accent-primary" />
                                                )}
                                            </AxiomMenuItem>
                                        ))}
                                    </AxiomMenu>
                                </>
                            )}
                        </div>

                        {/* Theme Studio Button */}
                        <div className="axiom-dialog-row p-4 flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-bold text-text-main">Theme Studio</h4>
                                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                                    Create and share custom white-labeled color palettes.
                                </p>
                            </div>
                            <AxiomButton
                                onClick={handleOpenThemeStudio}
                                className="text-xs"
                            >
                                <Palette size={14} className="text-accent-primary" />
                                <span>Open Theme Studio</span>
                            </AxiomButton>
                        </div>
                    </section>
                    )}

                    {activeSection === 'local-ai' && (
                    <section aria-labelledby="settings-local-ai-title" className="space-y-5">
                        <div>
                            <h3 id="settings-local-ai-title" className="text-base font-bold text-text-main">Local AI</h3>
                            <p className="mt-1 text-xs text-text-muted">Connect a local, read-only model for Portfolio Chat.</p>
                        </div>
                        <div className="axiom-dialog-row p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent-primary/20 bg-accent-primary/10 text-accent-primary">
                                    <Bot size={17} />
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-text-main">Attached model</h4>
                                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                                        Nemoto sends only approved, read-only context to this loopback address. AI output cannot write directly to a portfolio.
                                    </p>
                                </div>
                            </div>
                            <div className="mt-4 grid gap-3">
                                <label className="grid gap-1.5 text-xs text-text-muted">
                                    Local endpoint
                                    <AxiomInput
                                        aria-label="Local AI endpoint"
                                        value={localAiEndpoint}
                                        onChange={(event) => {
                                            setLocalAiEndpoint(event.target.value);
                                            setManualModelEntry(false);
                                        }}
                                        placeholder="http://127.0.0.1:11434/v1/chat/completions"
                                        spellCheck={false}
                                    />
                                    <span className="text-[10px] text-text-faint">
                                        A server address or full OpenAI-compatible chat endpoint is accepted.
                                    </span>
                                </label>
                                <div className="flex flex-wrap items-center gap-2">
                                    <AxiomButton
                                        size="sm"
                                        onClick={() => setLocalAiDiscoveryRun(run => run + 1)}
                                        disabled={!localAiEndpoint.trim() || localAiConnectionStatus === 'checking'}
                                        className="text-xs"
                                    >
                                        {localAiConnectionStatus === 'checking'
                                            ? <Loader2 size={13} className="animate-spin" />
                                            : <RefreshCw size={13} />}
                                        <span>{localAiConnectionStatus === 'checking' ? 'Checking...' : 'Test & find models'}</span>
                                    </AxiomButton>
                                    <span className="text-[10px] text-text-faint">Nemoto checks the provider's local model list.</span>
                                </div>

                                {localAiConnectionMessage && (
                                    <div
                                        role="status"
                                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${localAiConnectionStatus === 'error'
                                            ? 'border-accent-danger/25 bg-accent-danger/5 text-accent-danger'
                                            : localAiConnectionStatus === 'connected'
                                                ? 'border-accent-success/25 bg-accent-success/5 text-accent-success'
                                                : 'border-border-subtle bg-app-surface/50 text-text-muted'}`}
                                    >
                                        {localAiConnectionStatus === 'error'
                                            ? <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                            : localAiConnectionStatus === 'connected'
                                                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                                                : <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />}
                                        <span>{localAiConnectionMessage}</span>
                                    </div>
                                )}

                                {localAiModels.some(model => model.kind === 'chat') && !manualModelEntry ? (
                                    <div className="grid gap-1.5 text-xs text-text-muted">
                                        <label htmlFor="local-ai-model-select">Model</label>
                                        <AxiomSelect
                                            id="local-ai-model-select"
                                            aria-label="Local AI model"
                                            value={localAiModel}
                                            onChange={(event) => setLocalAiModel(event.target.value)}
                                        >
                                            {!localAiModel && <option value="">Choose a model</option>}
                                            {localAiModel && !localAiModels.some(model => model.kind === 'chat' && model.id === localAiModel) && (
                                                <option value={localAiModel}>{localAiModel} (not reported by server)</option>
                                            )}
                                            {localAiModels.filter(model => model.kind === 'chat').map(model => (
                                                <option key={model.id} value={model.id}>{model.id}</option>
                                            ))}
                                        </AxiomSelect>
                                        <button
                                            type="button"
                                            className="w-fit text-[10px] text-accent-primary hover:underline"
                                            onClick={() => setManualModelEntry(true)}
                                        >
                                            Enter a model ID manually
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid gap-1.5 text-xs text-text-muted">
                                        <label htmlFor="local-ai-model-input">Model name</label>
                                        <AxiomInput
                                            id="local-ai-model-input"
                                            aria-label="Local AI model name"
                                            value={localAiModel}
                                            onChange={(event) => setLocalAiModel(event.target.value)}
                                            placeholder="Find models or enter an exact model ID"
                                            spellCheck={false}
                                        />
                                        {manualModelEntry && localAiModels.some(model => model.kind === 'chat') && (
                                            <button
                                                type="button"
                                                className="w-fit text-[10px] text-accent-primary hover:underline"
                                                onClick={() => setManualModelEntry(false)}
                                            >
                                                Choose from discovered models
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            <p className="mt-3 text-[10px] leading-relaxed text-text-faint">
                                Configuration stays on this device and is not included in .nemoto files or exports. Phase 4 supports local OpenAI-compatible chat endpoints.
                            </p>
                        </div>
                    </section>
                    )}

                    {activeSection === 'data-backup' && (
                    <section aria-labelledby="settings-data-backup-title" className="space-y-5">
                        <div>
                            <h3 id="settings-data-backup-title" className="text-base font-bold text-text-main">Data & Backup</h3>
                            <p className="mt-1 text-xs text-text-muted">Manage scheduled snapshots, retention, Portfolio recovery, and explicit active-theme transfer.</p>
                        </div>

                        <div className="axiom-dialog-panel grid grid-cols-2 gap-4 p-3">
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-text-faint">Nemoto version</div>
                                <div className="mt-1 text-sm text-text-main">{APP_VERSION}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wider text-text-faint">Portfolio data version</div>
                                <div className="mt-1 text-sm text-text-main">{portfolioSchemaVersion}</div>
                            </div>
                        </div>

                        {/* Backup Path */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm text-text-muted">Auto-Backup Location</label>
                                <span className="text-[10px] text-text-faint italic">Target directory for scheduled backups</span>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex-1 bg-app-input border border-app-border rounded-lg px-3 py-2 text-sm text-text-main font-mono truncate shadow-sm">
                                    {backupPath || "Default (Documents/NemotoBackups)"}
                                </div>
                                <AxiomButton
                                    aria-label="Choose backup directory"
                                    icon
                                    onClick={handleSelectFolder}
                                    title="Choose Directory"
                                >
                                    <FolderOpen size={16} />
                                </AxiomButton>
                            </div>
                        </div>

                        {/* Auto-Backup Interval */}
                        <div className="space-y-2">
                            <label htmlFor="auto-backup-interval" className="text-sm text-text-muted">Auto-Backup Interval</label>
                            <AxiomSelect
                                id="auto-backup-interval"
                                value={autoBackupInterval}
                                onChange={(e) => setAutoBackupInterval(Number(e.target.value))}
                                className="axiom-field w-full px-3 py-2 text-sm"
                            >
                                <option value={0}>Disabled</option>
                                <option value={15}>Every 15 minutes</option>
                                <option value={30}>Every 30 minutes</option>
                                <option value={60}>Every hour</option>
                                <option value={240}>Every 4 hours</option>
                            </AxiomSelect>
                            {lastBackupTime && (
                                <p className="text-[10px] text-text-faint">
                                    Last local backup: {new Date(lastBackupTime).toLocaleString()}
                                </p>
                            )}
                        </div>

                        {autoBackupStatus && (
                            <div role="status" aria-live="polite" className="axiom-dialog-panel space-y-1 p-3 text-xs">
                                <p className={`font-semibold ${autoBackupStatus.kind === 'saved' ? 'text-text-main' : 'text-accent-warning'}`}>
                                    {autoBackupStatus.kind === 'saved' ? 'Latest scheduled backup saved'
                                        : autoBackupStatus.kind === 'backup-failed' ? 'Scheduled backup failed'
                                            : 'Backup saved; cleanup failed'}
                                </p>
                                <p className="text-text-muted">Last attempt: {new Date(autoBackupStatus.attemptedAt).toLocaleString()}</p>
                                <p className="break-all text-text-muted">Destination: {autoBackupStatus.path}</p>
                                {autoBackupStatus.message && <p className="break-words text-text-main">{autoBackupStatus.message}</p>}
                                {autoBackupStatus.kind !== 'saved' && (
                                    <p className="text-text-muted">
                                        {autoBackupStatus.kind === 'backup-failed'
                                            ? 'Check that the destination is available, writable, and has free space. You can choose another backup directory or make a manual Portfolio export.'
                                            : 'The new backup is available. Check access to older automatic snapshots and free space in the destination.'}
                                    </p>
                                )}
                                <p className="text-text-muted">{autoBackupInterval > 0
                                    ? 'Nemoto will try again at the next scheduled interval.'
                                    : 'Scheduled backups are disabled. Enable an interval to resume automatic attempts.'}</p>
                            </div>
                        )}

                        {/* Auto-Backup Retention */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label htmlFor="auto-backup-retention" className="text-sm text-text-muted">Retained Auto-Backups</label>
                                <span className="text-[10px] text-text-faint italic">Oldest automatic snapshots are removed first</span>
                            </div>
                            <AxiomSelect
                                id="auto-backup-retention"
                                value={autoBackupRetention}
                                onChange={(e) => setAutoBackupRetention(Number(e.target.value))}
                                className="axiom-field w-full px-3 py-2 text-sm"
                            >
                                <option value={10}>Keep latest 10 backups</option>
                                <option value={25}>Keep latest 25 backups (recommended)</option>
                                <option value={50}>Keep latest 50 backups</option>
                                <option value={100}>Keep latest 100 backups</option>
                                <option value={0}>Unlimited</option>
                            </AxiomSelect>
                            <p className="text-[10px] text-text-faint leading-relaxed">
                                Only files created by scheduled backup are cleaned up. Manual portfolio exports are never removed.
                            </p>
                        </div>

                        <div className="flex items-center justify-between gap-4 border-t border-app-border/50 pt-4">
                            <div>
                                <div className="text-sm text-text-muted">Restore Portfolio</div>
                                <p className="text-[10px] text-text-faint mt-1">
                                    The Portfolio is validated first. Included active-theme snapshots are installed or activated only after an explicit review.
                                </p>
                            </div>
                            <AxiomButton
                                onClick={handleSelectRestore}
                                disabled={isRestoring}
                                className="text-xs shrink-0"
                            >
                                <RotateCcw size={14} />
                                Restore...
                            </AxiomButton>
                        </div>
                    </section>
                    )}

                    {activeSection === 'plugins' && (
                        <section aria-labelledby="settings-plugins-title">
                            <PluginManager />
                        </section>
                    )}

                    {activeSection === 'developer' && (
                        <DeveloperDiagnosticsPanel
                            enabled={developerModeEnabled}
                            onEnabledChange={enabled => {
                                if (enabled) {
                                    setDeveloperModeConfirmationOpen(true);
                                } else {
                                    setDeveloperModeEnabled(false);
                                }
                            }}
                        />
                    )}

                    </main>
                </div>

                {/* Footer */}
                <div className="axiom-dialog-footer px-6 py-4 border-t flex justify-end">
                    <AxiomButton
                        onClick={closeSettings}
                        className="text-sm font-medium"
                        disabled={isRestoring}
                    >
                        Done
                    </AxiomButton>
                </div>

            <PromptModal
                isOpen={promptOpen}
                onClose={() => setPromptOpen(false)}
                onConfirm={(path) => {
                    if (path) setBackupPath(path);
                }}
                title="Backup Location"
                message="Enter the full path to your backup folder."
                defaultValue={backupPath || "C:/Backups/Nemoto"}
                placeholder="C:/..."
            />

            <PortfolioRestoreDialog
                restore={pendingRestore}
                isRestoring={isRestoring}
                onClose={() => setPendingRestore(null)}
                onConfirm={() => { void handleConfirmRestore(); }}
                onThemeChoiceChange={themeChoice => setPendingRestore(current => (
                    current ? { ...current, themeChoice } : current
                ))}
            />
            <ConfirmationModal
                isOpen={developerModeConfirmationOpen}
                onClose={() => setDeveloperModeConfirmationOpen(false)}
                onConfirm={() => setDeveloperModeEnabled(true)}
                title="Enable Developer Mode?"
                message={'Developer Mode retains a bounded, sanitized plugin diagnostic log on this device. It does not enable third-party code, expose raw portfolio content, or bypass plugin permissions.\n\nA persistent indicator remains visible while capture is active. Turning Developer Mode off immediately clears retained entries.'}
                confirmLabel="Enable Developer Mode"
                variant="warning"
            />
        </AxiomDialog>
    );
}
