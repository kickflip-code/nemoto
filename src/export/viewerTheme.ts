import {
    ALL_THEME_VARIABLE_NAMES,
    type BuiltInThemeId,
    type ThemeTokenMap,
} from '../theme/themeContract';
import { THEME_PRESENTATION_VARIABLE_NAMES } from '../theme/themePresentation';

const BUILT_IN_VIEWER_THEMES = new Set<BuiltInThemeId>(['void', 'soft', 'hard']);

const VIEWER_PRESENTATION_VARIABLE_NAMES = [
    ...THEME_PRESENTATION_VARIABLE_NAMES,
    '--app-shadow-sm',
    '--app-shadow-md',
    '--app-shadow-lg',
    '--app-shadow-xl',
    '--app-shadow-inset',
    '--app-shadow-active',
    '--control-shadow',
    '--control-active-shadow',
    '--control-active-transform',
    '--control-radius',
    '--control-border-width',
    '--field-shadow',
    '--field-focus-shadow',
    '--menu-shadow',
    '--menu-hover-shadow',
    '--dialog-shadow',
    '--dock-fill',
    '--dot-grid',
    '--polar-bg',
    '--polar-white',
    '--polar-shadow-dark',
    '--polar-shadow-light',
    '--color-accent-primary-glow',
    '--color-accent-danger-dim',
    '--color-accent-neutral-text',
    '--color-accent-purple-text',
    '--color-accent-success-text',
] as const;

const normalizeBuiltInTheme = (value: unknown): BuiltInThemeId | null => {
    if (typeof value !== 'string') return null;
    if (BUILT_IN_VIEWER_THEMES.has(value as BuiltInThemeId)) return value as BuiltInThemeId;
    if (value === 'polar') return 'soft';
    if (value === 'brutalist') return 'hard';
    return null;
};

export const resolveViewerRuntimeThemeId = (
    exportedTheme: unknown,
    customThemes: Array<{ id?: unknown }> = [],
): string => {
    if (typeof exportedTheme === 'string') {
        const isExportedCustomTheme = customThemes.some((theme) => theme.id === exportedTheme);
        if (isExportedCustomTheme) return exportedTheme;

        return normalizeBuiltInTheme(exportedTheme) || exportedTheme;
    }

    return 'void';
};

export const resolveViewerThemeId = (
    activeCustomBaseTheme: unknown,
    renderedTheme: string | null | undefined,
    storedTheme: unknown,
): string => {
    return normalizeBuiltInTheme(activeCustomBaseTheme)
        || normalizeBuiltInTheme(renderedTheme)
        || normalizeBuiltInTheme(storedTheme)
        || 'void';
};

export const captureRenderedThemeTokens = (
    computedStyle: Pick<CSSStyleDeclaration, 'getPropertyValue'> & Partial<Pick<CSSStyleDeclaration, 'item' | 'length'>>,
): ThemeTokenMap => {
    const properties = new Set<string>([
        ...ALL_THEME_VARIABLE_NAMES,
        ...VIEWER_PRESENTATION_VARIABLE_NAMES,
    ]);
    const propertyCount = typeof computedStyle.length === 'number' ? computedStyle.length : 0;

    if (computedStyle.item) {
        for (let index = 0; index < propertyCount; index += 1) {
            const property = computedStyle.item(index);
            if (property.startsWith('--')) properties.add(property);
        }
    }

    return Object.fromEntries(
        [...properties]
            .map((property) => [property, computedStyle.getPropertyValue(property).trim()] as const)
            .filter(([, value]) => value.length > 0),
    );
};

const escapeCssAttributeValue = (value: string): string => value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n\f]/g, ' ');

const isSafeCssValue = (value: string): boolean => !/[;{}<>]/.test(value);

export const createCustomViewerThemeCss = (themeId: string, tokens: ThemeTokenMap): string => {
    const declarations = Object.entries(tokens)
        .filter(([property, value]) => /^--[a-z0-9-]+$/.test(property) && isSafeCssValue(value))
        .map(([property, value]) => `    ${property}: ${value};`)
        .join('\n');

    return `[data-theme='${escapeCssAttributeValue(themeId)}'] {\n${declarations}\n}`;
};

export const appendViewerThemeStyles = (viewerTemplate: string, dynamicCss: string): string => {
    const style = `    <style id="nemoto-dynamic-themes">\n${dynamicCss}\n    </style>\n`;
    const headCloseIndex = viewerTemplate.lastIndexOf('</head>');

    if (headCloseIndex === -1) return `${style}${viewerTemplate}`;

    return `${viewerTemplate.slice(0, headCloseIndex)}${style}${viewerTemplate.slice(headCloseIndex)}`;
};
