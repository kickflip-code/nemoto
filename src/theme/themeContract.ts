export type BuiltInThemeId = 'void' | 'soft' | 'hard';
export type ThemePresetId = 'void' | 'polar' | 'brutalist';
export type ThemeVariableType = 'color' | 'length';
export type ThemeTokenMap = Record<string, string>;

export type ThemeVariableCategoryId =
  | 'backgrounds'
  | 'interactive'
  | 'controls'
  | 'navigation'
  | 'text'
  | 'accents'
  | 'nodes'
  | 'geometry';

export interface ThemeVariableDefinition {
  name: string;
  label: string;
  type: ThemeVariableType;
  description?: string;
}

export interface ThemeVariableCategory {
  id: ThemeVariableCategoryId;
  label: string;
  shortLabel: string;
}

export interface ThemeBranding {
  /** Legacy v1 reference. V2 themes use logoAssetId for offline portability. */
  logoUrl?: string;
  logoAssetId?: string;
  displayName?: string;
  showDisplayName?: boolean;
  fontFamily?: string;
}

export interface ThemeEmbeddedAsset extends Record<string, unknown> {
  mediaType: 'image/png' | 'image/webp' | 'font/woff2';
  data: string;
  sha256: string;
}

export interface ThemeTypography extends Record<string, unknown> {
  /** Human-readable family name. Rendering uses only referenced embedded WOFF2 assets. */
  fontFamily?: string;
  regularAssetId?: string;
  mediumAssetId?: string;
  boldAssetId?: string;
}

export type ThemeDensityRecipe = 'compact' | 'comfortable' | 'spacious';
export type ThemeCornerRecipe = 'square' | 'soft' | 'rounded';
export type ThemeElevationRecipe = 'flat' | 'subtle' | 'raised' | 'graphic';
export type ThemeControlRecipe = 'flat' | 'outlined' | 'raised' | 'graphic';
export type ThemeSurfaceRecipe = 'solid' | 'layered' | 'translucent';
export type ThemeNodeRecipe = 'minimal' | 'outlined' | 'raised' | 'graphic';

/**
 * Declarative, Core-owned visual recipes. Unknown keys remain portable but are
 * inert until a future Core version defines their rendering semantics.
 */
export interface ThemeRecipes extends Record<string, unknown> {
  density?: ThemeDensityRecipe;
  cornerStyle?: ThemeCornerRecipe;
  elevation?: ThemeElevationRecipe;
  controlStyle?: ThemeControlRecipe;
  surfaceStyle?: ThemeSurfaceRecipe;
  nodeStyle?: ThemeNodeRecipe;
}

export const THEME_VARIABLE_CATEGORIES: ThemeVariableCategory[] = [
  { id: 'backgrounds', label: 'Backgrounds', shortLabel: 'Bg' },
  { id: 'interactive', label: 'Interface', shortLabel: 'UI' },
  { id: 'controls', label: 'Controls', shortLabel: 'Controls' },
  { id: 'navigation', label: 'Navigation & Dock', shortLabel: 'Nav' },
  { id: 'text', label: 'Text', shortLabel: 'Text' },
  { id: 'accents', label: 'Accents', shortLabel: 'Accent' },
  { id: 'nodes', label: 'Nodes', shortLabel: 'Node' },
  { id: 'geometry', label: 'Geometry', shortLabel: 'Geom' },
];

export const THEME_VARIABLES: Record<ThemeVariableCategoryId, ThemeVariableDefinition[]> = {
  backgrounds: [
    { name: '--color-app-bg', label: 'Canvas Background', type: 'color' },
    { name: '--color-app-sidebar', label: 'Sidebar Background', type: 'color' },
    { name: '--color-app-surface', label: 'Surface Background', type: 'color' },
    { name: '--color-app-header', label: 'Header Background', type: 'color' },
    { name: '--color-app-grid', label: 'Canvas Grid', type: 'color' },
    { name: '--color-canvas-edge', label: 'Canvas Edge', type: 'color' },
  ],
  interactive: [
    { name: '--color-app-border', label: 'Border Color', type: 'color' },
    { name: '--color-app-input', label: 'Input Background', type: 'color' },
    { name: '--color-app-hover', label: 'Hover State', type: 'color' },
    { name: '--color-app-active', label: 'Active State', type: 'color' },
  ],
  controls: [
    { name: '--color-control-bg', label: 'Button Background', type: 'color' },
    { name: '--color-control-text', label: 'Button Text', type: 'color' },
    { name: '--color-control-border', label: 'Button Border', type: 'color' },
    { name: '--color-control-hover', label: 'Button Hover', type: 'color' },
    { name: '--color-control-active', label: 'Button Active', type: 'color' },
    { name: '--color-control-primary-bg', label: 'Primary Button Background', type: 'color' },
    { name: '--color-control-primary-text', label: 'Primary Button Text', type: 'color' },
    { name: '--color-field-bg', label: 'Field Background', type: 'color' },
    { name: '--color-field-text', label: 'Field Text', type: 'color' },
    { name: '--color-field-border', label: 'Field Border', type: 'color' },
    { name: '--color-menu-bg', label: 'Menu Background', type: 'color' },
    { name: '--color-menu-text', label: 'Menu Text', type: 'color' },
    { name: '--color-menu-border', label: 'Menu Border', type: 'color' },
    { name: '--color-menu-hover', label: 'Menu Hover', type: 'color' },
    { name: '--color-menu-separator', label: 'Menu Separator', type: 'color' },
  ],
  navigation: [
    { name: '--color-rail-bg', label: 'Rail Background', type: 'color' },
    { name: '--color-rail-button-text', label: 'Rail Button Text', type: 'color' },
    { name: '--color-rail-button-hover', label: 'Rail Button Hover', type: 'color' },
    { name: '--color-rail-button-active-bg', label: 'Rail Button Active Background', type: 'color' },
    { name: '--color-rail-button-active-text', label: 'Rail Button Active Text', type: 'color' },
    { name: '--color-dock-bg', label: 'Dock Background', type: 'color' },
    { name: '--color-dock-border', label: 'Dock Border', type: 'color' },
    { name: '--color-dock-button-bg', label: 'Dock Button Background', type: 'color' },
    { name: '--color-dock-button-text', label: 'Dock Button Text', type: 'color' },
    { name: '--color-dock-button-hover', label: 'Dock Button Hover', type: 'color' },
    { name: '--color-dock-button-active-bg', label: 'Dock Button Active Background', type: 'color' },
    { name: '--color-dock-button-active-text', label: 'Dock Button Active Text', type: 'color' },
    { name: '--color-dock-divider', label: 'Dock Divider', type: 'color' },
  ],
  text: [
    { name: '--color-text-main', label: 'Primary Text', type: 'color' },
    { name: '--color-text-muted', label: 'Secondary Text', type: 'color' },
    { name: '--color-text-faint', label: 'Faint/Tertiary Text', type: 'color' },
  ],
  accents: [
    { name: '--color-accent-primary', label: 'Primary Accent', type: 'color' },
    { name: '--color-accent-primary-text', label: 'Primary Accent Text', type: 'color' },
    { name: '--color-accent-success', label: 'Success Accent', type: 'color' },
    { name: '--color-accent-warning', label: 'Warning Accent', type: 'color' },
    { name: '--color-accent-danger', label: 'Danger Accent', type: 'color' },
    { name: '--color-accent-purple', label: 'Purple Accent', type: 'color' },
    { name: '--color-accent-neutral', label: 'Neutral Accent', type: 'color' },
  ],
  nodes: [
    { name: '--palette-gray', label: 'Decision Node', type: 'color' },
    { name: '--palette-white', label: 'Light Node', type: 'color' },
    { name: '--palette-white-text', label: 'Light Node Text', type: 'color' },
    { name: '--palette-blue', label: 'Action Node', type: 'color' },
    { name: '--palette-green', label: 'Start Node', type: 'color' },
    { name: '--palette-purple', label: 'System Node', type: 'color' },
    { name: '--palette-orange', label: 'Orange', type: 'color' },
    { name: '--palette-red', label: 'End Node', type: 'color' },
    { name: '--palette-amber', label: 'Note Node', type: 'color' },
    { name: '--color-node-event-bg', label: 'Event Node Background', type: 'color' },
    { name: '--color-node-event-border', label: 'Event Node Border', type: 'color' },
    { name: '--color-node-event-text', label: 'Event Node Text', type: 'color' },
    { name: '--color-node-event-accent', label: 'Event Node Accent', type: 'color' },
  ],
  geometry: [
    { name: '--app-radius-sm', label: 'Corner Radius (Small)', type: 'length' },
    { name: '--app-radius-md', label: 'Corner Radius (Medium)', type: 'length' },
    { name: '--app-radius-lg', label: 'Corner Radius (Large)', type: 'length' },
    { name: '--app-radius-node', label: 'Node Radius', type: 'length' },
    { name: '--app-border-width', label: 'Border Width (Panels)', type: 'length' },
    { name: '--app-node-border-width', label: 'Border Width (Nodes)', type: 'length' },
  ],
};

export const ALL_THEME_VARIABLES = THEME_VARIABLE_CATEGORIES.flatMap(
  category => THEME_VARIABLES[category.id],
);

export const ALL_THEME_VARIABLE_NAMES = ALL_THEME_VARIABLES.map(variable => variable.name);

export const THEME_VARIABLE_NAME_SET = new Set(ALL_THEME_VARIABLE_NAMES);

export const isThemeVariableName = (name: string): boolean => THEME_VARIABLE_NAME_SET.has(name);

export const normalizeThemeTokens = (
  tokens: Record<string, unknown> | null | undefined,
  fallback: ThemeTokenMap = {},
): ThemeTokenMap => {
  const normalized: ThemeTokenMap = { ...fallback };

  if (!tokens || typeof tokens !== 'object') {
    return normalized;
  }

  Object.entries(tokens).forEach(([name, value]) => {
    if (isThemeVariableName(name) && typeof value === 'string' && value.trim()) {
      normalized[name] = value.trim();
    }
  });

  return normalized;
};
