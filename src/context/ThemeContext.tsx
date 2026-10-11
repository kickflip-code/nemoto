import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setActiveTheme as saveActiveTheme } from '../lib/tauri';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { BuiltInThemeId } from '../theme/themeContract';
import {
    getBuiltInThemeIdForPreset,
    getPresetTokens,
    getThemePresetIdForBuiltInTheme,
} from '../theme/presets';
import { getThemeBasePresetId, getThemeConfigTokens } from '../theme/themeFiles';
import { applyThemeTokens } from '../theme/themeRuntime';
import {
    applyThemeFontFaces,
    applyThemePresentationAttributes,
    applyThemePresentationVariables,
    DEFAULT_THEME_BRAND_PRESENTATION,
    resolveThemePresentation,
    type ThemeBrandPresentation,
} from '../theme/themePresentation';

export type ThemeId = BuiltInThemeId;

interface ThemeContextType {
    theme: ThemeId;
    setTheme: (id: ThemeId) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const ThemeBrandContext = createContext<ThemeBrandPresentation>(DEFAULT_THEME_BRAND_PRESENTATION);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const theme = useSettingsStore(s => s.theme);
    const setThemeState = useSettingsStore(s => s.setTheme);

    const activeThemeId = useSettingsStore(s => s.activeThemeId);
    const customThemes = useSettingsStore(s => s.customThemes);
    const setActiveThemeId = useSettingsStore(s => s.setActiveThemeId);
    const initializeThemeLibrary = useSettingsStore(s => s.initializeThemeLibrary);
    const reloadThemeLibrary = useSettingsStore(s => s.reloadThemeLibrary);
    const activeTheme = useMemo(
        () => activeThemeId ? customThemes.find(t => t.id === activeThemeId) : undefined,
        [activeThemeId, customThemes],
    );
    const effectiveTheme = activeTheme
        ? getBuiltInThemeIdForPreset(getThemeBasePresetId(activeTheme.basePresetId))
        : theme;
    const presentation = useMemo(() => resolveThemePresentation(activeTheme), [activeTheme]);

    useEffect(() => {
        void initializeThemeLibrary().catch(error => {
            console.error('[ThemeContext] Failed to initialize theme library:', error);
        });
    }, [initializeThemeLibrary]);

    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | undefined;
        void listen('theme-library-changed', () => {
            void reloadThemeLibrary().catch(error => {
                console.error('[ThemeContext] Failed to reload theme library:', error);
            });
        }).then(dispose => {
            unlisten = dispose;
        }).catch(error => {
            console.warn('[ThemeContext] Theme library events are unavailable:', error);
        });
        return () => unlisten?.();
    }, [reloadThemeLibrary]);

    const setTheme = async (id: ThemeId): Promise<void> => {
        if (isTauri()) {
            try {
                await saveActiveTheme(id);
            } catch (error) {
                console.error("[ThemeContext] Failed to save theme to backend:", error);
                throw error;
            }
        }

        setThemeState(id);
        setActiveThemeId(null);
    };

    useEffect(() => {
        // Apply theme to root
        document.documentElement.setAttribute('data-theme', effectiveTheme);
    }, [effectiveTheme]);

    // Built-in and custom themes share the same authoritative token path.
    // CSS theme blocks remain as first-paint fallbacks and art-direction rules.
    useEffect(() => {
        const tokens = activeTheme
            ? getThemeConfigTokens(activeTheme)
            : getPresetTokens(getThemePresetIdForBuiltInTheme(effectiveTheme));

        applyThemeTokens(document.documentElement.style, tokens);
    }, [activeTheme, effectiveTheme]);

    useEffect(() => {
        applyThemePresentationVariables(document.documentElement.style, presentation.variables);
        const isThemeStudioWindow = new URLSearchParams(window.location.search).get('view') === 'theme-studio';
        applyThemePresentationAttributes(
            document.documentElement,
            isThemeStudioWindow ? {} : presentation.attributes,
        );
        applyThemeFontFaces(document, presentation);
    }, [presentation]);

    return (
      <ThemeContext.Provider value={{ theme: effectiveTheme, setTheme }}>
            <ThemeBrandContext.Provider value={presentation}>
                {children}
            </ThemeBrandContext.Provider>
        </ThemeContext.Provider>
    );
};

export const useThemeBrand = (): ThemeBrandPresentation => useContext(ThemeBrandContext);

export const useTheme = () => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
    return ctx;
};
