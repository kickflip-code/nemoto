import { ALL_THEME_VARIABLE_NAMES, type ThemeTokenMap } from './themeContract';

export interface ThemeStyleTarget {
  setProperty: (property: string, value: string) => void;
  removeProperty: (property: string) => string;
}

export const clearThemeTokens = (style: ThemeStyleTarget): void => {
  ALL_THEME_VARIABLE_NAMES.forEach(property => {
    style.removeProperty(property);
  });
};

export const applyThemeTokens = (style: ThemeStyleTarget, tokens: ThemeTokenMap): void => {
  ALL_THEME_VARIABLE_NAMES.forEach(property => {
    const value = tokens[property]?.trim();

    if (value) {
      style.setProperty(property, value);
    } else {
      style.removeProperty(property);
    }
  });
};
