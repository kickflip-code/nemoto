import { beforeEach, describe, expect, it } from 'vitest';
import { createThemeConfig, parseThemeFile, toThemeFile } from './themeFiles';
import { createThemeEmbeddedAsset } from './themeAssets';
import {
  clearBrowserThemeLibraryForTests,
  installTheme,
  loadThemeLibrary,
  removeTheme,
  restoreThemeAndActivate,
} from './themeRepository';

describe('theme repository browser contract', () => {
  beforeEach(() => {
    clearBrowserThemeLibraryForTests();
  });

  it('owns installed copies independently of the imported object', async () => {
    const importedDocument = toThemeFile(createThemeConfig(
      'Portable Theme',
      'void',
      'org.example.portable-theme',
    ));
    importedDocument.extensions = { 'org.example.plugin': { kept: true } };
    const theme = parseThemeFile(importedDocument);

    await installTheme(theme);
    importedDocument.label = 'Mutated outside Axiom';

    const snapshot = await loadThemeLibrary();
    expect(snapshot.themes).toHaveLength(1);
    expect(snapshot.themes[0].label).toBe('Portable Theme');
    expect(toThemeFile(snapshot.themes[0]).extensions).toEqual({
      'org.example.plugin': { kept: true },
    });
  });

  it('requires an explicit replacement for a stable-ID conflict', async () => {
    const theme = createThemeConfig('First', 'void', 'org.example.conflict');
    await installTheme(theme);

    await expect(installTheme({ ...theme, label: 'Second' })).rejects.toThrow(/already installed/);
    await installTheme({ ...theme, label: 'Second' }, true);

    expect((await loadThemeLibrary()).themes[0].label).toBe('Second');
  });

  it('installs an independent restore copy while preserving unknown document fields', async () => {
    const document = toThemeFile(createThemeConfig(
      'Recovered',
      'polar',
      'org.example.recovered-copy',
    ));
    document.extensions = { 'org.example.plugin': { retained: true } };
    document.futureCoreField = { retained: true };
    const incoming = parseThemeFile(document);

    await restoreThemeAndActivate(incoming, false);
    document.label = 'External source changed';

    const restored = toThemeFile((await loadThemeLibrary()).themes[0]);
    expect(restored.label).toBe('Recovered');
    expect(restored.extensions).toEqual({ 'org.example.plugin': { retained: true } });
    expect(restored.futureCoreField).toEqual({ retained: true });
  });

  it('survives a repository reload and deletes only the selected theme', async () => {
    const first = createThemeConfig('First', 'polar', 'org.example.first');
    const second = createThemeConfig('Second', 'brutalist', 'org.example.second');
    await installTheme(first);
    await installTheme(second);

    expect((await loadThemeLibrary()).themes.map(theme => theme.id)).toEqual([
      'org.example.first',
      'org.example.second',
    ]);

    await removeTheme(first.id);
    expect((await loadThemeLibrary()).themes.map(theme => theme.id)).toEqual([
      'org.example.second',
    ]);
  });

  it('rejects tampered assets on install and isolates them on restart', async () => {
    const theme = createThemeConfig('Signed', 'void', 'org.example.signed');
    const asset = await createThemeEmbeddedAsset(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'logo.png'),
      'image/png',
    );
    theme.assets = { 'brand-logo': { ...asset, sha256: '0'.repeat(64) } };
    theme.brand = { logoAssetId: 'brand-logo' };

    await expect(installTheme(theme)).rejects.toThrow(/integrity verification/);

    localStorage.setItem('axiom-theme-library-v2', JSON.stringify([toThemeFile(theme)]));
    const snapshot = await loadThemeLibrary();
    expect(snapshot.themes).toEqual([]);
    expect(snapshot.errors[0]).toMatchObject({ fileName: 'browser-theme-1.axiom-theme.json' });
    expect(snapshot.errors[0].message).toMatch(/integrity verification/);
  });
});
