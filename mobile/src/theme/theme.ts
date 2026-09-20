import { MD3LightTheme, MD3DarkTheme, type MD3Theme } from 'react-native-paper';
// Type-only: importing `expo-router`'s runtime here would drag the whole
// navigator (and its untransformed ESM deps) into every Jest suite that needs
// a color. The concrete navigation themes live in `navigationTheme.ts`.
import type { Theme as NavigationTheme } from 'expo-router';

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#2E7D32',
    secondary: '#6D4C41',
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#81C784',
    secondary: '#BCAAA4',
  },
};

/**
 * The navigator's own theme, derived from the Paper theme above.
 *
 * The navigator paints each screen's container from *this* theme, not from
 * Paper's — without it, React Navigation's default light `background`
 * (`rgb(242, 242, 242)`) covers the themed root surface and dark mode renders
 * themed text on a light canvas.
 */
export function toNavigationTheme<T extends { colors: NavigationTheme['colors'] }>(
  base: T,
  paperTheme: MD3Theme
): T {
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: paperTheme.colors.primary,
      background: paperTheme.colors.background,
      card: paperTheme.colors.surface,
      text: paperTheme.colors.onSurface,
      border: paperTheme.colors.outlineVariant,
      notification: paperTheme.colors.error,
    },
  };
}
