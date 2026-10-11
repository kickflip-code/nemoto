import { beforeEach, describe, expect, it } from 'vitest';
import { createThemeConfig, toThemeFile } from '../theme/themeFiles';
import {
  clearBrowserThemeLibraryForTests,
  loadThemeLibrary,
} from '../theme/themeRepository';
import { useSettingsStore } from './useSettingsStore';

describe('settings theme-library boundary', () => {
  beforeEach(async () => {
    useSettingsStore.persist.clearStorage();
    clearBrowserThemeLibraryForTests();
    localStorage.removeItem('axiom-theme-migration-recovery-v1');
    useSettingsStore.setState({
      theme: 'void',
      customThemes: [],
      activeThemeId: null,
      themesInitialized: false,
      themeLibraryErrors: [],
    });
  });

  it('starts fresh profiles in Polar and preserves a saved Void selection on rehydration', async () => {
    expect(useSettingsStore.getInitialState().theme).toBe('soft');
    useSettingsStore.getState().setTheme('void');
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().theme).toBe('void');
  });

  it('does not persist installed themes or active custom IDs in axiom-settings', () => {
    const theme = createThemeConfig('Local file', 'void', 'org.example.local-file');
    useSettingsStore.getState().setCustomThemes([theme]);
    useSettingsStore.getState().setActiveThemeId(theme.id);

    const persisted = JSON.parse(localStorage.getItem('axiom-settings') || '{}');
    expect(persisted.state).not.toHaveProperty('customThemes');
    expect(persisted.state).not.toHaveProperty('activeThemeId');
    expect(persisted.state.theme).toBe('void');
  });

  it('migrates the hydrated legacy cache into the repository and preserves activation', async () => {
    const legacy = createThemeConfig('Legacy cache', 'polar', 'org.example.legacy-cache');
    legacy.sourceDocument = undefined;
    useSettingsStore.setState({
      customThemes: [legacy],
      activeThemeId: legacy.id,
      themesInitialized: false,
    });

    await useSettingsStore.getState().initializeThemeLibrary();

    expect((await loadThemeLibrary()).themes.map(theme => theme.id)).toEqual([legacy.id]);
    expect(useSettingsStore.getState().activeThemeId).toBe(legacy.id);
    expect(useSettingsStore.getState().themesInitialized).toBe(true);
  });

  it('updates the file projection before publishing the in-memory cache', async () => {
    const theme = createThemeConfig('Original', 'brutalist', 'org.example.update');
    theme.sourceDocument = {
      ...theme.sourceDocument,
      extensions: { 'org.example.plugin': { kept: true } },
    };
    await useSettingsStore.getState().installCustomTheme(theme);
    const installed = useSettingsStore.getState().customThemes[0];

    await useSettingsStore.getState().updateCustomTheme({
      ...installed,
      label: 'Updated',
    });

    const reloaded = (await loadThemeLibrary()).themes[0];
    expect(reloaded.label).toBe('Updated');
    expect(toThemeFile(reloaded).extensions).toEqual({
      'org.example.plugin': { kept: true },
    });
  });

  it('restores and activates a custom theme through one store action', async () => {
    const theme = createThemeConfig('Recovered', 'polar', 'org.example.store-recovery');
    theme.sourceDocument = {
      ...theme.sourceDocument,
      extensions: { 'org.example.restore': { retained: true } },
    };

    await useSettingsStore.getState().restoreAndActivateCustomTheme(theme, false);

    expect(useSettingsStore.getState().activeThemeId).toBe(theme.id);
    expect(useSettingsStore.getState().customThemes.map(candidate => candidate.id)).toEqual([theme.id]);
    expect(toThemeFile((await loadThemeLibrary()).themes[0]).extensions).toEqual({
      'org.example.restore': { retained: true },
    });
  });

  it('keeps a recovery copy when legacy aliases are ambiguous', async () => {
    const legacy = createThemeConfig('Ambiguous', 'void', 'org.example.ambiguous');
    legacy.sourceDocument = undefined;
    legacy.tokens = { ...legacy.tokens, '--color-app-bg': '#ffffff' };
    useSettingsStore.setState({
      customThemes: [legacy],
      activeThemeId: legacy.id,
      themesInitialized: false,
    });

    await useSettingsStore.getState().initializeThemeLibrary();

    expect(useSettingsStore.getState().themeLibraryErrors[0].message).toMatch(/conflicting tokens and colors/);
    expect(JSON.parse(localStorage.getItem('axiom-theme-migration-recovery-v1') || '[]'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: legacy.id })]));
    expect((await loadThemeLibrary()).themes).toEqual([]);
  });
});
