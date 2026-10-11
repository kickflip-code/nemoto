import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../stores/useSettingsStore';
import { createThemeConfig } from '../theme/themeFiles';
import { createThemeEmbeddedAsset } from '../theme/themeAssets';
import { THEME_PRESENTATION_STYLE_ID } from '../theme/themePresentation';
import { clearBrowserThemeLibraryForTests, installTheme } from '../theme/themeRepository';
import { ThemeBrandMark } from '../components/shared/ThemeBrandMark';
import { ThemeProvider } from './ThemeContext';

describe('ThemeProvider custom-theme hydration', () => {
  beforeEach(() => {
    clearBrowserThemeLibraryForTests();
    useSettingsStore.setState({
      theme: 'void',
      customThemes: [],
      activeThemeId: null,
      themesInitialized: false,
      themeLibraryErrors: [],
    });
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-surface-style');
    document.documentElement.removeAttribute('data-theme-node-style');
    document.documentElement.removeAttribute('style');
    document.getElementById(THEME_PRESENTATION_STYLE_ID)?.remove();
  });

  it('reloads the installed document and applies its baseline and tokens', async () => {
    const theme = createThemeConfig('Hydrated', 'polar', 'org.example.hydrated');
    theme.colors['--color-app-bg'] = '#abcdef';
    theme.tokens = { ...theme.colors };
    await installTheme(theme);
    useSettingsStore.setState({ activeThemeId: theme.id });

    render(<ThemeProvider><div>content</div></ThemeProvider>);

    await waitFor(() => {
      expect(useSettingsStore.getState().customThemes.map(candidate => candidate.id)).toEqual([theme.id]);
      expect(document.documentElement.getAttribute('data-theme')).toBe('soft');
      expect(document.documentElement.style.getPropertyValue('--color-app-bg')).toBe('#abcdef');
    });
  });

  it('hydrates verified branding, typography and recipe variables from the installed copy', async () => {
    const theme = createThemeConfig('Branded', 'void', 'org.example.branded');
    const logo = await createThemeEmbeddedAsset(
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'logo.png'),
      'image/png',
    );
    const font = await createThemeEmbeddedAsset(
      new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], 'font.woff2'),
      'font/woff2',
    );
    theme.assets = { 'brand-logo': logo, 'brand-font': font };
    theme.brand = { displayName: 'Example Co', logoAssetId: 'brand-logo' };
    theme.typography = { fontFamily: 'Example Sans', regularAssetId: 'brand-font' };
    theme.recipes = {
      density: 'spacious',
      cornerStyle: 'rounded',
      surfaceStyle: 'translucent',
      nodeStyle: 'graphic',
    };
    await installTheme(theme);
    useSettingsStore.setState({ activeThemeId: theme.id });

    const view = render(<ThemeProvider><ThemeBrandMark /></ThemeProvider>);

    await waitFor(() => {
      expect(view.getByText('Example Co')).toBeInTheDocument();
      expect(view.container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
      expect(document.documentElement.style.getPropertyValue('--theme-control-size-base')).toBe('2.25rem');
      expect(document.documentElement.style.getPropertyValue('--control-radius')).toBe('0.75rem');
      expect(document.documentElement.style.getPropertyValue('--font-family-ui')).toContain('AxiomTheme-org-example-branded');
      expect(document.documentElement.style.getPropertyValue('--font-family-node')).toContain('AxiomTheme-org-example-branded');
      expect(document.documentElement.getAttribute('data-theme-surface-style')).toBe('translucent');
      expect(document.documentElement.getAttribute('data-theme-node-style')).toBe('graphic');
      expect(document.getElementById(THEME_PRESENTATION_STYLE_ID)?.textContent).toContain("format('woff2')");
    });
  });
});
