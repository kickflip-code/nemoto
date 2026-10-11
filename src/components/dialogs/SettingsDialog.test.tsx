import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../context/ThemeContext';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useUIStore } from '../../stores/useUIStore';
import SettingsDialog from './SettingsDialog';
import { emptyPortfolio } from '../../stores/slices/coreSlice';
import { usePortfolioStore } from '../../stores/usePortfolioStore';
import { usePluginStore } from '../../stores/usePluginStore';
import { PluginHostServicesProvider } from '../plugins/PluginHostServicesContext';
import { pluginHostServices } from '../../host/pluginHostServices';
import {
    bindPluginDeveloperDiagnosticsSettings,
    pluginDeveloperDiagnostics,
} from '../../host/pluginDeveloperDiagnostics';
import { pluginDeveloperRuntimeReload } from '../../host/pluginDeveloperRuntimeReload';
import { pluginDeveloperSandbox } from '../../host/pluginDeveloperSandbox';
import { APP_VERSION } from '../../lib/appVersion';
import { createPortfolioEnvelope } from '../../lib/portfolioCodec';
import { createAppearanceBackup } from '../../theme/themeBackup';
import { createThemeConfig } from '../../theme/themeFiles';
import {
    clearBrowserThemeLibraryForTests,
    installTheme,
    loadThemeLibrary,
} from '../../theme/themeRepository';

const bundleExportMocks = vi.hoisted(() => ({
    save: vi.fn(),
    open: vi.fn(),
    writeTextFile: vi.fn(),
    readTextFile: vi.fn(),
}));

const backupServiceMocks = vi.hoisted(() => ({
    restoreBackup: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
    emit: vi.fn(),
    listen: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: bundleExportMocks.save,
    open: bundleExportMocks.open,
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeTextFile: bundleExportMocks.writeTextFile,
    readTextFile: bundleExportMocks.readTextFile,
}));
vi.mock('../../services/BackupService', () => ({
    BackupService: { restoreBackup: backupServiceMocks.restoreBackup },
}));
vi.mock('@tauri-apps/api/event', () => ({
    emit: eventMocks.emit,
    listen: eventMocks.listen,
}));

const renderSettings = () => render(
    <PluginHostServicesProvider services={pluginHostServices}>
        <ThemeProvider>
            <SettingsDialog />
        </ThemeProvider>
    </PluginHostServicesProvider>,
);

const defaultRestoreAndActivateCustomTheme = useSettingsStore.getState().restoreAndActivateCustomTheme;

describe('Settings dialog sections', () => {
    let unbindDeveloperDiagnostics: () => void;

    beforeAll(() => {
        unbindDeveloperDiagnostics = bindPluginDeveloperDiagnosticsSettings();
    });

    beforeEach(() => {
        pluginDeveloperSandbox.stop();
        bundleExportMocks.save.mockReset();
        bundleExportMocks.open.mockReset();
        bundleExportMocks.writeTextFile.mockReset();
        bundleExportMocks.readTextFile.mockReset();
        backupServiceMocks.restoreBackup.mockReset();
        backupServiceMocks.restoreBackup.mockResolvedValue({ migrated: false });
        eventMocks.emit.mockReset();
        eventMocks.emit.mockResolvedValue(undefined);
        eventMocks.listen.mockReset();
        clearBrowserThemeLibraryForTests();
        useUIStore.setState({ settingsOpen: true });
        useSettingsStore.setState({
            activeThemeId: null,
            autoBackupStatus: null,
            customThemes: [],
            localAiEndpoint: '',
            localAiModel: '',
            theme: 'hard',
            developerModeEnabled: false,
            restoreAndActivateCustomTheme: defaultRestoreAndActivateCustomTheme,
        });
        pluginDeveloperDiagnostics.clear();
        usePluginStore.setState({ installed: [], initialized: true, error: null });
        usePortfolioStore.setState({ portfolio: structuredClone(emptyPortfolio), isDirty: false });
    });

    afterEach(() => {
        pluginDeveloperSandbox.stop();
        useSettingsStore.getState().setDeveloperModeEnabled(false);
        useUIStore.setState({ settingsOpen: false });
    });

    it('reloads declarative registries and opens a visibly isolated disposable clone', async () => {
        const user = userEvent.setup();
        const beforePortfolio = JSON.stringify(usePortfolioStore.getState().portfolio);
        const beforeRevision = usePortfolioStore.getState().changeRevision;
        const beforeDirty = usePortfolioStore.getState().isDirty;
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Developer: Sanitized diagnostics' }));
        await user.click(screen.getByRole('switch', { name: 'Developer Mode diagnostic capture' }));
        await user.click(screen.getByRole('button', { name: 'Enable Developer Mode' }));
        await user.click(screen.getByRole('button', { name: 'Reload packages' }));
        await waitFor(() => expect(pluginDeveloperRuntimeReload.getSnapshot()).toMatchObject({
            status: 'succeeded',
            packageCount: 0,
        }));
        expect(screen.getByText(/Generation \d+ · 0 active · 0 views/)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Open sandbox clone' }));
        expect(screen.getByRole('heading', { name: 'Isolated plugin portfolio clone' })).toBeInTheDocument();
        expect(screen.getByText(/cannot be saved, merged, or applied/i)).toBeInTheDocument();
        expect(screen.getByText(/No Core-store or autosave path/i)).toBeInTheDocument();
        expect(pluginDeveloperSandbox.getSnapshot().active).toBe(true);
        expect(JSON.stringify(usePortfolioStore.getState().portfolio)).toBe(beforePortfolio);
        expect(usePortfolioStore.getState().changeRevision).toBe(beforeRevision);
        expect(usePortfolioStore.getState().isDirty).toBe(beforeDirty);

        await user.click(screen.getByRole('button', { name: 'Close sandbox' }));
        expect(screen.queryByRole('heading', { name: 'Isolated plugin portfolio clone' })).not.toBeInTheDocument();
        expect(pluginDeveloperSandbox.getSnapshot()).toEqual({ active: false });
        expect(JSON.stringify(usePortfolioStore.getState().portfolio)).toBe(beforePortfolio);
        expect(usePortfolioStore.getState().changeRevision).toBe(beforeRevision);
        expect(usePortfolioStore.getState().isDirty).toBe(beforeDirty);
    });

    afterAll(() => {
        unbindDeveloperDiagnostics();
    });

    it('shows one selectable settings section at a time', async () => {
        const user = userEvent.setup();
        renderSettings();

        expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
        const appearance = screen.getByRole('button', { name: 'Appearance: Theme and colors' });
        const localAi = screen.getByRole('button', { name: 'Local AI: Model connection' });
        const plugins = screen.getByRole('button', { name: 'Plugins: Install and activate' });
        const developer = screen.getByRole('button', { name: 'Developer: Sanitized diagnostics' });
        const dataBackup = screen.getByRole('button', { name: 'Data & Backup: Versions and recovery' });

        expect(appearance).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Attached model' })).not.toBeInTheDocument();

        await user.click(localAi);
        expect(localAi).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Local AI' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Attached model' })).toBeInTheDocument();
        expect(screen.queryByText('Theme Studio')).not.toBeInTheDocument();

        await user.click(plugins);
        expect(plugins).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Plugins' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Inspect package' })).toBeInTheDocument();

        await user.click(developer);
        expect(developer).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Developer Mode' })).toBeInTheDocument();
        expect(screen.getByText(/Developer Mode is off/)).toBeInTheDocument();

        await user.click(dataBackup);
        expect(dataBackup).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('heading', { name: 'Data & Backup' })).toBeInTheDocument();
        expect(screen.getByText('Nemoto version')).toBeInTheDocument();
        expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Auto-Backup Interval' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Retained Auto-Backups' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Attached model' })).not.toBeInTheDocument();
    });

    it.each(['backup-failed', 'cleanup-failed'] as const)('shows actionable scheduled backup status: %s', async kind => {
        const user = userEvent.setup();
        useSettingsStore.setState({ autoBackupInterval: 0, autoBackupStatus: {
            kind, path: 'C:/UnavailableBackups', attemptedAt: '2026-09-08T08:00:00Z', message: 'Access denied',
        } });
        renderSettings();
        await user.click(screen.getByRole('button', { name: 'Data & Backup: Versions and recovery' }));
        const title = screen.getByText(kind === 'backup-failed' ? 'Scheduled backup failed' : 'Backup saved; cleanup failed');
        expect(title.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByText('Access denied')).toBeVisible();
        expect(screen.getByText('Destination: C:/UnavailableBackups')).toBeVisible();
        expect(screen.getByText(/Scheduled backups are disabled/)).toBeVisible();
        act(() => useSettingsStore.getState().setAutoBackupStatus({
            kind: 'saved', path: 'C:/UnavailableBackups', attemptedAt: '2026-09-08T09:00:00Z',
        }));
        expect(screen.getByText('Latest scheduled backup saved')).toBeVisible();
        expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
    });

    it('keeps a long theme menu scrollable and focuses the active theme', async () => {
        const user = userEvent.setup();
        const themes = Array.from({ length: 12 }, (_, index) => (
            createThemeConfig(`Theme ${index}`, 'void', `org.example.theme-${index}`)
        ));
        const activeTheme = themes[themes.length - 1];
        useSettingsStore.setState({ customThemes: themes, activeThemeId: activeTheme.id });
        renderSettings();

        await user.click(screen.getByRole('button', { name: /Theme 11 \(Custom\)/ }));

        const menu = screen.getByRole('menu', { name: 'Available themes' });
        const activeItem = screen.getByRole('menuitemradio', { name: 'Theme 11 (Custom)' });
        expect(menu).toHaveClass('axiom-scroll-menu');
        expect(activeItem).toHaveFocus();
        expect(menu.querySelectorAll('.theme-color-swatch')).toHaveLength(30);
    });

    it('requires an explicit replacement choice for a conflicting backup theme', async () => {
        const user = userEvent.setup();
        const installedTheme = createThemeConfig('Local Brand', 'void', 'org.example.restore-brand');
        const backupTheme = createThemeConfig('Backup Brand', 'polar', installedTheme.id);
        const snapshot = {
            ...createPortfolioEnvelope(structuredClone(emptyPortfolio)),
            appearance: createAppearanceBackup({
                theme: 'void',
                activeThemeId: backupTheme.id,
                customThemes: [backupTheme],
            }),
        };
        bundleExportMocks.open.mockResolvedValue('C:\\backups\\portable.axiom');
        bundleExportMocks.readTextFile.mockResolvedValue(JSON.stringify(snapshot));
        useSettingsStore.setState({
            customThemes: [installedTheme],
            activeThemeId: null,
            themesInitialized: true,
        });
        await installTheme(installedTheme);
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Data & Backup: Versions and recovery' }));
        await user.click(screen.getByRole('button', { name: 'Restore...' }));

        expect(await screen.findByText(/already exists, but its local and backup contents differ/i)).toBeInTheDocument();
        const themeChoice = screen.getByRole('combobox', { name: 'Theme handling' });
        expect(themeChoice).toHaveValue('keep-installed');
        await user.selectOptions(themeChoice, 'replace-installed');
        expect(screen.getByText(/local theme file will be replaced/i)).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /^Restore$/ }));
        await waitFor(() => expect(backupServiceMocks.restoreBackup).toHaveBeenCalledWith(snapshot));
        await waitFor(() => expect(useSettingsStore.getState()).toMatchObject({
            activeThemeId: backupTheme.id,
            customThemes: [expect.objectContaining({ id: backupTheme.id, label: 'Backup Brand' })],
        }));
        expect(eventMocks.emit).toHaveBeenCalledWith('theme-library-changed', { sender: 'main' });
    });

    it('does not install the included theme when Portfolio persistence fails', async () => {
        const user = userEvent.setup();
        const backupTheme = createThemeConfig('Never Installed', 'polar', 'org.example.failed-portfolio');
        const snapshot = {
            ...createPortfolioEnvelope(structuredClone(emptyPortfolio)),
            appearance: createAppearanceBackup({
                theme: 'void',
                activeThemeId: backupTheme.id,
                customThemes: [backupTheme],
            }),
        };
        bundleExportMocks.open.mockResolvedValue('C:\\backups\\failed.axiom');
        bundleExportMocks.readTextFile.mockResolvedValue(JSON.stringify(snapshot));
        backupServiceMocks.restoreBackup.mockRejectedValueOnce(new Error('portfolio disk full'));
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Data & Backup: Versions and recovery' }));
        await user.click(screen.getByRole('button', { name: 'Restore...' }));
        await user.click(await screen.findByRole('button', { name: /^Restore$/ }));

        await waitFor(() => expect(backupServiceMocks.restoreBackup).toHaveBeenCalledWith(snapshot));
        expect((await loadThemeLibrary()).themes).toEqual([]);
        expect(useSettingsStore.getState().activeThemeId).toBeNull();
        expect(eventMocks.emit).not.toHaveBeenCalled();
    });

    it('keeps a successful Portfolio restore when optional theme application fails', async () => {
        const user = userEvent.setup();
        const backupTheme = createThemeConfig('Blocked Theme', 'void', 'org.example.blocked-theme');
        const snapshot = {
            ...createPortfolioEnvelope(structuredClone(emptyPortfolio)),
            appearance: createAppearanceBackup({
                theme: 'void',
                activeThemeId: backupTheme.id,
                customThemes: [backupTheme],
            }),
        };
        const order: string[] = [];
        backupServiceMocks.restoreBackup.mockImplementationOnce(async () => {
            order.push('portfolio');
            return { migrated: false };
        });
        const restoreTheme = vi.fn(async () => {
            order.push('appearance');
            throw new Error('config is read-only');
        });
        useSettingsStore.setState({ restoreAndActivateCustomTheme: restoreTheme });
        bundleExportMocks.open.mockResolvedValue('C:\\backups\\theme-fails.axiom');
        bundleExportMocks.readTextFile.mockResolvedValue(JSON.stringify(snapshot));
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Data & Backup: Versions and recovery' }));
        await user.click(screen.getByRole('button', { name: 'Restore...' }));
        await user.click(await screen.findByRole('button', { name: /^Restore$/ }));

        await waitFor(() => expect(restoreTheme).toHaveBeenCalledWith(backupTheme, false));
        expect(order).toEqual(['portfolio', 'appearance']);
        expect(backupServiceMocks.restoreBackup).toHaveBeenCalledWith(snapshot);
        expect(eventMocks.emit).not.toHaveBeenCalled();
        expect(useUIStore.getState().settingsOpen).toBe(false);
    });

    it('restores Portfolio data while skipping a future appearance snapshot', async () => {
        const user = userEvent.setup();
        const snapshot = {
            ...createPortfolioEnvelope(structuredClone(emptyPortfolio)),
            appearance: {
                schema: 'axiom.appearance',
                version: 99,
                activeTheme: { kind: 'built-in', presetId: 'void' },
            },
        };
        bundleExportMocks.open.mockResolvedValue('C:\\backups\\future-theme.axiom');
        bundleExportMocks.readTextFile.mockResolvedValue(JSON.stringify(snapshot));
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Data & Backup: Versions and recovery' }));
        await user.click(screen.getByRole('button', { name: 'Restore...' }));
        expect(await screen.findByText('Included appearance cannot be restored')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^Restore$/ }));

        await waitFor(() => expect(backupServiceMocks.restoreBackup).toHaveBeenCalledWith(snapshot));
        expect(useSettingsStore.getState()).toMatchObject({ theme: 'hard', activeThemeId: null });
        expect(eventMocks.emit).not.toHaveBeenCalled();
    });

    it('requires confirmation, shows sanitized diagnostics, and clears them on disable', async () => {
        const user = userEvent.setup();
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Developer: Sanitized diagnostics' }));
        const toggle = screen.getByRole('switch', { name: 'Developer Mode diagnostic capture' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');

        await user.click(toggle);
        expect(useSettingsStore.getState().developerModeEnabled).toBe(false);
        expect(screen.getByRole('heading', { name: 'Enable Developer Mode?' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(useSettingsStore.getState().developerModeEnabled).toBe(false);

        await user.click(toggle);
        await user.click(screen.getByRole('button', { name: 'Enable Developer Mode' }));
        expect(useSettingsStore.getState().developerModeEnabled).toBe(true);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('status')).toHaveTextContent('Developer Mode active');

        act(() => {
            pluginDeveloperDiagnostics.record({
                source: 'permission',
                severity: 'warning',
                code: 'permission.denied',
                pluginId: 'org.example.safe-metadata',
                context: {
                    capability: 'portfolio.read-scoped',
                    prompt: 'Confidential acquisition details',
                },
            });
        });

        expect(screen.getByText('permission.denied')).toBeInTheDocument();
        expect(screen.getByText('org.example.safe-metadata')).toBeInTheDocument();
        expect(screen.getByText('[REDACTED]')).toBeInTheDocument();
        expect(screen.queryByText('Confidential acquisition details')).not.toBeInTheDocument();

        await user.click(toggle);
        expect(useSettingsStore.getState().developerModeEnabled).toBe(false);
        expect(pluginDeveloperDiagnostics.getSnapshot().entries).toEqual([]);
        expect(screen.getByText(/Developer Mode is off/)).toBeInTheDocument();
    });

    it('previews one aliased support snapshot and exports those exact bytes only on request', async () => {
        const user = userEvent.setup();
        bundleExportMocks.save.mockResolvedValue('C:\\support\\axiom-diagnostics.json');
        bundleExportMocks.writeTextFile.mockResolvedValue(undefined);
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Developer: Sanitized diagnostics' }));
        await user.click(screen.getByRole('switch', { name: 'Developer Mode diagnostic capture' }));
        await user.click(screen.getByRole('button', { name: 'Enable Developer Mode' }));
        act(() => {
            pluginDeveloperDiagnostics.record({
                source: 'command',
                severity: 'info',
                code: 'command.succeeded',
                pluginId: 'org.example.private-plugin',
                contributionId: 'org.example.private-plugin/open',
                context: {
                    outcome: 'succeeded',
                    prompt: 'Confidential acquisition details',
                },
            });
        });

        await user.click(screen.getByRole('button', { name: 'Preview support bundle' }));
        const preview = screen.getByRole('textbox', { name: 'Exact support bundle JSON' });
        const previewJson = (preview as HTMLTextAreaElement).value;
        expect(screen.getByRole('heading', { name: 'Preview support bundle' })).toBeInTheDocument();
        expect(previewJson).toContain('"pluginId": "plugin-1"');
        expect(previewJson).toContain('"contributionId": "contribution-1"');
        expect(previewJson).not.toContain('org.example.private-plugin');
        expect(previewJson).not.toContain('Confidential acquisition details');
        expect(bundleExportMocks.save).not.toHaveBeenCalled();
        expect(bundleExportMocks.writeTextFile).not.toHaveBeenCalled();

        act(() => {
            pluginDeveloperDiagnostics.record({
                source: 'lifecycle',
                severity: 'info',
                code: 'lifecycle.later.succeeded',
            });
        });
        expect((preview as HTMLTextAreaElement).value).toBe(previewJson);
        expect(previewJson).not.toContain('lifecycle.later.succeeded');

        await user.click(screen.getByRole('button', { name: 'Export JSON…' }));
        await waitFor(() => expect(bundleExportMocks.writeTextFile).toHaveBeenCalledWith(
            'C:\\support\\axiom-diagnostics.json',
            previewJson,
        ));
    });

    it('explains a missing active plugin without discarding its portfolio data', async () => {
        usePortfolioStore.setState({
            portfolio: {
                ...structuredClone(emptyPortfolio),
                plugins: {
                    ...structuredClone(emptyPortfolio.plugins!),
                    requirements: [{
                        pluginId: 'org.example.missing',
                        version: '=1.0.0',
                        dataVersion: 1,
                        requirement: 'recommended',
                        activation: 'active',
                    }],
                },
                extensions: { 'org.example.missing': { preserved: true } },
            },
            isDirty: false,
        });
        const user = userEvent.setup();
        renderSettings();

        await user.click(screen.getByRole('button', { name: 'Plugins: Install and activate' }));
        expect(screen.getByText('This portfolio is missing an active plugin')).toBeInTheDocument();
        expect(screen.getByText(/org\.example\.missing/)).toBeInTheDocument();
        expect(screen.getByText(/data is preserved/i)).toBeInTheDocument();
    });
});
