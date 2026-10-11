import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createThemeEmbeddedAsset } from './themeAssets';
import {
  applyThemeRestorePlan,
  createAppearanceBackup,
  inspectAppearanceBackup,
  type ThemeRestoreActions,
} from './themeBackup';
import { createThemeConfig, toThemeFile } from './themeFiles';
import { clearBrowserThemeLibraryForTests, loadThemeLibrary } from './themeRepository';

describe('theme backup-to-repository recovery lifecycle', () => {
  beforeEach(() => {
    clearBrowserThemeLibraryForTests();
    useSettingsStore.setState({
      theme: 'void',
      activeThemeId: null,
      customThemes: [],
      themesInitialized: true,
      themeLibraryErrors: [],
    });
  });

  it('round-trips an offline branded theme through backup, install, reload, and re-export', async () => {
    const source = createThemeConfig('Recovery Brand', 'polar', 'org.example.recovery-brand');
    const logo = await createThemeEmbeddedAsset(
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'logo.png',
      ),
      'image/png',
    );
    const font = await createThemeEmbeddedAsset(
      new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], 'font.woff2'),
      'font/woff2',
    );
    source.assets = { 'brand-logo': logo, 'brand-font': font };
    source.brand = { displayName: 'Recovery Co', logoAssetId: 'brand-logo' };
    source.typography = { fontFamily: 'Recovery Sans', regularAssetId: 'brand-font' };
    source.recipes = { density: 'spacious', cornerStyle: 'rounded', elevation: 'graphic' };
    source.sourceDocument = {
      ...source.sourceDocument,
      extensions: { 'org.example.publisher': { retained: true } },
      futureCoreField: { retained: ['without', 'plugin-runtime'] },
    };
    const originalDocument = toThemeFile(source);
    const appearance = createAppearanceBackup({
      theme: 'void',
      activeThemeId: source.id,
      customThemes: [source],
    });
    const plan = await inspectAppearanceBackup({ appearance }, []);
    const actions: ThemeRestoreActions = {
      activateBuiltIn: async () => undefined,
      restoreCustom: async (theme, replace) => {
        await useSettingsStore.getState().restoreAndActivateCustomTheme(theme, replace);
      },
      activateCustom: async id => {
        await useSettingsStore.getState().activateCustomTheme(id);
      },
    };

    await applyThemeRestorePlan(plan, 'apply', actions);
    // Mutating the original import models deletion or editing outside Axiom.
    source.label = 'External source changed';
    source.assets = undefined;

    const reloaded = await loadThemeLibrary();
    expect(reloaded.errors).toEqual([]);
    expect(reloaded.themes).toHaveLength(1);
    expect(toThemeFile(reloaded.themes[0])).toEqual(originalDocument);
    expect(useSettingsStore.getState().activeThemeId).toBe('org.example.recovery-brand');

    const reExported = createAppearanceBackup({
      theme: useSettingsStore.getState().theme,
      activeThemeId: useSettingsStore.getState().activeThemeId,
      customThemes: reloaded.themes,
    });
    expect(reExported).toEqual(appearance);
  });
});
