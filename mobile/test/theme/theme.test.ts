import { lightTheme, darkTheme, toNavigationTheme } from '../../src/theme/theme';

// Shaped like React Navigation's built-in themes, with its real defaults —
// the navigator's own light `background` is what used to cover the themed root
// surface, leaving dark mode drawing themed text on a light canvas.
const navigationDefaults = {
  dark: false,
  colors: {
    primary: 'rgb(0, 122, 255)',
    background: 'rgb(242, 242, 242)',
    card: 'rgb(255, 255, 255)',
    text: 'rgb(28, 28, 30)',
    border: 'rgb(216, 216, 216)',
    notification: 'rgb(255, 59, 48)',
  },
};

describe('toNavigationTheme', () => {
  it('takes the background from the Paper theme it is derived from', () => {
    expect(toNavigationTheme(navigationDefaults, lightTheme).colors.background).toBe(
      lightTheme.colors.background
    );
    expect(toNavigationTheme(navigationDefaults, darkTheme).colors.background).toBe(
      darkTheme.colors.background
    );
  });

  it('produces a different background for light and dark', () => {
    expect(toNavigationTheme(navigationDefaults, lightTheme).colors.background).not.toBe(
      toNavigationTheme(navigationDefaults, darkTheme).colors.background
    );
  });

  it('maps primary, surface, text, border and error across', () => {
    const navTheme = toNavigationTheme(navigationDefaults, darkTheme);

    expect(navTheme.colors.primary).toBe(darkTheme.colors.primary);
    expect(navTheme.colors.card).toBe(darkTheme.colors.surface);
    expect(navTheme.colors.text).toBe(darkTheme.colors.onSurface);
    expect(navTheme.colors.border).toBe(darkTheme.colors.outlineVariant);
    expect(navTheme.colors.notification).toBe(darkTheme.colors.error);
  });

  it('keeps every other field of the base theme', () => {
    expect(toNavigationTheme(navigationDefaults, darkTheme).dark).toBe(false);
    expect(toNavigationTheme({ ...navigationDefaults, dark: true }, darkTheme).dark).toBe(true);
  });
});
