import { describe, expect, it } from 'vitest';
import appEntry from '../App.tsx?raw';
import appHeader from '../components/layout/Header.tsx?raw';
import themePreviewScenes from '../components/views/theme-studio/ThemePreviewScenes.tsx?raw';
import settingsDialog from '../components/dialogs/SettingsDialog.tsx?raw';
import powerViewModal from '../components/shared/PowerViewModal.tsx?raw';
import viewerEntry from '../export/viewer/main.tsx?raw';
import indexCssSource from './index.css?inline';
import journalCss from './features/journal.css?inline';
import omniboxCss from './features/omnibox.css?inline';
import pluginComposedViewCss from './features/plugin-composed-view.css?inline';
import portfolioChatCss from './features/portfolio-chat.css?inline';
import resourceCategoriesCss from './features/resource-categories.css?inline';
import settingsCss from './features/settings.css?inline';
import themeStudioCss from './features/theme-studio.css?inline';
import uiPrimitivesCss from './ui-primitives.css?inline';
import reactFlowCss from './react-flow.css?inline';
import themeRecipesCss from './theme-recipes.css?inline';
import viewerCss from '../export/viewer/viewer.css?inline';

// A clean Windows checkout may use CRLF; CSS semantics do not depend on EOL.
const indexCss = indexCssSource.replace(/\r\n/g, '\n');

describe('CSS entry-point architecture', () => {
    it('does not interpret opaque plugin control keys as presentation instructions', () => {
        expect(pluginComposedViewCss).not.toContain('data-plugin-control-key');
        expect(pluginComposedViewCss).not.toMatch(/axiom-(tasks|risks?)/);
    });
    it('loads app features before UI primitives and the React Flow adapter', () => {
        const sharedIndex = appEntry.indexOf('./styles/index.css');
        const featureSheets = [
            './styles/features/journal.css',
            './styles/features/omnibox.css',
            './styles/features/portfolio-chat.css',
            './styles/features/resource-categories.css',
            './styles/features/settings.css',
            './styles/features/theme-studio.css',
        ].map(path => appEntry.indexOf(path));
        const uiPrimitives = appEntry.indexOf('./styles/ui-primitives.css');

        expect(sharedIndex).toBeGreaterThan(-1);
        featureSheets.forEach(position => {
            expect(position).toBeGreaterThan(sharedIndex);
            expect(position).toBeLessThan(uiPrimitives);
        });
        const reactFlowAdapter = appEntry.indexOf('./styles/react-flow.css');
        const themeRecipes = appEntry.indexOf('./styles/theme-recipes.css');
        expect(reactFlowAdapter).toBeGreaterThan(uiPrimitives);
        expect(themeRecipes).toBeGreaterThan(reactFlowAdapter);
    });

    it('preserves the standalone viewer cascade order', () => {
        const sharedIndex = viewerEntry.indexOf('../../styles/index.css');
        const uiPrimitives = viewerEntry.indexOf('../../styles/ui-primitives.css');
        const reactFlowAdapter = viewerEntry.indexOf('../../styles/react-flow.css');
        const viewerOverrides = viewerEntry.indexOf('./viewer.css');
        const themeRecipes = viewerEntry.indexOf('../../styles/theme-recipes.css');

        expect(sharedIndex).toBeGreaterThan(-1);
        expect(uiPrimitives).toBeGreaterThan(sharedIndex);
        expect(reactFlowAdapter).toBeGreaterThan(uiPrimitives);
        expect(viewerOverrides).toBeGreaterThan(reactFlowAdapter);
        expect(themeRecipes).toBeGreaterThan(viewerOverrides);
        expect(viewerEntry).not.toContain('../../styles/features/');
        expect(viewerCss).toContain('font-family: var(--font-family-ui');
    });

    it('keeps app feature styling in dedicated sheets', () => {
        const featureSelectors = [
            ['.nemoto-journal-topbar {', journalCss],
            ['.nemoto-suggestion-item[aria-selected=', journalCss],
            ['.nemoto-omnibox-modal {', omniboxCss],
            ["[data-theme='hard'] .nemoto-portfolio-chat {", portfolioChatCss],
            ['.nemoto-category-sidebar {', resourceCategoriesCss],
            ['.nemoto-settings-nav {', settingsCss],
            ['.theme-studio-preview-target {', themeStudioCss],
        ] as const;

        featureSelectors.forEach(([selector, owner]) => {
            expect(indexCss).not.toContain(selector);
            expect(owner).toContain(selector);
        });
    });

    it('keeps composed plugin layouts responsive and theme-token driven', () => {
        expect(pluginComposedViewCss).toContain('.plugin-composed-grid-compact-1 {');
        expect(pluginComposedViewCss).toContain('@media (min-width: 48rem)');
        expect(pluginComposedViewCss).toContain('var(--color-app-bg)');
        expect(pluginComposedViewCss).toContain('var(--color-accent-danger)');
        expect(pluginComposedViewCss).not.toContain('[data-theme=');
    });

    it('keeps shared React primitive styling in its dedicated sheet', () => {
        const primitiveSelectors = [
            '.nemoto-button {',
            '.nemoto-dialog-panel {',
            '.nemoto-segmented {',
            '.nemoto-menu-item {',
        ];

        primitiveSelectors.forEach(selector => {
            expect(indexCss).not.toContain(selector);
            expect(uiPrimitivesCss).toContain(selector);
        });

        expect(indexCss).not.toMatch(/(?:^|\n)\.floating-dock \.dock-button \{/);
        expect(uiPrimitivesCss).toMatch(/(?:^|\n)\.floating-dock \.dock-button \{/);
    });

    it('lets bounded menu lists override the base menu overflow clipping', () => {
        const baseMenuRule = uiPrimitivesCss.indexOf('.nemoto-file-menu,');
        const scrollMenuRule = uiPrimitivesCss.indexOf('.nemoto-scroll-menu {');

        expect(baseMenuRule).toBeGreaterThan(-1);
        expect(scrollMenuRule).toBeGreaterThan(baseMenuRule);
        expect(uiPrimitivesCss.slice(scrollMenuRule)).toContain('overflow-y: auto;');
        expect(uiPrimitivesCss.slice(scrollMenuRule)).toContain('scrollbar-gutter: stable;');
        expect(uiPrimitivesCss).toContain('.theme-color-swatch {');
    });

    it('keeps external React Flow overrides out of the shared design-system sheet', () => {
        expect(indexCss).not.toContain('.react-flow__viewport .react-flow__handle');
        expect(reactFlowCss).toContain('.react-flow__viewport .react-flow__handle');
        expect(reactFlowCss).toContain('.gravity-well-graph .react-flow__handle');
        expect(reactFlowCss).toContain("[data-theme='void'] .react-flow__node.selected");
    });

    it('keeps declarative surface and node recipes in the final shared cascade layer', () => {
        expect(themeRecipesCss).toContain('[data-theme-surface-style]');
        expect(themeRecipesCss).toContain('[data-theme-node-style]');
        expect(themeRecipesCss).not.toContain("[data-theme='void']");
        expect(themeRecipesCss).not.toContain("[data-theme='soft']");
        expect(themeRecipesCss).not.toContain("[data-theme='hard']");
    });

    it('uses production panel semantics in the Theme Studio application preview', () => {
        expect(themePreviewScenes).toContain('nemoto-panel nemoto-side-panel');
        expect(themePreviewScenes).toContain('nemoto-panel nemoto-inspector-panel');
        expect(themePreviewScenes).toContain('nemoto-panel-body');
        expect(themePreviewScenes).toContain('nemoto-panel-section');
    });

    it('scopes Polar header elevation to the application header', () => {
        expect(appHeader).toContain('nemoto-app-header');
        expect(indexCss).toContain("[data-theme='soft'] .nemoto-app-header");
        expect(indexCss).not.toMatch(/\[data-theme='soft'\]\s+header(?:\s|,|\{)/);
        expect(indexCss.match(/\[data-theme='soft'\] button:not\(\.nemoto-field\)/g)).toHaveLength(2);
    });

    it('keeps Polar nodes raised while interactions add glow without inset shadows', () => {
        expect(indexCss).toContain("[data-theme='soft'] .react-flow__node .shape-resource");
        expect(indexCss).toContain("[data-theme='soft'] .react-flow__node:hover .shape-resource");
        expect(indexCss).toContain("[data-theme='soft'] .react-flow__node.selected .shape-resource");
        expect(indexCss).toContain('box-shadow: var(--app-shadow-md) !important');
        expect(indexCss).toContain('var(--app-shadow-md),\n    0 0 16px -2px var(--node-glow-color) !important');
        expect(indexCss).toContain('0 0 0 3px var(--color-app-bg)');
        expect(indexCss).toContain('0 0 0 5.5px var(--node-accent-color');
        expect(indexCss).toContain('0 0 20px 2px var(--node-glow-color) !important');
        expect(indexCss).toContain("[data-theme='soft'] .react-flow__node.selected {\n  z-index: 30 !important;");
        expect(indexCss).not.toContain("[data-theme='soft'] .react-flow__node[data-id]:hover .clip-chamfer .clip-chamfer");
        const hoverRules = indexCss.slice(
            indexCss.indexOf("[data-theme='soft'] .react-flow__node:hover .shape-rect"),
            indexCss.indexOf("[data-theme='soft'] .react-flow__node.selected {"),
        );
        expect(hoverRules).not.toContain('inset');
        expect(indexCss).not.toContain('border: 1.5px solid var(--node-accent-color');
    });

    it('keeps global settings and power views on the shared dialog layer', () => {
        expect(settingsDialog).not.toContain('rootClassName="z-50"');
        expect(powerViewModal).toContain('fixed inset-0 z-[10100]');
    });

    it('keeps Theme Studio panel collapse and compact-window behavior in its feature sheet', () => {
        expect(themeStudioCss).toContain('.theme-studio-layout {');
        expect(themeStudioCss).toContain("[data-elements-panel='closed']");
        expect(themeStudioCss).toContain("[data-inspector-panel='closed']");
        expect(themeStudioCss).toContain('@media (max-width: 1179px)');
        expect(themeStudioCss).toContain('--theme-studio-elements-width: 64px');
        expect(themeStudioCss).toContain('.theme-studio-element-description {');
        expect(themeStudioCss).toContain('.theme-studio-color-picker {');
        expect(themeStudioCss).toContain('.theme-studio-color-picker:focus-within {');
        expect(themeStudioCss).toContain('width: var(--theme-rail-button-size, 2rem)');
        expect(themeStudioCss).toContain('padding: var(--theme-dock-padding, 0.45rem 0.7rem)');
        expect(themeStudioCss).toContain('width: var(--theme-dock-button-size, 2.5rem)');
    });

    it('uses one motion scale and preserves reduced-motion support', () => {
        expect(indexCss).toContain('--motion-duration-fast: 120ms');
        expect(indexCss).toContain('--motion-duration-slow: 240ms');
        expect(indexCss).toContain('--motion-ease-enter: cubic-bezier(0.16, 1, 0.3, 1)');
        expect(indexCss).toContain('@media (prefers-reduced-motion: reduce)');
        expect(uiPrimitivesCss).not.toContain('transition: all');
        expect(reactFlowCss).not.toContain('transition: all');
    });
});
