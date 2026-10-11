import { describe, expect, it } from 'vitest';
import {
  ALL_THEME_VARIABLE_NAMES,
  THEME_VARIABLE_NAME_SET,
  type BuiltInThemeId,
  type ThemePresetId,
} from './themeContract';
import {
  BUILT_IN_THEME_MANIFESTS,
  BUILT_IN_THEME_PRESETS,
  getBuiltInThemeIdForPreset,
  getPresetTokens,
  getThemePresetIdForBuiltInTheme,
} from './presets';
import { applyThemeTokens, clearThemeTokens } from './themeRuntime';

const THEME_IDS: ThemePresetId[] = ['void', 'polar', 'brutalist'];

const relativeLuminance = (hex: string): number => {
  const channels = hex.slice(1).match(/.{2}/g)?.map(channel => parseInt(channel, 16) / 255) || [];
  const [red, green, blue] = channels.map(channel => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

describe('built-in theme contract', () => {
  it.each(THEME_IDS)('%s is a complete, standalone Axiom theme file', themeId => {
    const manifest = BUILT_IN_THEME_MANIFESTS[themeId];
    const tokenNames = Object.keys(manifest.tokens).sort();

    expect(manifest).toMatchObject({
      schema: 'axiom.theme',
      version: 2,
      themeVersion: '1.0.0',
      id: themeId,
      basePresetId: themeId,
    });
    expect(tokenNames).toEqual([...ALL_THEME_VARIABLE_NAMES].sort());
    expect(tokenNames.every(token => THEME_VARIABLE_NAME_SET.has(token))).toBe(true);
    expect(Object.values(manifest.tokens).every(value => value.trim().length > 0)).toBe(true);
  });

  it('keeps product preset ids and persisted runtime ids as an explicit round trip', () => {
    const pairs: Array<[ThemePresetId, BuiltInThemeId]> = [
      ['void', 'void'],
      ['polar', 'soft'],
      ['brutalist', 'hard'],
    ];

    pairs.forEach(([presetId, runtimeId]) => {
      expect(getBuiltInThemeIdForPreset(presetId)).toBe(runtimeId);
      expect(getThemePresetIdForBuiltInTheme(runtimeId)).toBe(presetId);
      expect(BUILT_IN_THEME_PRESETS[presetId].builtInThemeId).toBe(runtimeId);
    });
  });

  it('returns defensive copies of preset tokens', () => {
    const first = getPresetTokens('void');
    first['--color-app-bg'] = '#ffffff';

    expect(getPresetTokens('void')['--color-app-bg']).toBe('#050505');
  });

  it('keeps Brutalist semantic colors legible on its paper surface', () => {
    const tokens = getPresetTokens('brutalist');
    const surface = tokens['--color-app-surface'];
    const semanticAccents = [
      '--color-accent-primary',
      '--color-accent-success',
      '--color-accent-warning',
      '--color-accent-danger',
      '--color-accent-purple',
      '--color-accent-neutral',
    ];

    semanticAccents.forEach(token => {
      expect(contrastRatio(tokens[token], surface), token).toBeGreaterThanOrEqual(4.5);
    });

    expect(contrastRatio(tokens['--color-control-primary-text'], tokens['--color-control-primary-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--color-dock-button-active-text'], tokens['--color-dock-button-active-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens['--color-rail-button-active-text'], tokens['--color-rail-button-active-bg'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps Polar secondary text legible on its surfaces', () => {
    const tokens = getPresetTokens('polar');
    const backgrounds = [tokens['--color-app-surface'], tokens['--color-app-hover']];

    ['--color-text-muted', '--color-text-faint'].forEach(textToken => {
      backgrounds.forEach(background => {
        expect(contrastRatio(tokens[textToken], background), `${textToken} on ${background}`)
          .toBeGreaterThanOrEqual(4.5);
      });
    });
  });

  it('provides explicit white-palette contrast in every built-in theme', () => {
    expect(getPresetTokens('void')['--palette-white-text']).toBe('#e4e4e7');
    expect(getPresetTokens('polar')['--palette-white-text']).toBe('#44476A');
    expect(getPresetTokens('brutalist')['--palette-white-text']).toBe('#151515');
  });

  it.each(THEME_IDS)('%s provides the complete semantic Event palette', themeId => {
    expect(getPresetTokens(themeId)).toMatchObject({
      '--color-node-event-bg': expect.any(String),
      '--color-node-event-border': expect.any(String),
      '--color-node-event-text': expect.any(String),
      '--color-node-event-accent': expect.any(String),
    });
  });
});

describe('theme runtime', () => {
  it('applies a complete theme and removes stale contract properties', () => {
    const style = document.documentElement.style;
    style.setProperty('--color-app-bg', '#123456');
    style.setProperty('--color-app-sidebar', '#654321');

    applyThemeTokens(style, { '--color-app-bg': '#050505' });

    expect(style.getPropertyValue('--color-app-bg')).toBe('#050505');
    expect(style.getPropertyValue('--color-app-sidebar')).toBe('');

    clearThemeTokens(style);
    expect(style.getPropertyValue('--color-app-bg')).toBe('');
  });
});
