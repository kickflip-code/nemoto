import type { ThemeConfig } from '../types';
import type { BuiltInThemeId, ThemePresetId } from './themeContract';
import { verifyThemeAssetLibrary } from './themeAssets';
import { parseThemeDocument, parseThemeFile, toThemeFile, type AxiomThemeFile } from './themeFiles';
import { getThemePresetIdForBuiltInTheme, isThemePresetId } from './presets';

export const APPEARANCE_BACKUP_SCHEMA = 'axiom.appearance';
export const APPEARANCE_BACKUP_VERSION = 1;

export interface AxiomAppearanceBackup {
  schema: typeof APPEARANCE_BACKUP_SCHEMA;
  version: typeof APPEARANCE_BACKUP_VERSION;
  activeTheme:
    | {
      kind: 'built-in';
      presetId: ThemePresetId;
    }
    | {
      kind: 'custom';
      id: string;
      document: AxiomThemeFile;
    };
}

export type ThemeRestorePlan =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'built-in'; presetId: ThemePresetId }
  | { kind: 'custom-install'; incomingTheme: ThemeConfig }
  | { kind: 'custom-match'; installedTheme: ThemeConfig }
  | {
    kind: 'custom-conflict';
    incomingTheme: ThemeConfig;
    installedTheme: ThemeConfig;
  };

export type ThemeRestoreChoice = 'apply' | 'keep-installed' | 'replace-installed' | 'skip';

export interface ThemeRestoreActions {
  activateBuiltIn: (presetId: ThemePresetId) => Promise<void>;
  restoreCustom: (theme: ThemeConfig, replace: boolean) => Promise<void>;
  activateCustom: (themeId: string) => Promise<void>;
}

export interface ThemeRestoreOutcome {
  status: 'applied' | 'skipped';
  message: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, canonicalizeJson(value[key])]),
  );
};

const themeDocumentsMatch = (left: ThemeConfig, right: ThemeConfig): boolean => (
  JSON.stringify(canonicalizeJson(toThemeFile(left)))
  === JSON.stringify(canonicalizeJson(toThemeFile(right)))
);

export const createAppearanceBackup = ({
  theme,
  activeThemeId,
  customThemes,
}: {
  theme: BuiltInThemeId;
  activeThemeId: string | null;
  customThemes: ThemeConfig[];
}): AxiomAppearanceBackup => {
  if (activeThemeId) {
    const activeTheme = customThemes.find(candidate => candidate.id === activeThemeId);
    if (!activeTheme) {
      throw new Error(`Active theme ${activeThemeId} is missing from the installed theme library.`);
    }
    const document = toThemeFile(activeTheme);
    return {
      schema: APPEARANCE_BACKUP_SCHEMA,
      version: APPEARANCE_BACKUP_VERSION,
      activeTheme: {
        kind: 'custom',
        id: document.id,
        document,
      },
    };
  }

  return {
    schema: APPEARANCE_BACKUP_SCHEMA,
    version: APPEARANCE_BACKUP_VERSION,
    activeTheme: {
      kind: 'built-in',
      presetId: getThemePresetIdForBuiltInTheme(theme),
    },
  };
};

export const inspectAppearanceBackup = async (
  envelope: unknown,
  installedThemes: ThemeConfig[],
): Promise<ThemeRestorePlan> => {
  if (!isPlainObject(envelope) || envelope.appearance === undefined) return { kind: 'none' };

  try {
    const snapshot = envelope.appearance;
    if (!isPlainObject(snapshot)) throw new Error('Appearance snapshot must be a JSON object.');
    if (snapshot.schema !== APPEARANCE_BACKUP_SCHEMA) {
      throw new Error(`Unsupported appearance snapshot schema: ${String(snapshot.schema)}.`);
    }
    if (snapshot.version !== APPEARANCE_BACKUP_VERSION) {
      throw new Error(`Unsupported appearance snapshot version: ${String(snapshot.version)}.`);
    }
    if (!isPlainObject(snapshot.activeTheme)) {
      throw new Error('Appearance snapshot has no active theme selection.');
    }

    if (snapshot.activeTheme.kind === 'built-in') {
      if (!isThemePresetId(snapshot.activeTheme.presetId)) {
        throw new Error(`Unknown built-in theme: ${String(snapshot.activeTheme.presetId)}.`);
      }
      return { kind: 'built-in', presetId: snapshot.activeTheme.presetId };
    }

    if (snapshot.activeTheme.kind !== 'custom') {
      throw new Error(`Unknown active theme kind: ${String(snapshot.activeTheme.kind)}.`);
    }
    const document = parseThemeDocument(snapshot.activeTheme.document);
    if (snapshot.activeTheme.id !== document.id) {
      throw new Error('Appearance snapshot theme ID does not match its embedded document.');
    }
    await verifyThemeAssetLibrary(document.assets);
    const incomingTheme = parseThemeFile(document);
    const installedTheme = installedThemes.find(candidate => candidate.id === incomingTheme.id);
    if (!installedTheme) return { kind: 'custom-install', incomingTheme };
    if (themeDocumentsMatch(installedTheme, incomingTheme)) {
      return { kind: 'custom-match', installedTheme };
    }
    return { kind: 'custom-conflict', incomingTheme, installedTheme };
  } catch (error) {
    return {
      kind: 'invalid',
      message: error instanceof Error ? error.message : 'Invalid appearance snapshot.',
    };
  }
};

export const getDefaultThemeRestoreChoice = (plan: ThemeRestorePlan): ThemeRestoreChoice => {
  if (plan.kind === 'built-in' || plan.kind === 'custom-install' || plan.kind === 'custom-match') {
    return 'apply';
  }
  if (plan.kind === 'custom-conflict') return 'keep-installed';
  return 'skip';
};

export const applyThemeRestorePlan = async (
  plan: ThemeRestorePlan,
  choice: ThemeRestoreChoice,
  actions: ThemeRestoreActions,
): Promise<ThemeRestoreOutcome> => {
  if (choice === 'skip' || plan.kind === 'none' || plan.kind === 'invalid') {
    return { status: 'skipped', message: 'Current appearance kept.' };
  }

  if (plan.kind === 'built-in') {
    if (choice !== 'apply') throw new Error('Invalid restore choice for a built-in theme.');
    await actions.activateBuiltIn(plan.presetId);
    return { status: 'applied', message: 'Included built-in theme activated.' };
  }

  if (plan.kind === 'custom-install') {
    if (choice !== 'apply') throw new Error('Invalid restore choice for a new custom theme.');
    await actions.restoreCustom(plan.incomingTheme, false);
    return { status: 'applied', message: 'Included custom theme installed and activated.' };
  }

  if (plan.kind === 'custom-match') {
    if (choice !== 'apply') throw new Error('Invalid restore choice for an installed custom theme.');
    await actions.activateCustom(plan.installedTheme.id);
    return { status: 'applied', message: 'Matching installed theme activated.' };
  }

  if (choice === 'keep-installed') {
    await actions.activateCustom(plan.installedTheme.id);
    return { status: 'applied', message: 'Installed theme kept and activated.' };
  }
  if (choice === 'replace-installed') {
    await actions.restoreCustom(plan.incomingTheme, true);
    return { status: 'applied', message: 'Installed theme replaced with the backup copy and activated.' };
  }
  throw new Error('A conflicting theme requires an explicit restore choice.');
};
