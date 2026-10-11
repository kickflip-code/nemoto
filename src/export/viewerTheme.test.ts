import { describe, expect, it } from 'vitest';
import { ALL_THEME_VARIABLE_NAMES, type ThemePresetId } from '../theme/themeContract';
import { getBuiltInThemeIdForPreset, getPresetTokens } from '../theme/presets';
import viewerCss from './viewer/viewer.css?inline';
import viewerSidebarSource from './viewer/ViewerSidebar.tsx?raw';
import viewerAppSource from './viewer/App.tsx?raw';
import {
    appendViewerThemeStyles,
    captureRenderedThemeTokens,
    createCustomViewerThemeCss,
    resolveViewerRuntimeThemeId,
    resolveViewerThemeId,
} from './viewerTheme';

describe('offline viewer theme export', () => {
    it.each<ThemePresetId>(['void', 'polar', 'brutalist'])(
        'serializes every public %s token from the authoritative manifest',
        presetId => {
            const tokens = getPresetTokens(presetId);
            const css = createCustomViewerThemeCss(
                getBuiltInThemeIdForPreset(presetId),
                tokens,
            );

            ALL_THEME_VARIABLE_NAMES.forEach(property => {
                expect(css).toContain(`${property}: ${tokens[property]};`);
            });
        },
    );

    it('uses the theme currently rendered by the app before a stale stored value', () => {
        expect(resolveViewerThemeId(null, 'soft', 'void')).toBe('soft');
        expect(resolveViewerThemeId(null, 'polar', 'void')).toBe('soft');
    });

    it('uses the base theme of an active custom theme for structural styling', () => {
        expect(resolveViewerThemeId('soft', 'void', 'void')).toBe('soft');
        expect(resolveViewerThemeId('polar', 'void', 'void')).toBe('soft');
    });

    it('normalizes legacy built-in names when the standalone viewer starts', () => {
        expect(resolveViewerRuntimeThemeId('polar')).toBe('soft');
        expect(resolveViewerRuntimeThemeId('brutalist')).toBe('hard');
        expect(resolveViewerRuntimeThemeId('void')).toBe('void');
        expect(resolveViewerRuntimeThemeId(undefined)).toBe('void');
    });

    it('does not reinterpret an exported custom theme that uses a legacy preset name', () => {
        expect(resolveViewerRuntimeThemeId('polar', [{ id: 'polar' }])).toBe('polar');
    });

    it('captures the theme tokens actually rendered by the application', () => {
        const renderedValues: Record<string, string> = {
            '--color-app-bg': '  rgb(228, 235, 245) ',
            '--color-text-main': 'rgb(43, 45, 66)',
            '--app-radius-node': '1.2rem',
            '--app-shadow-sm': '0.2rem 0.2rem 0.5rem #b8c3d8, -0.2rem -0.2rem 0.5rem #fff',
            '--polar-shadow-dark': '#b8c3d8',
            '--future-viewer-token': 'future-value',
        };

        expect(captureRenderedThemeTokens({
            length: 1,
            item: () => '--future-viewer-token',
            getPropertyValue: (property: string) => renderedValues[property] || '',
        })).toEqual({
            '--color-app-bg': 'rgb(228, 235, 245)',
            '--color-text-main': 'rgb(43, 45, 66)',
            '--app-radius-node': '1.2rem',
            '--app-shadow-sm': '0.2rem 0.2rem 0.5rem #b8c3d8, -0.2rem -0.2rem 0.5rem #fff',
            '--polar-shadow-dark': '#b8c3d8',
            '--future-viewer-token': 'future-value',
        });
    });

    it('writes custom themes directly in the shared semantic token vocabulary', () => {
        const css = createCustomViewerThemeCss('theme-polar-custom', {
            '--color-app-bg': '#E4EBF5',
            '--color-app-surface': '#FFFFFF',
            '--color-text-main': '#2b2d42',
        });

        expect(css).toContain("[data-theme='theme-polar-custom']");
        expect(css).toContain('--color-app-bg: #E4EBF5;');
        expect(css).toContain('--color-text-main: #2b2d42;');
        expect(css).not.toContain('--axiom-');
    });

    it('keeps viewer styling on the shared token vocabulary', () => {
        expect(viewerCss).toContain('var(--color-app-bg)');
        expect(viewerCss).toContain('var(--color-accent-primary)');
        expect(viewerCss).not.toContain('--axiom-');
        expect(viewerSidebarSource).not.toContain('--axiom-');
    });

    it('does not label the production standalone viewer as beta', () => {
        expect(viewerAppSource).not.toMatch(/>\s*Beta\s*</i);
    });

    it('places exported theme styles after the viewer bundle styles', () => {
        const html = '<html><head><script>const embeddedHtml = "<head></head>";</script><style id="viewer">:root { color: black; }</style></head><body></body></html>';
        const result = appendViewerThemeStyles(html, "[data-theme='soft'] { color: white; }");

        expect(result).toContain('<script>const embeddedHtml = "<head></head>";</script>');
        expect(result.indexOf('id="axiom-dynamic-themes"')).toBeGreaterThan(result.indexOf('id="viewer"'));
        expect(result.indexOf('id="axiom-dynamic-themes"')).toBeLessThan(result.lastIndexOf('</head>'));
    });
});
