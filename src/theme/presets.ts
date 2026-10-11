import type { BuiltInThemeId, ThemePresetId, ThemeTokenMap } from './themeContract';
import voidThemeFile from './builtins/void.axiom-theme.json';
import polarThemeFile from './builtins/polar.axiom-theme.json';
import brutalistThemeFile from './builtins/brutalist.axiom-theme.json';

export interface ThemePreset {
  id: ThemePresetId;
  builtInThemeId: BuiltInThemeId;
  label: string;
  description: string;
  tokens: ThemeTokenMap;
}

export interface BuiltInThemeManifest {
  schema: 'axiom.theme';
  version: 2;
  id: ThemePresetId;
  themeVersion: string;
  label: string;
  basePresetId: ThemePresetId;
  tokens: ThemeTokenMap;
}

const asBuiltInThemeManifest = (value: unknown): BuiltInThemeManifest => (
  value as BuiltInThemeManifest
);

export const BUILT_IN_THEME_MANIFESTS: Record<ThemePresetId, BuiltInThemeManifest> = {
  void: asBuiltInThemeManifest(voidThemeFile),
  polar: asBuiltInThemeManifest(polarThemeFile),
  brutalist: asBuiltInThemeManifest(brutalistThemeFile),
};

const createThemePreset = (
  id: ThemePresetId,
  builtInThemeId: BuiltInThemeId,
  description: string,
): ThemePreset => {
  const manifest = BUILT_IN_THEME_MANIFESTS[id];

  return {
    id,
    builtInThemeId,
    label: manifest.label,
    description,
    tokens: { ...manifest.tokens },
  };
};

export const BUILT_IN_THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  void: createThemePreset('void', 'void', 'Dark, focused baseline.'),
  polar: createThemePreset('polar', 'soft', 'Light, soft baseline.'),
  brutalist: createThemePreset('brutalist', 'hard', 'Playful, high-contrast print-inspired baseline.'),
};

const PRESET_ID_BY_BUILT_IN_THEME: Record<BuiltInThemeId, ThemePresetId> = {
  void: 'void',
  soft: 'polar',
  hard: 'brutalist',
};

export const THEME_PRESET_OPTIONS = Object.values(BUILT_IN_THEME_PRESETS);

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = 'void';

export const getPresetTokens = (presetId: ThemePresetId | null | undefined): ThemeTokenMap => ({
  ...BUILT_IN_THEME_PRESETS[presetId || DEFAULT_THEME_PRESET_ID].tokens,
});

export const getBuiltInThemeIdForPreset = (
  presetId: ThemePresetId | null | undefined,
): BuiltInThemeId => BUILT_IN_THEME_PRESETS[presetId || DEFAULT_THEME_PRESET_ID].builtInThemeId;

export const getThemePresetIdForBuiltInTheme = (
  themeId: BuiltInThemeId | null | undefined,
): ThemePresetId => PRESET_ID_BY_BUILT_IN_THEME[themeId || 'void'];

export const isThemePresetId = (value: unknown): value is ThemePresetId => (
  value === 'void' || value === 'polar' || value === 'brutalist'
);
