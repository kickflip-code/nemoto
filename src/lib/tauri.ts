import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, NemotoProject, Asset, Portfolio } from '../types';
import type { InstalledPluginDocument } from '../plugins/installedPackages';

// --- CONFIG ---

export async function getConfig(): Promise<AppConfig> {
    return await invoke<AppConfig>('get_config');
}

export async function setConfig(config: AppConfig): Promise<void> {
    return await invoke('set_config', { config });
}

export async function getActiveTheme(): Promise<string> {
    return await invoke<string>('get_active_theme');
}

export async function setActiveTheme(theme: string): Promise<void> {
    return await invoke('set_active_theme', { theme });
}

export interface NativeThemeLibraryError {
    fileName: string;
    message: string;
}

export interface NativeThemeLibrarySnapshot {
    documents: Array<{ fileName: string; document: unknown }>;
    errors: NativeThemeLibraryError[];
}

export async function listInstalledThemes(): Promise<NativeThemeLibrarySnapshot> {
    return await invoke<NativeThemeLibrarySnapshot>('list_installed_themes');
}

export async function installThemeDocument(document: unknown, replace = false): Promise<void> {
    return await invoke('install_theme', { document, replace });
}

export async function restoreThemeDocumentAndActivate(document: unknown, replace = false): Promise<void> {
    return await invoke('restore_theme_and_activate', { document, replace });
}

export async function deleteInstalledTheme(themeId: string): Promise<void> {
    return await invoke('delete_installed_theme', { themeId });
}

// --- LEGACY FILE COMMANDS (backwards compatibility) ---

export async function loadProject(path: string): Promise<NemotoProject> {
    return await invoke<NemotoProject>('load_project', { path });
}

export async function saveProject(path: string, project: NemotoProject): Promise<void> {
    return await invoke('save_project', { path, project });
}

export async function writeNemotoFileAtomic(
    path: string,
    content: string,
    createBackup: boolean = true,
): Promise<void> {
    return await invoke('write_axiom_file_atomic', { path, content, createBackup });
}

// --- LIBRARY ---

export async function loadLibrary(): Promise<Asset[]> {
    return await invoke<Asset[]>('load_library');
}

export async function saveLibrary(assets: Asset[]): Promise<void> {
    return await invoke('save_library', { assets });
}

// --- PORTFOLIO ---

export async function loadPortfolio(): Promise<Portfolio> {
    return await invoke<Portfolio>('load_portfolio');
}

export async function savePortfolio(portfolio: Portfolio): Promise<void> {
    return await invoke('save_portfolio', { portfolio });
}

/** Read-only inspection of rejected data; never hydrate this into the workspace. */
export interface PortfolioRepairSnapshot {
    revision: string;
    portfolio: unknown;
}

export async function loadPortfolioForRepair(): Promise<PortfolioRepairSnapshot> {
    return await invoke<PortfolioRepairSnapshot>('load_portfolio_for_repair');
}

export async function repairPortfolioProcesses(expectedRevision: string, removedIndexes: number[]): Promise<string> {
    return await invoke<string>('repair_portfolio_processes', { expectedRevision, removedIndexes });
}

export async function hasPortfolioBackup(): Promise<boolean> {
    return await invoke<boolean>('has_portfolio_backup');
}

export async function loadPortfolioBackup(): Promise<unknown> {
    return await invoke<unknown>('load_portfolio_backup');
}

export async function restorePortfolioBackup(expectedPortfolio: unknown): Promise<Portfolio> {
    return await invoke<Portfolio>('restore_portfolio_backup', { expectedPortfolio });
}

export async function listTempPortfolios(): Promise<string[]> {
    return await invoke<string[]>('list_temp_portfolios');
}

export async function loadTempPortfolio(name: string): Promise<Portfolio> {
    return await invoke<Portfolio>('load_temp_portfolio', { name });
}

export async function saveTempPortfolio(name: string, portfolio: Portfolio): Promise<void> {
    return await invoke('save_temp_portfolio', { name, portfolio });
}

export async function deleteTempPortfolio(name: string): Promise<void> {
    return await invoke('delete_temp_portfolio', { name });
}

// --- DECLARATIVE PLUGINS ---

export async function listInstalledPluginDocuments(): Promise<unknown[]> {
    return await invoke<unknown[]>('list_installed_plugins');
}

export async function installPluginDocument(document: InstalledPluginDocument): Promise<void> {
    return await invoke('install_plugin', { document });
}

export async function uninstallPluginDocument(pluginId: string): Promise<void> {
    return await invoke('uninstall_plugin', { pluginId });
}

export async function readPluginDeviceSettingsState(pluginId: string): Promise<unknown> {
    return await invoke<unknown>('read_plugin_device_settings_state', { pluginId });
}

export async function transactPluginDeviceSettingsNative(
    pluginId: string,
    transaction: unknown,
): Promise<unknown> {
    return await invoke<unknown>('transact_plugin_device_settings', { pluginId, transaction });
}

export async function readPluginSecretIndex(pluginId: string): Promise<unknown> {
    return await invoke<unknown>('read_plugin_secret_index', { pluginId });
}

export async function getPluginDeviceSecretNative(
    pluginId: string,
    key: string,
): Promise<unknown> {
    return await invoke<unknown>('get_plugin_device_secret', { pluginId, key });
}

export async function setPluginDeviceSecretNative(
    pluginId: string,
    input: unknown,
): Promise<unknown> {
    return await invoke<unknown>('set_plugin_device_secret', { pluginId, input });
}

export async function deletePluginDeviceSecretNative(
    pluginId: string,
    input: unknown,
): Promise<unknown> {
    return await invoke<unknown>('delete_plugin_device_secret', { pluginId, input });
}

export async function listPluginDeviceStorageNative(): Promise<unknown> {
    return await invoke<unknown>('list_plugin_device_storage');
}

export async function clearPluginDeviceStorageNative(pluginId: string): Promise<unknown> {
    return await invoke<unknown>('clear_plugin_device_storage', { pluginId });
}


