import { describe, expect, it } from 'vitest';
import type { ThemeConfig } from '../types';
import { getPresetTokens } from './presets';
import {
  createThemeFontFaceCss,
  parseExportedThemeBranding,
  parseExportedThemePresentationAttributes,
  resolveThemePresentation,
} from './themePresentation';

const theme: ThemeConfig = {
  id: 'org.example.presentation',
  label: 'Presentation',
  basePresetId: 'void',
  colors: getPresetTokens('void'),
  brand: { displayName: 'Example Co', logoAssetId: 'brand-logo' },
  typography: { fontFamily: 'Example Sans', regularAssetId: 'brand-font' },
  assets: {
    'brand-logo': { mediaType: 'image/png', data: 'iVBORw0KGgo=', sha256: '0'.repeat(64) },
    'brand-font': { mediaType: 'font/woff2', data: 'd09GMgA=', sha256: '1'.repeat(64) },
  },
  recipes: {
    density: 'compact',
    cornerStyle: 'rounded',
    elevation: 'flat',
    controlStyle: 'outlined',
    surfaceStyle: 'translucent',
    nodeStyle: 'graphic',
    futureRecipe: { inert: true },
  },
};

describe('Core-owned theme presentation', () => {
  it('uses Nemoto by default but preserves saved branding verbatim', () => {
    expect(resolveThemePresentation({ ...theme, brand: undefined }).displayName).toBe('Nemoto');
    expect(resolveThemePresentation({ ...theme, brand: { displayName: 'AXIOM – Åäö' } }).displayName).toBe('AXIOM – Åäö');
  });
  it('resolves portable branding, fonts and declarative recipes without raw CSS', () => {
    const presentation = resolveThemePresentation(theme);

    expect(presentation.displayName).toBe('Example Co');
    expect(presentation.logoDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(presentation.variables).toMatchObject({
      '--theme-control-size-base': '1.75rem',
      '--theme-dock-button-size': '2.125rem',
      '--control-radius': '0.75rem',
      '--app-shadow-lg': 'none',
      '--control-border-width': 'var(--app-border-width)',
      '--theme-panel-background': 'color-mix(in srgb, var(--color-app-sidebar) 82%, transparent)',
      '--theme-node-border-width': '3px',
      '--theme-node-label-transform': 'uppercase',
    });
    expect(presentation.attributes).toEqual({
      'data-theme-surface-style': 'translucent',
      'data-theme-node-style': 'graphic',
    });
    expect(presentation.variables['--font-family-node']).toContain('NemotoTheme-org-example-presentation');
    expect(presentation.variables).not.toHaveProperty('futureRecipe');
    expect(createThemeFontFaceCss(presentation)).toContain("format('woff2')");
    expect(createThemeFontFaceCss(presentation)).toContain('font-weight: 400');
  });

  it('ignores external logo URLs and sanitizes exported viewer branding', () => {
    const presentation = resolveThemePresentation({
      ...theme,
      brand: { displayName: 'Legacy', logoUrl: 'https://example.test/logo.png' },
      assets: {},
      typography: {},
    });
    expect(presentation.logoDataUrl).toBeUndefined();

    expect(parseExportedThemeBranding({
      displayName: '  Viewer Brand  ',
      logoDataUrl: 'https://example.test/tracker.png',
    })).toEqual({ displayName: 'Viewer Brand' });
  });

  it('admits only known Core recipe attributes from an exported viewer payload', () => {
    expect(parseExportedThemePresentationAttributes({
      surfaceStyle: 'layered',
      nodeStyle: 'raised',
      futureRecipe: 'executed-never',
    })).toEqual({
      'data-theme-surface-style': 'layered',
      'data-theme-node-style': 'raised',
    });
    expect(parseExportedThemePresentationAttributes({
      surfaceStyle: 'url(https://example.test)',
      nodeStyle: 'scripted',
    })).toEqual({});
  });
});

it('preserves an explicitly hidden name through presentation and exported branding', () => {
  const presentation = resolveThemePresentation({ ...theme, brand: { ...theme.brand, showDisplayName: false } });
  expect(presentation.displayName).toBe('Example Co');
  expect(parseExportedThemeBranding(presentation).showDisplayName).toBe(false);
  expect(parseExportedThemeBranding({ displayName: 'Existing theme' }).showDisplayName).not.toBe(false);
});
