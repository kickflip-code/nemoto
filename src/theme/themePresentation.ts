import type { ThemeConfig } from '../types';
import type {
  ThemeEmbeddedAsset,
  ThemeNodeRecipe,
  ThemeRecipes,
  ThemeSurfaceRecipe,
} from './themeContract';

export const THEME_PRESENTATION_STYLE_ID = 'axiom-active-theme-presentation';

export const THEME_PRESENTATION_VARIABLE_NAMES = [
  '--font-family-ui',
  '--font-family-display',
  '--font-family-node',
  '--theme-control-size-base',
  '--theme-control-size-sm',
  '--theme-icon-size-base',
  '--theme-icon-size-sm',
  '--theme-control-padding-base',
  '--theme-control-padding-sm',
  '--theme-field-padding-sm',
  '--theme-field-padding-xs',
  '--theme-menu-item-height',
  '--theme-menu-item-padding',
  '--theme-dock-padding',
  '--theme-dock-gap',
  '--theme-dock-button-size',
  '--theme-rail-button-size',
  '--theme-list-row-height',
  '--theme-dialog-row-height',
  '--control-radius',
  '--dock-radius',
  '--dialog-radius',
  '--app-shadow-sm',
  '--app-shadow-md',
  '--app-shadow-lg',
  '--app-shadow-xl',
  '--app-shadow-inset',
  '--app-shadow-active',
  '--control-shadow',
  '--control-active-shadow',
  '--control-active-transform',
  '--field-shadow',
  '--field-focus-shadow',
  '--menu-shadow',
  '--menu-hover-shadow',
  '--dialog-shadow',
  '--dock-shadow',
  '--control-border-width',
  '--theme-panel-background',
  '--theme-panel-header-background',
  '--theme-panel-body-background',
  '--theme-panel-section-background',
  '--theme-dialog-background',
  '--theme-dialog-header-background',
  '--theme-dialog-body-background',
  '--theme-menu-background',
  '--theme-surface-backdrop-filter',
  '--theme-node-border-width',
  '--theme-node-radius',
  '--theme-node-shadow',
  '--theme-node-hover-shadow',
  '--theme-node-selected-shadow',
  '--theme-node-filter',
  '--theme-node-hover-filter',
  '--theme-node-selected-filter',
  '--theme-node-label-weight',
  '--theme-node-label-transform',
  '--theme-node-label-letter-spacing',
] as const;

export type ThemePresentationVariableName = typeof THEME_PRESENTATION_VARIABLE_NAMES[number];
export type ThemePresentationVariables = Partial<Record<ThemePresentationVariableName, string>>;

export const THEME_PRESENTATION_ATTRIBUTE_NAMES = [
  'data-theme-surface-style',
  'data-theme-node-style',
] as const;

export type ThemePresentationAttributeName = typeof THEME_PRESENTATION_ATTRIBUTE_NAMES[number];
export type ThemePresentationAttributes = Partial<Record<ThemePresentationAttributeName, string>>;

export interface ThemeFontFace {
  family: string;
  dataUrl: string;
  weight: 400 | 500 | 700;
}

export interface ThemeBrandPresentation {
  displayName: string;
  showDisplayName?: boolean;
  logoDataUrl?: string;
}

export interface ResolvedThemePresentation extends ThemeBrandPresentation {
  themeId: string;
  variables: ThemePresentationVariables;
  attributes: ThemePresentationAttributes;
  fontFaces: ThemeFontFace[];
  recipes: ThemeRecipes;
}

export const DEFAULT_THEME_BRAND_PRESENTATION: ThemeBrandPresentation = {
  displayName: 'Nemoto',
};

const dataUrlForAsset = (asset: ThemeEmbeddedAsset): string => `data:${asset.mediaType};base64,${asset.data}`;

const SURFACE_RECIPE_VALUES = new Set<ThemeSurfaceRecipe>(['solid', 'layered', 'translucent']);
const NODE_RECIPE_VALUES = new Set<ThemeNodeRecipe>(['minimal', 'outlined', 'raised', 'graphic']);

const getRecipeAttributes = (recipes: ThemeRecipes): ThemePresentationAttributes => ({
  ...(SURFACE_RECIPE_VALUES.has(recipes.surfaceStyle as ThemeSurfaceRecipe)
    ? { 'data-theme-surface-style': recipes.surfaceStyle as ThemeSurfaceRecipe }
    : {}),
  ...(NODE_RECIPE_VALUES.has(recipes.nodeStyle as ThemeNodeRecipe)
    ? { 'data-theme-node-style': recipes.nodeStyle as ThemeNodeRecipe }
    : {}),
});

const getRecipeVariables = (recipes: ThemeRecipes): ThemePresentationVariables => {
  const variables: ThemePresentationVariables = {};
  const density = recipes.density || 'comfortable';

  if (density === 'compact') {
    Object.assign(variables, {
      '--theme-control-size-base': '1.75rem',
      '--theme-control-size-sm': '1.375rem',
      '--theme-icon-size-base': '1.75rem',
      '--theme-icon-size-sm': '1.375rem',
      '--theme-control-padding-base': '0.625rem',
      '--theme-control-padding-sm': '0.5rem',
      '--theme-field-padding-sm': '0.25rem 0.45rem',
      '--theme-field-padding-xs': '0.1875rem 0.4rem',
      '--theme-menu-item-height': '1.75rem',
      '--theme-menu-item-padding': '0.625rem',
      '--theme-dock-padding': '0.35rem 0.55rem',
      '--theme-dock-gap': '0.25rem',
      '--theme-dock-button-size': '2.125rem',
      '--theme-rail-button-size': '1.75rem',
      '--theme-list-row-height': '1.75rem',
      '--theme-dialog-row-height': '2.25rem',
    });
  } else if (density === 'comfortable') {
    Object.assign(variables, {
      '--theme-control-size-base': '2rem',
      '--theme-control-size-sm': '1.625rem',
      '--theme-icon-size-base': '2rem',
      '--theme-icon-size-sm': '1.5rem',
      '--theme-control-padding-base': '0.75rem',
      '--theme-control-padding-sm': '0.625rem',
      '--theme-field-padding-sm': '0.375rem 0.5rem',
      '--theme-field-padding-xs': '0.25rem 0.5rem',
      '--theme-menu-item-height': '2rem',
      '--theme-menu-item-padding': '0.75rem',
      '--theme-dock-padding': '0.45rem 0.7rem',
      '--theme-dock-gap': '0.35rem',
      '--theme-dock-button-size': '2.5rem',
      '--theme-rail-button-size': '2rem',
      '--theme-list-row-height': '2rem',
      '--theme-dialog-row-height': '2.5rem',
    });
  } else if (density === 'spacious') {
    Object.assign(variables, {
      '--theme-control-size-base': '2.25rem',
      '--theme-control-size-sm': '1.875rem',
      '--theme-icon-size-base': '2.25rem',
      '--theme-icon-size-sm': '1.75rem',
      '--theme-control-padding-base': '0.9rem',
      '--theme-control-padding-sm': '0.75rem',
      '--theme-field-padding-sm': '0.5rem 0.625rem',
      '--theme-field-padding-xs': '0.375rem 0.625rem',
      '--theme-menu-item-height': '2.25rem',
      '--theme-menu-item-padding': '0.875rem',
      '--theme-dock-padding': '0.6rem 0.85rem',
      '--theme-dock-gap': '0.5rem',
      '--theme-dock-button-size': '2.75rem',
      '--theme-rail-button-size': '2.25rem',
      '--theme-list-row-height': '2.25rem',
      '--theme-dialog-row-height': '2.75rem',
    });
  }

  if (recipes.cornerStyle === 'square') {
    Object.assign(variables, {
      '--control-radius': '0px',
      '--dock-radius': '0px',
      '--dialog-radius': '0px',
    });
  } else if (recipes.cornerStyle === 'soft') {
    Object.assign(variables, {
      '--control-radius': '0.375rem',
      '--dock-radius': '0.625rem',
      '--dialog-radius': '0.75rem',
    });
  } else if (recipes.cornerStyle === 'rounded') {
    Object.assign(variables, {
      '--control-radius': '0.75rem',
      '--dock-radius': '1rem',
      '--dialog-radius': '1.25rem',
    });
  }

  if (recipes.elevation === 'flat') {
    Object.assign(variables, {
      '--app-shadow-sm': 'none',
      '--app-shadow-md': 'none',
      '--app-shadow-lg': 'none',
      '--app-shadow-xl': 'none',
      '--app-shadow-inset': 'none',
      '--app-shadow-active': 'none',
      '--control-shadow': 'none',
      '--control-active-shadow': 'none',
      '--field-shadow': 'none',
      '--menu-shadow': 'none',
      '--menu-hover-shadow': 'none',
      '--dialog-shadow': 'none',
      '--dock-shadow': 'none',
    });
  } else if (recipes.elevation === 'subtle') {
    Object.assign(variables, {
      '--app-shadow-sm': '0 1px 2px color-mix(in srgb, var(--color-text-main) 10%, transparent)',
      '--app-shadow-md': '0 4px 10px color-mix(in srgb, var(--color-text-main) 12%, transparent)',
      '--app-shadow-lg': '0 10px 24px color-mix(in srgb, var(--color-text-main) 14%, transparent)',
      '--app-shadow-xl': '0 18px 40px color-mix(in srgb, var(--color-text-main) 18%, transparent)',
      '--app-shadow-inset': 'inset 0 1px 2px color-mix(in srgb, var(--color-text-main) 12%, transparent)',
      '--control-shadow': 'var(--app-shadow-sm)',
      '--control-active-shadow': 'var(--app-shadow-inset)',
      '--field-shadow': 'none',
      '--menu-shadow': 'var(--app-shadow-lg)',
      '--dialog-shadow': 'var(--app-shadow-xl)',
      '--dock-shadow': 'var(--app-shadow-md)',
    });
  } else if (recipes.elevation === 'raised') {
    Object.assign(variables, {
      '--app-shadow-sm': '0 2px 5px color-mix(in srgb, var(--color-text-main) 16%, transparent)',
      '--app-shadow-md': '0 7px 18px color-mix(in srgb, var(--color-text-main) 20%, transparent)',
      '--app-shadow-lg': '0 14px 34px color-mix(in srgb, var(--color-text-main) 24%, transparent)',
      '--app-shadow-xl': '0 24px 54px color-mix(in srgb, var(--color-text-main) 28%, transparent)',
      '--app-shadow-inset': 'inset 0 2px 4px color-mix(in srgb, var(--color-text-main) 18%, transparent)',
      '--control-shadow': 'var(--app-shadow-sm)',
      '--control-active-shadow': 'var(--app-shadow-inset)',
      '--field-shadow': 'var(--app-shadow-inset)',
      '--menu-shadow': 'var(--app-shadow-lg)',
      '--dialog-shadow': 'var(--app-shadow-xl)',
      '--dock-shadow': 'var(--app-shadow-md)',
    });
  } else if (recipes.elevation === 'graphic') {
    const graphicShadow = '4px 4px 0 color-mix(in srgb, var(--color-text-main) 72%, transparent)';
    Object.assign(variables, {
      '--app-shadow-sm': graphicShadow,
      '--app-shadow-md': '6px 6px 0 color-mix(in srgb, var(--color-text-main) 78%, transparent)',
      '--app-shadow-lg': '9px 9px 0 color-mix(in srgb, var(--color-text-main) 82%, transparent)',
      '--app-shadow-xl': '12px 12px 0 color-mix(in srgb, var(--color-text-main) 86%, transparent)',
      '--app-shadow-inset': 'inset 2px 2px 0 color-mix(in srgb, var(--color-text-main) 24%, transparent)',
      '--app-shadow-active': '1px 1px 0 color-mix(in srgb, var(--color-text-main) 80%, transparent)',
      '--control-shadow': 'var(--app-shadow-sm)',
      '--control-active-shadow': 'var(--app-shadow-active)',
      '--control-active-transform': 'translate(2px, 2px)',
      '--field-shadow': 'none',
      '--menu-shadow': 'var(--app-shadow-md)',
      '--dialog-shadow': 'var(--app-shadow-lg)',
      '--dock-shadow': 'var(--app-shadow-md)',
    });
  }

  if (recipes.controlStyle === 'flat') {
    Object.assign(variables, {
      '--control-border-width': '0px',
      '--control-shadow': 'none',
      '--control-active-shadow': 'none',
      '--control-active-transform': 'none',
      '--field-shadow': 'none',
    });
  } else if (recipes.controlStyle === 'outlined') {
    Object.assign(variables, {
      '--control-border-width': 'var(--app-border-width)',
      '--control-shadow': 'none',
      '--control-active-shadow': 'none',
      '--control-active-transform': 'none',
      '--field-shadow': 'none',
    });
  } else if (recipes.controlStyle === 'raised') {
    Object.assign(variables, {
      '--control-border-width': 'var(--app-border-width)',
      '--control-shadow': 'var(--app-shadow-sm)',
      '--control-active-shadow': 'var(--app-shadow-inset)',
      '--control-active-transform': 'none',
      '--field-shadow': 'var(--app-shadow-inset)',
    });
  } else if (recipes.controlStyle === 'graphic') {
    Object.assign(variables, {
      '--control-border-width': '2px',
      '--control-shadow': 'var(--app-shadow-sm)',
      '--control-active-shadow': 'var(--app-shadow-active, none)',
      '--control-active-transform': 'translate(2px, 2px)',
      '--field-shadow': 'none',
    });
  }

  if (recipes.surfaceStyle === 'solid') {
    Object.assign(variables, {
      '--theme-panel-background': 'var(--color-app-sidebar)',
      '--theme-panel-header-background': 'var(--color-app-header)',
      '--theme-panel-body-background': 'var(--color-app-sidebar)',
      '--theme-panel-section-background': 'var(--color-app-surface)',
      '--theme-dialog-background': 'var(--color-app-surface)',
      '--theme-dialog-header-background': 'var(--color-app-header)',
      '--theme-dialog-body-background': 'var(--color-app-bg)',
      '--theme-menu-background': 'var(--color-menu-bg)',
      '--theme-surface-backdrop-filter': 'none',
    });
  } else if (recipes.surfaceStyle === 'layered') {
    Object.assign(variables, {
      '--theme-panel-background': 'var(--color-app-sidebar)',
      '--theme-panel-header-background': 'color-mix(in srgb, var(--color-app-header) 70%, transparent)',
      '--theme-panel-body-background': 'color-mix(in srgb, var(--color-app-sidebar) 92%, var(--color-app-bg))',
      '--theme-panel-section-background': 'color-mix(in srgb, var(--color-app-surface) 42%, transparent)',
      '--theme-dialog-background': 'var(--color-app-surface)',
      '--theme-dialog-header-background': 'color-mix(in srgb, var(--color-app-header) 78%, transparent)',
      '--theme-dialog-body-background': 'var(--color-app-bg)',
      '--theme-menu-background': 'var(--color-menu-bg)',
      '--theme-surface-backdrop-filter': 'none',
    });
  } else if (recipes.surfaceStyle === 'translucent') {
    Object.assign(variables, {
      '--theme-panel-background': 'color-mix(in srgb, var(--color-app-sidebar) 82%, transparent)',
      '--theme-panel-header-background': 'color-mix(in srgb, var(--color-app-header) 68%, transparent)',
      '--theme-panel-body-background': 'color-mix(in srgb, var(--color-app-sidebar) 72%, transparent)',
      '--theme-panel-section-background': 'color-mix(in srgb, var(--color-app-surface) 48%, transparent)',
      '--theme-dialog-background': 'color-mix(in srgb, var(--color-app-surface) 88%, transparent)',
      '--theme-dialog-header-background': 'color-mix(in srgb, var(--color-app-header) 70%, transparent)',
      '--theme-dialog-body-background': 'color-mix(in srgb, var(--color-app-bg) 82%, transparent)',
      '--theme-menu-background': 'color-mix(in srgb, var(--color-menu-bg) 88%, transparent)',
      '--theme-surface-backdrop-filter': 'blur(14px) saturate(1.08)',
    });
  }

  const nodeAccent = 'var(--node-accent-color, var(--node-bg-color, var(--color-accent-primary)))';
  if (recipes.nodeStyle === 'minimal') {
    Object.assign(variables, {
      '--theme-node-border-width': '0px',
      '--theme-node-radius': 'var(--app-radius-node)',
      '--theme-node-shadow': 'none',
      '--theme-node-hover-shadow': `0 0 0 1px ${nodeAccent}`,
      '--theme-node-selected-shadow': `0 0 0 2px ${nodeAccent}`,
      '--theme-node-filter': 'none',
      '--theme-node-hover-filter': 'none',
      '--theme-node-selected-filter': `drop-shadow(0 0 3px ${nodeAccent})`,
      '--theme-node-label-weight': '500',
      '--theme-node-label-transform': 'none',
      '--theme-node-label-letter-spacing': '0',
    });
  } else if (recipes.nodeStyle === 'outlined') {
    Object.assign(variables, {
      '--theme-node-border-width': '1px',
      '--theme-node-radius': 'var(--app-radius-node)',
      '--theme-node-shadow': 'none',
      '--theme-node-hover-shadow': `0 0 0 2px color-mix(in srgb, ${nodeAccent} 35%, transparent)`,
      '--theme-node-selected-shadow': `0 0 0 2px var(--color-app-bg), 0 0 0 4px ${nodeAccent}`,
      '--theme-node-filter': `drop-shadow(0 0 0.5px ${nodeAccent})`,
      '--theme-node-hover-filter': `drop-shadow(0 0 2px ${nodeAccent})`,
      '--theme-node-selected-filter': `drop-shadow(0 0 4px ${nodeAccent})`,
      '--theme-node-label-weight': '600',
      '--theme-node-label-transform': 'none',
      '--theme-node-label-letter-spacing': '0',
    });
  } else if (recipes.nodeStyle === 'raised') {
    Object.assign(variables, {
      '--theme-node-border-width': '1px',
      '--theme-node-radius': 'var(--app-radius-node)',
      '--theme-node-shadow': 'var(--app-shadow-md)',
      '--theme-node-hover-shadow': `var(--app-shadow-lg), 0 0 0 2px color-mix(in srgb, ${nodeAccent} 30%, transparent)`,
      '--theme-node-selected-shadow': `var(--app-shadow-md), 0 0 0 2px var(--color-app-bg), 0 0 0 4px ${nodeAccent}`,
      '--theme-node-filter': 'drop-shadow(0 6px 8px color-mix(in srgb, var(--color-text-main) 18%, transparent))',
      '--theme-node-hover-filter': `drop-shadow(0 8px 10px color-mix(in srgb, ${nodeAccent} 28%, transparent))`,
      '--theme-node-selected-filter': `drop-shadow(0 0 5px ${nodeAccent})`,
      '--theme-node-label-weight': '600',
      '--theme-node-label-transform': 'none',
      '--theme-node-label-letter-spacing': '0',
    });
  } else if (recipes.nodeStyle === 'graphic') {
    Object.assign(variables, {
      '--theme-node-border-width': '3px',
      '--theme-node-radius': '0px',
      '--theme-node-shadow': '5px 5px 0 color-mix(in srgb, var(--color-text-main) 82%, transparent)',
      '--theme-node-hover-shadow': `5px 5px 0 color-mix(in srgb, var(--color-text-main) 82%, transparent), 0 0 0 2px ${nodeAccent}`,
      '--theme-node-selected-shadow': `5px 5px 0 color-mix(in srgb, var(--color-text-main) 82%, transparent), 0 0 0 2px var(--color-app-bg), 0 0 0 5px ${nodeAccent}`,
      '--theme-node-filter': 'drop-shadow(5px 5px 0 color-mix(in srgb, var(--color-text-main) 82%, transparent))',
      '--theme-node-hover-filter': `drop-shadow(5px 5px 0 color-mix(in srgb, ${nodeAccent} 72%, transparent))`,
      '--theme-node-selected-filter': `drop-shadow(6px 6px 0 ${nodeAccent})`,
      '--theme-node-label-weight': '800',
      '--theme-node-label-transform': 'uppercase',
      '--theme-node-label-letter-spacing': '0.06em',
    });
  }

  return variables;
};

const getFontFace = (
  assets: Record<string, ThemeEmbeddedAsset>,
  assetId: string | undefined,
  family: string,
  weight: ThemeFontFace['weight'],
): ThemeFontFace | null => {
  if (!assetId) return null;
  const asset = assets[assetId];
  if (!asset || asset.mediaType !== 'font/woff2') return null;
  return { family, dataUrl: dataUrlForAsset(asset), weight };
};

export const resolveThemePresentation = (theme?: ThemeConfig): ResolvedThemePresentation => {
  if (!theme) {
    const recipes: ThemeRecipes = {};
    return {
      themeId: 'void',
      ...DEFAULT_THEME_BRAND_PRESENTATION,
      variables: getRecipeVariables(recipes),
      attributes: getRecipeAttributes(recipes),
      fontFaces: [],
      recipes,
    };
  }

  const assets = theme.assets || {};
  const logoAsset = theme.brand?.logoAssetId ? assets[theme.brand.logoAssetId] : undefined;
  const family = `AxiomTheme-${theme.id.replace(/[^a-z0-9-]/g, '-')}`;
  const fontFaces = [
    getFontFace(assets, theme.typography?.regularAssetId, family, 400),
    getFontFace(assets, theme.typography?.mediumAssetId, family, 500),
    getFontFace(assets, theme.typography?.boldAssetId, family, 700),
  ].filter((face): face is ThemeFontFace => !!face);
  const recipes = theme.recipes || {};
  const variables = getRecipeVariables(recipes);
  const attributes = getRecipeAttributes(recipes);

  if (fontFaces.length > 0) {
    variables['--font-family-ui'] = `'${family}', sans-serif`;
    variables['--font-family-display'] = `'${family}', sans-serif`;
    variables['--font-family-node'] = `'${family}', sans-serif`;
  }

  return {
    themeId: theme.id,
    ...(theme.brand?.showDisplayName === false ? { showDisplayName: false } : {}),
    displayName: theme.brand?.displayName?.trim() || DEFAULT_THEME_BRAND_PRESENTATION.displayName,
    ...(logoAsset && (logoAsset.mediaType === 'image/png' || logoAsset.mediaType === 'image/webp')
      ? { logoDataUrl: dataUrlForAsset(logoAsset) }
      : {}),
    variables,
    attributes,
    fontFaces,
    recipes,
  };
};

export const createThemeFontFaceCss = (presentation: ResolvedThemePresentation): string => (
  presentation.fontFaces.map(face => `@font-face {\n  font-family: '${face.family}';\n  src: url('${face.dataUrl}') format('woff2');\n  font-style: normal;\n  font-weight: ${face.weight};\n  font-display: swap;\n}`).join('\n')
);

export interface ThemePresentationStyleTarget {
  setProperty: (property: string, value: string) => void;
  removeProperty: (property: string) => string;
}

export interface ThemePresentationAttributeTarget {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
}

export const applyThemePresentationVariables = (
  style: ThemePresentationStyleTarget,
  variables: ThemePresentationVariables,
): void => {
  THEME_PRESENTATION_VARIABLE_NAMES.forEach(property => {
    const value = variables[property];
    if (value) style.setProperty(property, value);
    else style.removeProperty(property);
  });
};

export const applyThemePresentationAttributes = (
  target: ThemePresentationAttributeTarget,
  attributes: ThemePresentationAttributes,
): void => {
  THEME_PRESENTATION_ATTRIBUTE_NAMES.forEach(name => {
    const value = attributes[name];
    if (value) target.setAttribute(name, value);
    else target.removeAttribute(name);
  });
};

export const applyThemeFontFaces = (
  documentTarget: Pick<Document, 'head' | 'createElement' | 'getElementById'>,
  presentation: ResolvedThemePresentation,
): void => {
  documentTarget.getElementById(THEME_PRESENTATION_STYLE_ID)?.remove();
  const css = createThemeFontFaceCss(presentation);
  if (!css) return;
  const style = documentTarget.createElement('style');
  style.id = THEME_PRESENTATION_STYLE_ID;
  style.textContent = css;
  documentTarget.head.appendChild(style);
};

export const parseExportedThemeBranding = (value: unknown): ThemeBrandPresentation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_THEME_BRAND_PRESENTATION;
  const candidate = value as Record<string, unknown>;
  const displayName = typeof candidate.displayName === 'string' && candidate.displayName.trim().length <= 128
    ? candidate.displayName.trim()
    : DEFAULT_THEME_BRAND_PRESENTATION.displayName;
  const logoDataUrl = typeof candidate.logoDataUrl === 'string'
    && /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(candidate.logoDataUrl)
    ? candidate.logoDataUrl
    : undefined;
  return { displayName, ...(candidate.showDisplayName === false ? { showDisplayName: false } : {}), ...(logoDataUrl ? { logoDataUrl } : {}) };
};

export const parseExportedThemePresentationAttributes = (value: unknown): ThemePresentationAttributes => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Record<string, unknown>;
  return getRecipeAttributes({
    ...(SURFACE_RECIPE_VALUES.has(candidate.surfaceStyle as ThemeSurfaceRecipe)
      ? { surfaceStyle: candidate.surfaceStyle as ThemeSurfaceRecipe }
      : {}),
    ...(NODE_RECIPE_VALUES.has(candidate.nodeStyle as ThemeNodeRecipe)
      ? { nodeStyle: candidate.nodeStyle as ThemeNodeRecipe }
      : {}),
  });
};
