import { DefaultTheme, DarkTheme } from 'expo-router';
import { lightTheme, darkTheme, toNavigationTheme } from './theme';

/**
 * React Navigation's themes, kept in step with the Paper themes.
 *
 * Separate from `theme.ts` because this module imports `expo-router` at
 * runtime; `theme.ts` stays free of that so plain-logic tests can read colors
 * without loading the navigator.
 */
export const navigationLightTheme = toNavigationTheme(DefaultTheme, lightTheme);
export const navigationDarkTheme = toNavigationTheme(DarkTheme, darkTheme);
