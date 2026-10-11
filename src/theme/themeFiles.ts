import type { ThemeConfig } from '../types';
import {
  ALL_THEME_VARIABLES,
  isThemeVariableName,
  normalizeThemeTokens,
  type ThemeBranding,
  type ThemeEmbeddedAsset,
  type ThemePresetId,
  type ThemeRecipes,
  type ThemeTokenMap,
  type ThemeTypography,
} from './themeContract';
import { DEFAULT_THEME_PRESET_ID, getPresetTokens, isThemePresetId } from './presets';

export const THEME_FILE_SCHEMA = 'axiom.theme';
export const LEGACY_THEME_FILE_VERSION = 1;
export const THEME_FILE_VERSION = 2;
export const THEME_FILE_EXTENSION = 'axiom-theme.json';
export const MAX_THEME_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_THEME_EXTENSIONS_BYTES = 256 * 1024;
export const MAX_THEME_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_THEME_ASSETS_BYTES = 5 * 1024 * 1024;

// Theme schema v2 is extensible. These Core tokens were introduced after the
// original v2 baseline and are defaulted only for older v2 documents.
const V2_COMPATIBLE_DEFAULT_TOKENS = new Set([
  '--color-node-event-bg',
  '--color-node-event-border',
  '--color-node-event-text',
  '--color-node-event-accent',
  '--palette-white-text',
]);

const THEME_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const THEME_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,126}[a-z0-9])?$/;
const SAFE_LENGTH_PATTERN = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))$/i;
const SAFE_COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|transparent|currentcolor|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\([0-9a-zA-Z#.,%+\-/*\s]+\))$/i;
const FORBIDDEN_CSS_VALUE_PATTERN = /[;{}@]|url\s*\(|expression\s*\(|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/i;
const ALLOWED_ASSET_MEDIA_TYPES = new Set(['image/png', 'image/webp', 'font/woff2']);
const THEME_TOKEN_NAME_PATTERN = /^--[a-z0-9-]+$/;
const EXTENSION_NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export interface AxiomThemeFile extends Record<string, unknown> {
  schema: typeof THEME_FILE_SCHEMA;
  version: typeof THEME_FILE_VERSION;
  id: string;
  themeVersion: string;
  label: string;
  description?: string;
  basePresetId: ThemePresetId;
  tokens: ThemeTokenMap;
  brand?: ThemeBranding;
  typography?: ThemeTypography;
  assets?: Record<string, ThemeEmbeddedAsset>;
  recipes?: ThemeRecipes;
  extensions?: Record<string, unknown>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const cloneJsonObject = (value: Record<string, unknown>): Record<string, unknown> => (
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>
);

const getJsonByteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const assertBoundedString = (
  value: unknown,
  field: string,
  maximumLength: number,
  required = false,
): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) {
    throw new Error(`${field} must be ${required ? 'a non-empty' : 'a'} string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new Error(`${field} exceeds ${maximumLength} characters.`);
  }
  return normalized;
};

export const isValidThemeId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length >= 3
  && THEME_ID_PATTERN.test(value)
  && !value.includes('..')
);

export const createThemeId = (label: string): string => {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'theme';
  const randomPart = globalThis.crypto?.randomUUID?.().slice(0, 8)
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${slug}-${randomPart}`;
};

const assertSafeThemeToken = (name: string, value: unknown): string => {
  if (!THEME_TOKEN_NAME_PATTERN.test(name)) {
    throw new Error(`Theme token name ${name} is not a portable CSS custom property.`);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Theme token ${name} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > 256 || FORBIDDEN_CSS_VALUE_PATTERN.test(normalized)) {
    throw new Error(`Theme token ${name} contains an unsafe or oversized CSS value.`);
  }

  const definition = ALL_THEME_VARIABLES.find(variable => variable.name === name);
  if (definition?.type === 'length' && !SAFE_LENGTH_PATTERN.test(normalized)) {
    throw new Error(`Theme token ${name} must be a non-negative CSS length.`);
  }
  if (definition?.type === 'color' && !SAFE_COLOR_PATTERN.test(normalized)) {
    throw new Error(`Theme token ${name} must be a self-contained CSS color.`);
  }
  return normalized;
};

const assertOptionalObject = (value: unknown, field: string): Record<string, unknown> | undefined => {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error(`${field} must be a JSON object.`);
  return value;
};

const validateAssets = (value: unknown): void => {
  if (value === undefined) return;
  const assets = assertOptionalObject(value, 'assets')!;
  let totalBytes = 0;

  Object.entries(assets).forEach(([assetId, candidate]) => {
    if (!isValidThemeId(assetId) || !isPlainObject(candidate)) {
      throw new Error(`Theme asset ${assetId} has an invalid ID or payload.`);
    }
    if (!ALLOWED_ASSET_MEDIA_TYPES.has(String(candidate.mediaType))) {
      throw new Error(`Theme asset ${assetId} uses an unsupported media type.`);
    }
    if (
      typeof candidate.data !== 'string'
      || candidate.data.length === 0
      || candidate.data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(candidate.data)
    ) {
      throw new Error(`Theme asset ${assetId} must contain base64 data.`);
    }
    if (typeof candidate.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(candidate.sha256)) {
      throw new Error(`Theme asset ${assetId} must contain a SHA-256 digest.`);
    }
    const paddingBytes = candidate.data.endsWith('==') ? 2 : candidate.data.endsWith('=') ? 1 : 0;
    const decodedBytes = Math.floor(candidate.data.length * 3 / 4) - paddingBytes;
    if (decodedBytes > MAX_THEME_ASSET_BYTES) {
      throw new Error(`Theme asset ${assetId} exceeds the 2 MiB limit.`);
    }
    totalBytes += decodedBytes;
  });

  if (totalBytes > MAX_THEME_ASSETS_BYTES) {
    throw new Error('Theme assets exceed the 5 MiB combined limit.');
  }
};

const validateStructuredFields = (value: Record<string, unknown>): void => {
  const assets = isPlainObject(value.assets) ? value.assets : {};
  const assertAssetReference = (assetId: unknown, field: string, expectedPrefix: string): void => {
    if (assetId === undefined) return;
    if (!isValidThemeId(assetId)) throw new Error(`${field} must be a valid asset ID.`);
    const asset = assets[assetId];
    if (!isPlainObject(asset) || typeof asset.mediaType !== 'string' || !asset.mediaType.startsWith(expectedPrefix)) {
      throw new Error(`${field} must reference an embedded ${expectedPrefix.replace('/', '')} asset.`);
    }
  };

  const brand = assertOptionalObject(value.brand, 'brand');
  if (brand) {
    if (brand.showDisplayName !== undefined && typeof brand.showDisplayName !== 'boolean') throw new Error('brand.showDisplayName must be a boolean.');
    assertBoundedString(brand.displayName, 'brand.displayName', 128);
    assertBoundedString(brand.fontFamily, 'brand.fontFamily', 256);
    assertBoundedString(brand.logoUrl, 'brand.logoUrl', 2_048);
    assertAssetReference(brand.logoAssetId, 'brand.logoAssetId', 'image/');
  }

  const typography = assertOptionalObject(value.typography, 'typography');
  if (typography) {
    assertBoundedString(typography.fontFamily, 'typography.fontFamily', 256);
    ['regularAssetId', 'mediumAssetId', 'boldAssetId'].forEach(field => {
      assertAssetReference(typography[field], `typography.${field}`, 'font/');
    });
  }

  const recipes = assertOptionalObject(value.recipes, 'recipes');
  if (recipes) {
    const allowedValues: Record<string, ReadonlySet<string>> = {
      density: new Set(['compact', 'comfortable', 'spacious']),
      cornerStyle: new Set(['square', 'soft', 'rounded']),
      elevation: new Set(['flat', 'subtle', 'raised', 'graphic']),
      controlStyle: new Set(['flat', 'outlined', 'raised', 'graphic']),
      surfaceStyle: new Set(['solid', 'layered', 'translucent']),
      nodeStyle: new Set(['minimal', 'outlined', 'raised', 'graphic']),
    };
    Object.entries(allowedValues).forEach(([field, allowed]) => {
      const candidate = recipes[field];
      if (candidate !== undefined && (typeof candidate !== 'string' || !allowed.has(candidate))) {
        throw new Error(`recipes.${field} has an unsupported value.`);
      }
    });
  }

  const extensions = assertOptionalObject(value.extensions, 'extensions');
  if (extensions) {
    Object.keys(extensions).forEach(namespace => {
      if (!EXTENSION_NAMESPACE_PATTERN.test(namespace)) {
        throw new Error(`Theme extension ${namespace} must use a reverse-domain namespace.`);
      }
    });
  }
};

const validateV2ThemeFile = (value: Record<string, unknown>): AxiomThemeFile => {
  if (value.schema !== THEME_FILE_SCHEMA) {
    throw new Error(`Unsupported theme schema: ${String(value.schema)}.`);
  }
  if (value.version !== THEME_FILE_VERSION) {
    throw new Error(`Unsupported theme version: ${String(value.version)}.`);
  }
  if (!isValidThemeId(value.id)) {
    throw new Error('Theme id must be a portable lowercase identifier (3-128 characters).');
  }
  if (typeof value.themeVersion !== 'string' || !THEME_VERSION_PATTERN.test(value.themeVersion)) {
    throw new Error('themeVersion must be a semantic version such as 1.0.0.');
  }

  const label = assertBoundedString(value.label, 'label', 128, true)!;
  const description = assertBoundedString(value.description, 'description', 2_000);
  if (!isThemePresetId(value.basePresetId)) {
    throw new Error(`Unsupported basePresetId: ${String(value.basePresetId)}.`);
  }
  if (!isPlainObject(value.tokens)) throw new Error('Missing theme tokens.');

  const tokens: ThemeTokenMap = {};
  Object.entries(value.tokens).forEach(([name, tokenValue]) => {
    const normalized = assertSafeThemeToken(name, tokenValue);
    tokens[name] = isThemeVariableName(name) ? normalized : tokenValue as string;
  });
  const baselineTokens = getPresetTokens(value.basePresetId);
  V2_COMPATIBLE_DEFAULT_TOKENS.forEach(name => {
    if (!(name in tokens) && baselineTokens[name]) tokens[name] = baselineTokens[name];
  });
  ALL_THEME_VARIABLES.forEach(({ name }) => {
    if (!(name in tokens)) throw new Error(`Theme file is missing required token ${name}.`);
  });

  assertOptionalObject(value.recipes, 'recipes');
  const extensions = assertOptionalObject(value.extensions, 'extensions');
  if (extensions && getJsonByteLength(extensions) > MAX_THEME_EXTENSIONS_BYTES) {
    throw new Error('Theme extensions exceed the 256 KiB limit.');
  }
  validateAssets(value.assets);
  validateStructuredFields(value);
  if (getJsonByteLength(value) > MAX_THEME_FILE_BYTES) {
    throw new Error('Theme file exceeds the 8 MiB limit.');
  }

  return {
    ...cloneJsonObject(value),
    schema: THEME_FILE_SCHEMA,
    version: THEME_FILE_VERSION,
    id: value.id,
    themeVersion: value.themeVersion,
    label,
    ...(description ? { description } : {}),
    basePresetId: value.basePresetId,
    tokens,
  } as AxiomThemeFile;
};

const migrateV1ThemeFile = (value: Record<string, unknown>): AxiomThemeFile => {
  if (value.schema !== undefined && value.schema !== THEME_FILE_SCHEMA) {
    throw new Error(`Unsupported theme schema: ${String(value.schema)}.`);
  }
  const version = value.version ?? LEGACY_THEME_FILE_VERSION;
  if (version !== LEGACY_THEME_FILE_VERSION) {
    throw new Error(`Unsupported theme version: ${String(version)}.`);
  }

  const label = assertBoundedString(value.label, 'label', 128, true)!;
  const basePresetId = value.basePresetId == null
    ? DEFAULT_THEME_PRESET_ID
    : value.basePresetId;
  if (!isThemePresetId(basePresetId)) {
    throw new Error(`Unsupported basePresetId: ${String(basePresetId)}.`);
  }

  const legacyTokens = isPlainObject(value.tokens) ? value.tokens : undefined;
  const legacyColors = isPlainObject(value.colors) ? value.colors : undefined;
  if (!legacyTokens && !legacyColors) throw new Error('Missing theme tokens.');
  const legacyAliasesMatch = legacyTokens && legacyColors
    ? Object.keys(legacyTokens).length === Object.keys(legacyColors).length
      && Object.entries(legacyTokens).every(([name, tokenValue]) => legacyColors[name] === tokenValue)
    : true;
  if (!legacyAliasesMatch) {
    throw new Error('Legacy theme contains conflicting tokens and colors objects.');
  }
  const sourceTokens = legacyTokens || legacyColors!;
  const fallbackTokens = getPresetTokens(basePresetId);
  const completeTokens: Record<string, unknown> = { ...sourceTokens };
  const normalized = normalizeThemeTokens(sourceTokens, fallbackTokens);
  Object.entries(normalized).forEach(([name, tokenValue]) => {
    completeTokens[name] = tokenValue;
  });

  const migrated = cloneJsonObject(value);
  delete migrated.colors;
  migrated.schema = THEME_FILE_SCHEMA;
  migrated.version = THEME_FILE_VERSION;
  migrated.id = isValidThemeId(value.id) ? value.id : createThemeId(label);
  migrated.themeVersion = typeof value.themeVersion === 'string' && THEME_VERSION_PATTERN.test(value.themeVersion)
    ? value.themeVersion
    : '1.0.0';
  migrated.label = label;
  migrated.basePresetId = basePresetId;
  migrated.tokens = completeTokens;
  return validateV2ThemeFile(migrated);
};

export const parseThemeDocument = (value: unknown): AxiomThemeFile => {
  if (!isPlainObject(value)) throw new Error('Theme file must be a JSON object.');
  if (value.version === THEME_FILE_VERSION) return validateV2ThemeFile(value);
  if (value.version === undefined || value.version === LEGACY_THEME_FILE_VERSION) {
    return migrateV1ThemeFile(value);
  }
  throw new Error(`Unsupported theme version: ${String(value.version)}.`);
};

export const getThemeBasePresetId = (
  value: unknown,
  fallback: ThemePresetId | null = DEFAULT_THEME_PRESET_ID,
): ThemePresetId | null => {
  if (value === null) return null;
  return isThemePresetId(value) ? value : fallback;
};

export const getThemeConfigTokens = (
  theme: Pick<ThemeConfig, 'colors'> & { tokens?: ThemeTokenMap; basePresetId?: ThemeConfig['basePresetId'] },
): ThemeTokenMap => {
  const basePresetId = getThemeBasePresetId(theme.basePresetId, null);
  const fallbackTokens = basePresetId ? getPresetTokens(basePresetId) : {};
  return normalizeThemeTokens(theme.tokens || theme.colors, fallbackTokens);
};

export const themeFileToConfig = (document: AxiomThemeFile): ThemeConfig => {
  const fallback = document.basePresetId ? getPresetTokens(document.basePresetId) : {};
  const tokens = normalizeThemeTokens(document.tokens, fallback);
  return {
    id: document.id,
    label: document.label,
    basePresetId: document.basePresetId,
    colors: tokens,
    tokens: { ...tokens },
    brand: isPlainObject(document.brand) ? document.brand as ThemeBranding : undefined,
    typography: isPlainObject(document.typography) ? document.typography as ThemeTypography : undefined,
    assets: isPlainObject(document.assets) ? document.assets as Record<string, ThemeEmbeddedAsset> : undefined,
    recipes: isPlainObject(document.recipes) ? document.recipes as ThemeRecipes : undefined,
    extensions: isPlainObject(document.extensions) ? document.extensions : undefined,
    sourceDocument: cloneJsonObject(document),
  };
};

export const parseThemeFile = (value: unknown): ThemeConfig => themeFileToConfig(parseThemeDocument(value));

export const toThemeFile = (theme: ThemeConfig): AxiomThemeFile => {
  const source = isPlainObject(theme.sourceDocument)
    ? cloneJsonObject(theme.sourceDocument)
    : {};
  const existingTokens = isPlainObject(source.tokens) ? source.tokens : {};
  const projectedTokens = getThemeConfigTokens(theme);
  const tokens: Record<string, unknown> = { ...existingTokens };
  Object.entries(projectedTokens).forEach(([name, value]) => {
    tokens[name] = value;
  });

  delete source.colors;
  source.schema = THEME_FILE_SCHEMA;
  source.version = THEME_FILE_VERSION;
  source.id = theme.id;
  source.themeVersion = typeof source.themeVersion === 'string' ? source.themeVersion : '1.0.0';
  source.label = theme.label.trim() || 'Untitled Theme';
  source.basePresetId = getThemeBasePresetId(theme.basePresetId) || DEFAULT_THEME_PRESET_ID;
  source.tokens = tokens;
  if (theme.brand) source.brand = { ...(isPlainObject(source.brand) ? source.brand : {}), ...theme.brand };
  if (theme.typography) {
    source.typography = { ...(isPlainObject(source.typography) ? source.typography : {}), ...theme.typography };
  }
  if (theme.assets) {
    const sourceAssets = isPlainObject(source.assets) ? source.assets : {};
    source.assets = Object.fromEntries(Object.entries(theme.assets).map(([assetId, asset]) => [
      assetId,
      { ...(isPlainObject(sourceAssets[assetId]) ? sourceAssets[assetId] : {}), ...asset },
    ]));
  }
  if (theme.recipes) {
    source.recipes = { ...(isPlainObject(source.recipes) ? source.recipes : {}), ...theme.recipes };
  }
  if (theme.extensions) {
    source.extensions = { ...(isPlainObject(source.extensions) ? source.extensions : {}), ...theme.extensions };
  }
  return validateV2ThemeFile(source);
};

export const createThemeConfig = (
  label: string,
  basePresetId: ThemePresetId,
  id = createThemeId(label),
): ThemeConfig => {
  const tokens = getPresetTokens(basePresetId);
  return themeFileToConfig(validateV2ThemeFile({
    schema: THEME_FILE_SCHEMA,
    version: THEME_FILE_VERSION,
    id,
    themeVersion: '1.0.0',
    label: label.trim(),
    basePresetId,
    tokens,
  }));
};

export const createImportedThemeConfig = (value: unknown): ThemeConfig => parseThemeFile(value);

export const getThemeFileName = (label: string): string => {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safeLabel || 'axiom_theme'}.${THEME_FILE_EXTENSION}`;
};
