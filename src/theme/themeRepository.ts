import { isTauri } from '@tauri-apps/api/core';
import type { ThemeConfig } from '../types';
import {
  deleteInstalledTheme,
  installThemeDocument,
  listInstalledThemes,
  restoreThemeDocumentAndActivate,
  type NativeThemeLibraryError,
} from '../lib/tauri';
import { parseThemeFile, toThemeFile } from './themeFiles';
import { verifyThemeAssetLibrary } from './themeAssets';

const BROWSER_THEME_LIBRARY_KEY = 'axiom-theme-library-v2';
const RESERVED_THEME_IDS = new Set(['void', 'soft', 'hard', 'polar', 'brutalist']);

export interface ThemeLibrarySnapshot {
  themes: ThemeConfig[];
  errors: NativeThemeLibraryError[];
}

const readBrowserDocuments = (): unknown[] => {
  try {
    const value = JSON.parse(localStorage.getItem(BROWSER_THEME_LIBRARY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const writeBrowserDocuments = (documents: unknown[]): void => {
  localStorage.setItem(BROWSER_THEME_LIBRARY_KEY, JSON.stringify(documents));
};

const projectDocuments = async (
  documents: Array<{ fileName: string; document: unknown }>,
  initialErrors: NativeThemeLibraryError[] = [],
): Promise<ThemeLibrarySnapshot> => {
  const themes: ThemeConfig[] = [];
  const errors = [...initialErrors];
  const seenIds = new Set<string>();

  for (const { fileName, document } of documents) {
    try {
      const theme = parseThemeFile(document);
      await verifyThemeAssetLibrary(theme.assets);
      if (seenIds.has(theme.id)) throw new Error(`Duplicate theme id ${theme.id}.`);
      seenIds.add(theme.id);
      themes.push(theme);
    } catch (error) {
      errors.push({
        fileName,
        message: error instanceof Error ? error.message : 'Invalid theme document.',
      });
    }
  }

  return { themes, errors };
};

export const loadThemeLibrary = async (): Promise<ThemeLibrarySnapshot> => {
  if (!isTauri()) {
    return projectDocuments(readBrowserDocuments().map((document, index) => ({
      fileName: `browser-theme-${index + 1}.axiom-theme.json`,
      document,
    })));
  }
  const snapshot = await listInstalledThemes();
  return projectDocuments(snapshot.documents, snapshot.errors);
};

export const installTheme = async (theme: ThemeConfig, replace = false): Promise<void> => {
  if (RESERVED_THEME_IDS.has(theme.id)) {
    throw new Error(`Theme id ${theme.id} is reserved by a built-in theme.`);
  }
  const document = toThemeFile(theme);
  await verifyThemeAssetLibrary(document.assets);
  if (isTauri()) {
    await installThemeDocument(document, replace);
    return;
  }

  const documents = readBrowserDocuments();
  const existingIndex = documents.findIndex(candidate => {
    try {
      return parseThemeFile(candidate).id === theme.id;
    } catch {
      return false;
    }
  });
  if (existingIndex >= 0 && !replace) throw new Error(`A theme with id ${theme.id} is already installed.`);
  if (existingIndex >= 0) documents[existingIndex] = document;
  else documents.push(document);
  writeBrowserDocuments(documents);
};

export const restoreThemeAndActivate = async (theme: ThemeConfig, replace = false): Promise<void> => {
  const document = toThemeFile(theme);
  await verifyThemeAssetLibrary(document.assets);
  if (isTauri()) {
    await restoreThemeDocumentAndActivate(document, replace);
    return;
  }
  await installTheme(theme, replace);
};

export const removeTheme = async (themeId: string): Promise<void> => {
  if (isTauri()) {
    await deleteInstalledTheme(themeId);
    return;
  }
  const documents = readBrowserDocuments().filter(candidate => {
    try {
      return parseThemeFile(candidate).id !== themeId;
    } catch {
      return true;
    }
  });
  writeBrowserDocuments(documents);
};

export const migrateLegacyThemeLibrary = async (
  legacyThemes: ThemeConfig[],
): Promise<NativeThemeLibraryError[]> => {
  const current = await loadThemeLibrary();
  const installedIds = new Set(current.themes.map(theme => theme.id));
  const errors: NativeThemeLibraryError[] = [];

  for (const legacyTheme of legacyThemes) {
    if (installedIds.has(legacyTheme.id)) continue;
    try {
      if (legacyTheme.tokens) {
        const colorKeys = Object.keys(legacyTheme.colors);
        const tokenKeys = Object.keys(legacyTheme.tokens);
        const aliasesMatch = colorKeys.length === tokenKeys.length
          && colorKeys.every(name => legacyTheme.colors[name] === legacyTheme.tokens?.[name]);
        if (!aliasesMatch) {
          throw new Error('Legacy settings contain conflicting tokens and colors objects.');
        }
      }
      await installTheme(parseThemeFile(toThemeFile(legacyTheme)));
      installedIds.add(legacyTheme.id);
    } catch (error) {
      errors.push({
        fileName: legacyTheme.label || legacyTheme.id,
        message: error instanceof Error ? error.message : 'Could not migrate legacy theme.',
      });
    }
  }
  return errors;
};

export const clearBrowserThemeLibraryForTests = (): void => {
  if (!isTauri()) localStorage.removeItem(BROWSER_THEME_LIBRARY_KEY);
};
