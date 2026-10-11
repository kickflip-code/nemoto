import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isTauri } from '@tauri-apps/api/core';
import type { ThemeConfig } from '../types';
import { DEFAULT_AUTO_BACKUP_RETENTION } from '../lib/autoBackupRetention';
import type { JournalDock } from '../lib/journalDock';
import { getActiveTheme, setActiveTheme as setActiveThemeNative } from '../lib/tauri';
import {
    installTheme,
    loadThemeLibrary,
    migrateLegacyThemeLibrary,
    removeTheme,
    restoreThemeAndActivate,
} from '../theme/themeRepository';

export interface AutoBackupStatus {
    kind: 'saved' | 'backup-failed' | 'cleanup-failed';
    attemptedAt: string;
    path: string;
    message?: string;
}

interface SettingsState {
    // Backup Settings
    backupPath: string | null; // Null means default
    autoBackupInterval: number; // Minutes, 0 = off
    autoBackupRetention: number; // Number of snapshots to keep, 0 = unlimited
    lastBackupTime: string | null;
    autoBackupStatus: AutoBackupStatus | null;

    // General Preferences
    userName: string; // For collaboration / author tags
    theme: 'void' | 'soft' | 'hard'; // Active UI theme

    // Device-local AI connection. This is never written into a portfolio.
    localAiEndpoint: string;
    localAiModel: string;

    // Device-local diagnostic capture. The public UI is host-owned and confirmation-gated.
    developerModeEnabled: boolean;

    // Device-local workspace layout.
    journalDock: JournalDock;
    canvasGridVisible: boolean;
    canvasLinksVisible: boolean;
    journalPanelWidth: number;

    // Global Custom Themes
    customThemes: ThemeConfig[];
    activeThemeId: string | null;
    themesInitialized: boolean;
    themeLibraryErrors: Array<{ fileName: string; message: string }>;

    // Actions
    setBackupPath: (path: string) => void;
    setAutoBackupInterval: (minutes: number) => void;
    setAutoBackupRetention: (count: number) => void;
    setLastBackupTime: (isoDate: string) => void;
    setAutoBackupStatus: (status: AutoBackupStatus) => void;
    setUserName: (name: string) => void;
    setTheme: (theme: 'void' | 'soft' | 'hard') => void;
    setLocalAiEndpoint: (endpoint: string) => void;
    setLocalAiModel: (model: string) => void;
    setDeveloperModeEnabled: (enabled: boolean) => void;
    setJournalDock: (dock: JournalDock) => void;
    setCanvasGridVisible: (visible: boolean) => void;
    setCanvasLinksVisible: (visible: boolean) => void;
    setJournalPanelWidth: (width: number) => void;
    setCustomThemes: (themes: ThemeConfig[]) => void;
    setActiveThemeId: (id: string | null) => void;
    initializeThemeLibrary: () => Promise<void>;
    reloadThemeLibrary: () => Promise<void>;
    installCustomTheme: (theme: ThemeConfig) => Promise<void>;
    updateCustomTheme: (theme: ThemeConfig) => Promise<void>;
    restoreAndActivateCustomTheme: (theme: ThemeConfig, replace: boolean) => Promise<void>;
    deleteCustomTheme: (id: string) => Promise<void>;
    activateCustomTheme: (id: string | null) => Promise<void>;
}

let themeInitialization: Promise<void> | null = null;
const LEGACY_THEME_RECOVERY_KEY = 'axiom-theme-migration-recovery-v1';

const readLegacyThemeRecovery = (): ThemeConfig[] => {
    try {
        const value = JSON.parse(localStorage.getItem(LEGACY_THEME_RECOVERY_KEY) || '[]');
        return Array.isArray(value) ? value as ThemeConfig[] : [];
    } catch {
        return [];
    }
};

const writeLegacyThemeRecovery = (themes: ThemeConfig[]): void => {
    try {
        if (themes.length > 0) localStorage.setItem(LEGACY_THEME_RECOVERY_KEY, JSON.stringify(themes));
        else localStorage.removeItem(LEGACY_THEME_RECOVERY_KEY);
    } catch (error) {
        console.error('[ThemeStore] Could not preserve the legacy theme migration recovery copy:', error);
    }
};

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            backupPath: null,
            autoBackupInterval: 30, // Default 30 min
            autoBackupRetention: DEFAULT_AUTO_BACKUP_RETENTION,
            lastBackupTime: null,
            autoBackupStatus: null,
            userName: 'User',
            theme: 'soft',
            localAiEndpoint: 'http://127.0.0.1:11434/v1/chat/completions',
            localAiModel: '',
            developerModeEnabled: false,
            journalDock: 'bottom',
            canvasGridVisible: true,
            canvasLinksVisible: true,
            journalPanelWidth: 840,
            customThemes: [],
            activeThemeId: null,
            themesInitialized: false,
            themeLibraryErrors: [],

            setBackupPath: (path) => set({ backupPath: path }),
            setCanvasGridVisible: (canvasGridVisible) => set({ canvasGridVisible }),
            setCanvasLinksVisible: (canvasLinksVisible) => set({ canvasLinksVisible }),
            setAutoBackupInterval: (minutes) => set({ autoBackupInterval: minutes }),
            setAutoBackupRetention: (count) => set({ autoBackupRetention: count }),
            setLastBackupTime: (isoDate) => set({ lastBackupTime: isoDate }),
            setAutoBackupStatus: (autoBackupStatus) => set({ autoBackupStatus }),
            setUserName: (name) => set({ userName: name }),
            setTheme: (theme) => set({ theme }),
            setLocalAiEndpoint: (endpoint) => set({ localAiEndpoint: endpoint }),
            setLocalAiModel: (model) => set({ localAiModel: model }),
            setDeveloperModeEnabled: (enabled) => set({ developerModeEnabled: enabled }),
            setJournalDock: (journalDock) => set({ journalDock }),
            setJournalPanelWidth: (journalPanelWidth) => set({
                journalPanelWidth: Math.max(560, Math.min(journalPanelWidth, 1200)),
            }),
            setCustomThemes: (themes) => set({ customThemes: themes }),
            setActiveThemeId: (id) => set({ activeThemeId: id }),
            reloadThemeLibrary: async () => {
                const snapshot = await loadThemeLibrary();
                let activeThemeId: string | null = get().activeThemeId;
                let builtInTheme = get().theme;

                if (isTauri()) {
                    const persistedActiveTheme = await getActiveTheme();
                    if (persistedActiveTheme === 'void' || persistedActiveTheme === 'soft' || persistedActiveTheme === 'hard') {
                        builtInTheme = persistedActiveTheme;
                        activeThemeId = null;
                    } else if (snapshot.themes.some(theme => theme.id === persistedActiveTheme)) {
                        activeThemeId = persistedActiveTheme;
                    } else {
                        activeThemeId = null;
                        builtInTheme = 'void';
                        await setActiveThemeNative('void');
                    }
                }

                set({
                    customThemes: snapshot.themes,
                    activeThemeId,
                    theme: builtInTheme,
                    themesInitialized: true,
                    themeLibraryErrors: snapshot.errors,
                });
            },
            initializeThemeLibrary: async () => {
                if (get().themesInitialized) return;
                if (!themeInitialization) {
                    themeInitialization = (async () => {
                        const hydratedLegacyThemes = get().customThemes;
                        const legacyThemes = hydratedLegacyThemes.length > 0
                            ? hydratedLegacyThemes
                            : readLegacyThemeRecovery();
                        const legacyActiveThemeId = get().activeThemeId;
                        if (legacyThemes.length > 0) writeLegacyThemeRecovery(legacyThemes);
                        const migrationErrors = legacyThemes.length > 0
                            ? await migrateLegacyThemeLibrary(legacyThemes)
                            : [];
                        if (isTauri() && legacyActiveThemeId && legacyThemes.length > 0) {
                            const migratedLibrary = await loadThemeLibrary();
                            if (migratedLibrary.themes.some(theme => theme.id === legacyActiveThemeId)) {
                                await setActiveThemeNative(legacyActiveThemeId);
                            }
                        }
                        await get().reloadThemeLibrary();
                        if (migrationErrors.length === 0) writeLegacyThemeRecovery([]);
                        if (migrationErrors.length > 0) {
                            set(state => ({
                                themeLibraryErrors: [...state.themeLibraryErrors, ...migrationErrors],
                            }));
                        }
                    })().finally(() => {
                        themeInitialization = null;
                    });
                }
                await themeInitialization;
            },
            installCustomTheme: async (theme) => {
                await installTheme(theme, false);
                await get().reloadThemeLibrary();
            },
            updateCustomTheme: async (theme) => {
                await installTheme(theme, true);
                await get().reloadThemeLibrary();
            },
            restoreAndActivateCustomTheme: async (theme, replace) => {
                await restoreThemeAndActivate(theme, replace);
                await get().reloadThemeLibrary();
                if (!get().customThemes.some(candidate => candidate.id === theme.id)) {
                    throw new Error(`Restored theme ${theme.id} is not available after installation.`);
                }
                set({ activeThemeId: theme.id });
            },
            deleteCustomTheme: async (id) => {
                await removeTheme(id);
                await get().reloadThemeLibrary();
            },
            activateCustomTheme: async (id) => {
                if (id && !get().customThemes.some(theme => theme.id === id)) {
                    throw new Error(`Theme ${id} is not installed.`);
                }
                if (isTauri()) {
                    await setActiveThemeNative(id || get().theme);
                }
                set({ activeThemeId: id });
            },
        }),
        {
            name: 'axiom-settings', // Persist to localStorage
            partialize: (state) => ({
                backupPath: state.backupPath,
                autoBackupInterval: state.autoBackupInterval,
                autoBackupRetention: state.autoBackupRetention,
                lastBackupTime: state.lastBackupTime,
                canvasGridVisible: state.canvasGridVisible,
                canvasLinksVisible: state.canvasLinksVisible,
                autoBackupStatus: state.autoBackupStatus,
                userName: state.userName,
                theme: state.theme,
                localAiEndpoint: state.localAiEndpoint,
                localAiModel: state.localAiModel,
                developerModeEnabled: state.developerModeEnabled,
                journalDock: state.journalDock,
                journalPanelWidth: state.journalPanelWidth,
            }),
        }
    )
);
