import { describe, expect, it } from 'vitest';
import type { ThemeConfig } from '../types';
import { ALL_THEME_VARIABLE_NAMES } from './themeContract';
import { getPresetTokens } from './presets';
import {
  LEGACY_THEME_FILE_VERSION,
  THEME_FILE_SCHEMA,
  THEME_FILE_VERSION,
  createImportedThemeConfig,
  getThemeConfigTokens,
  parseThemeDocument,
  parseThemeFile,
  toThemeFile,
} from './themeFiles';

const customTheme: ThemeConfig = {
  id: 'theme-shared-example',
  label: 'Shared Example',
  basePresetId: 'polar',
  colors: {
    '--color-app-bg': '#ddeeff',
    '--color-accent-primary': '#123456',
  },
};

const completeV2Theme = () => ({
  schema: THEME_FILE_SCHEMA,
  version: THEME_FILE_VERSION,
  id: 'org.example.shared-theme',
  themeVersion: '2.4.1',
  label: 'Shared Theme',
  description: 'A portable test theme.',
  basePresetId: 'void',
  tokens: {
    ...getPresetTokens('void'),
    '--future-surface-token': ' #112233 ',
  },
  brand: {
    displayName: 'Example Corp',
    logoAssetId: 'brand-logo',
    futureBrandField: { alignment: 'start' },
  },
  typography: {
    fontFamily: 'Example Sans',
    regularAssetId: 'brand-font',
  },
  assets: {
    'brand-logo': {
      mediaType: 'image/png',
      data: 'AQ==',
      sha256: '0'.repeat(64),
    },
    'brand-font': {
      mediaType: 'font/woff2',
      data: 'Ag==',
      sha256: '1'.repeat(64),
    },
  },
  recipes: {
    density: 'compact',
    cornerStyle: 'soft',
    elevation: 'raised',
    controlStyle: 'outlined',
    surfaceStyle: 'layered',
    nodeStyle: 'raised',
    button: { treatment: 'solid', futureProperty: true },
  },
  extensions: {
    'org.example.audit': { source: 'plugin', score: 9 },
  },
  futureRootField: {
    kept: ['across', 'edits'],
  },
});

describe('shareable theme files', () => {
  it('exports one complete v2 token source without the ambiguous colors alias', () => {
    const file = toThemeFile(customTheme);

    expect(file).toMatchObject({
      schema: THEME_FILE_SCHEMA,
      version: THEME_FILE_VERSION,
      id: customTheme.id,
      themeVersion: '1.0.0',
      basePresetId: 'polar',
    });
    expect(file.tokens['--color-app-bg']).toBe('#ddeeff');
    expect(file.tokens['--color-accent-primary']).toBe('#123456');
    expect(Object.keys(file.tokens).sort()).toEqual([...ALL_THEME_VARIABLE_NAMES].sort());
    expect(file).not.toHaveProperty('colors');
  });

  it('preserves unknown root, nested, extension, asset, recipe and token fields through a UI edit', () => {
    const original = completeV2Theme();
    const projected = parseThemeFile(original);
    const edited: ThemeConfig = {
      ...projected,
      label: 'Edited in Theme Studio',
      colors: {
        ...projected.colors,
        '--color-app-bg': '#abcdef',
      },
      tokens: {
        ...projected.tokens,
        '--color-app-bg': '#abcdef',
      },
    };
    const exported = toThemeFile(edited);

    expect(exported.label).toBe('Edited in Theme Studio');
    expect(exported.tokens['--color-app-bg']).toBe('#abcdef');
    expect(exported.tokens['--future-surface-token']).toBe(' #112233 ');
    expect(exported.futureRootField).toEqual(original.futureRootField);
    expect(exported.extensions).toEqual(original.extensions);
    expect(exported.assets).toEqual(original.assets);
    expect(exported.recipes).toEqual(original.recipes);
    expect(exported.brand).toEqual(original.brand);
    expect(exported.typography).toEqual(original.typography);
  });

  it('preserves Event presentation tokens through import, Theme Studio editing, and export', () => {
    const original = completeV2Theme();
    const tokens = original.tokens as Record<string, string>;
    tokens['--color-node-event-bg'] = '#101820';
    tokens['--color-node-event-accent'] = '#ffcc00';
    const projected = parseThemeFile(original);
    const exported = toThemeFile({ ...projected, label: 'Edited Event Theme' });

    expect(exported.tokens['--color-node-event-bg']).toBe('#101820');
    expect(exported.tokens['--color-node-event-accent']).toBe('#ffcc00');
    expect(exported.extensions).toEqual(original.extensions);
  });

  it('defaults only later Core tokens when importing an older v2 theme', () => {
    const olderV2 = completeV2Theme();
    const tokens = olderV2.tokens as Record<string, string>;
    delete tokens['--color-node-event-bg'];
    delete tokens['--color-node-event-border'];
    delete tokens['--color-node-event-text'];
    delete tokens['--color-node-event-accent'];
    delete tokens['--palette-white-text'];

    const migrated = parseThemeDocument(olderV2);
    expect(migrated.tokens).toMatchObject({
      '--color-node-event-bg': getPresetTokens('void')['--color-node-event-bg'],
      '--color-node-event-accent': getPresetTokens('void')['--color-node-event-accent'],
      '--palette-white-text': getPresetTokens('void')['--palette-white-text'],
    });
  });

  it('still rejects an older v2 file that omits an original required token', () => {
    const incompleteV2 = completeV2Theme();
    delete (incompleteV2.tokens as Record<string, string>)['--color-app-bg'];

    expect(() => parseThemeDocument(incompleteV2)).toThrow(/missing required token --color-app-bg/i);
  });

  it('migrates v1 into v2, fills its baseline and preserves non-legacy fields', () => {
    const legacy = {
      schema: THEME_FILE_SCHEMA,
      version: LEGACY_THEME_FILE_VERSION,
      id: 'org.example.legacy',
      label: 'Legacy',
      basePresetId: 'brutalist',
      colors: { '--color-app-bg': '#010203' },
      extensions: { 'org.example.plugin': { kept: true } },
      futureRootField: 42,
    };
    const migrated = parseThemeDocument(legacy);

    expect(migrated.version).toBe(THEME_FILE_VERSION);
    expect(migrated.themeVersion).toBe('1.0.0');
    expect(migrated.tokens['--color-app-bg']).toBe('#010203');
    expect(migrated.tokens['--color-app-surface']).toBe(getPresetTokens('brutalist')['--color-app-surface']);
    expect(migrated.extensions).toEqual(legacy.extensions);
    expect(migrated.futureRootField).toBe(42);
    expect(migrated).not.toHaveProperty('colors');
  });

  it('keeps portable identity and labels on import', () => {
    const imported = createImportedThemeConfig(completeV2Theme());

    expect(imported.id).toBe('org.example.shared-theme');
    expect(imported.label).toBe('Shared Theme');
    expect(getThemeConfigTokens(imported)).toEqual(expect.objectContaining({
      '--color-app-bg': getPresetTokens('void')['--color-app-bg'],
    }));
  });

  it('rejects ambiguous v1 aliases, invalid baselines, unsafe values, schemas and future versions', () => {
    expect(() => parseThemeFile({
      ...completeV2Theme(),
      version: 1,
      tokens: { '--color-app-bg': '#000000' },
      colors: { '--color-app-bg': '#ffffff' },
    })).toThrow(/conflicting tokens and colors/i);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      basePresetId: 'future-preset',
    })).toThrow(/basePresetId/);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      tokens: {
        ...completeV2Theme().tokens,
        '--color-app-bg': 'red; background: url(https://example.test/tracker)',
      },
    })).toThrow(/unsafe/);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      brand: { logoAssetId: 'missing-logo' },
    })).toThrow(/embedded image asset/);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      extensions: { unnamespaced: { value: true } },
    })).toThrow(/reverse-domain namespace/);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      recipes: { density: 'microscopic' },
    })).toThrow(/recipes\.density/);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      recipes: { surfaceStyle: 'remote-css' },
    })).toThrow(/recipes\.surfaceStyle/);

    expect(() => parseThemeFile({
      ...completeV2Theme(),
      recipes: { nodeStyle: 'scripted' },
    })).toThrow(/recipes\.nodeStyle/);

    expect(() => parseThemeFile({ ...completeV2Theme(), schema: 'other.theme' }))
      .toThrow(/Unsupported theme schema/);
    expect(() => parseThemeFile({ ...completeV2Theme(), version: THEME_FILE_VERSION + 1 }))
      .toThrow(/Unsupported theme version/);
  });

  it('does not mutate a rejected future document', () => {
    const future = {
      ...completeV2Theme(),
      version: 99,
      futureRootField: { untouched: true },
    };
    const before = JSON.stringify(future);

    expect(() => parseThemeDocument(future)).toThrow(/Unsupported theme version/);
    expect(JSON.stringify(future)).toBe(before);
  });
});
