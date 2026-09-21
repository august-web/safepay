import { StyleSheet } from 'react-native';

import palettes from './palettes.json';

/**
 * Shared design tokens for SikaVoice.
 *
 * Colours come from the team's two WCAG-audited palettes (see palettes.json and
 * `npm run a11y:contrast`). SikaVoice is an inclusion app, so contrast is a
 * functional requirement: every pairing the UI renders is verified against
 * WCAG 2.2 AA rather than eyeballed.
 *
 * Touch targets: WCAG 2.2 (2.5.8) requires 44x44 pt/dp minimum; the brief
 * allows no exceptions. We use 48 as the floor for extra comfort, and every
 * interactive component in the app must honor `theme.touchTarget.minSize`.
 *
 * Colour tokens are read through `theme.colors`, which always reflects the
 * palette the user selected. Because module-scope style sheets run once at
 * import, colour-bearing style sheets MUST use `themedStyles` so they are
 * rebuilt per palette.
 */

export type ThemePaletteName = 'soft' | 'crisp';

export type ThemePalette = (typeof palettes)['soft'];

export const THEME_PALETTE_NAMES: readonly ThemePaletteName[] = ['soft', 'crisp'];

export const THEME_PALETTES: Record<ThemePaletteName, ThemePalette> = {
  soft: palettes.soft,
  crisp: palettes.crisp,
};

/**
 * Maps palette roles onto the token names the components already use. Keeping
 * the legacy names means no screen had to be rewritten when the palettes landed.
 */
function buildColors(palette: ThemePalette) {
  return {
    // Brand accent — her "accent navy"
    safepayBlue: palette.accent,
    safepayBlueDark: palette.accentDark,
    safepayBlueLight: palette.accent,
    safepayBlueMuted: palette.accent,
    safepayTint: palette.accentTint,
    safepayTintLight: palette.accentTint,

    // Gold accent — fill roles only; see goldInk for text
    momoYellow: palette.gold,
    momoYellowDark: palette.goldPressed,
    momoYellowLight: palette.goldTint,
    accentGold: palette.gold,
    accentGoldDark: palette.goldPressed,
    accentGoldLight: palette.goldTint,
    /** Gold for text/icons, darkened until it passes AA on light surfaces. */
    goldInk: palette.goldInk,

    navyMidnight: palette.accent,
    navy: palette.accent,
    navyDark: palette.accentDark,
    primary: palette.accent,
    primaryDark: palette.accentDark,
    primaryLight: palette.accentTint,

    // Surfaces & backgrounds
    background: palette.background,
    surface: palette.surface,
    surfaceElevated: palette.surfaceElevated,
    surfaceMuted: palette.surfaceMuted,
    surfaceNavy: palette.accent,
    surfaceYellow: palette.gold,

    // Borders
    border: palette.border,
    borderDark: palette.borderDark,
    /** Input/control outlines, held at 3:1 against both background and surface. */
    controlBorder: palette.controlBorder,
    borderFocus: palette.focusRing,

    // Text & contrast
    text: palette.text,
    textMuted: palette.textMuted,
    textLight: palette.textLight,
    textOnNavy: palette.onAccent,
    textOnNavyMuted: palette.onAccentMuted,
    textOnYellow: palette.onGold,
    onPrimary: palette.onAccent,
    onGold: palette.onGold,

    // Status semantics
    danger: palette.danger,
    dangerLight: palette.dangerTint,
    dangerDark: palette.danger,
    success: palette.success,
    successLight: palette.successTint,
    successDark: palette.success,
    warning: palette.warning,
    warningLight: palette.warningTint,
    disabled: palette.disabled,
    placeholder: palette.placeholder,
    secondary: palette.accentTint,
  };
}

export type ThemeColors = ReturnType<typeof buildColors>;

const metrics = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radii: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  typography: {
    hero: 34,
    title: 28,
    heading: 22,
    subheading: 19,
    body: 17,
    small: 14,
    tiny: 12,
  },
  touchTarget: {
    minSize: 48,
  },
} as const;

export type Theme = { colors: ThemeColors } & typeof metrics;

let activeName: ThemePaletteName = 'soft';
const colorCache = new Map<ThemePaletteName, ThemeColors>();

function colorsFor(name: ThemePaletteName): ThemeColors {
  let colors = colorCache.get(name);
  if (colors == null) {
    colors = buildColors(THEME_PALETTES[name]);
    colorCache.set(name, colors);
  }
  return colors;
}

export function getActivePaletteName(): ThemePaletteName {
  return activeName;
}

export function getActivePalette(): ThemePalette {
  return THEME_PALETTES[activeName];
}

/** Called by the theme provider; affects every subsequent palette read. */
export function setActivePalette(name: ThemePaletteName): void {
  activeName = name;
}

export const theme: Theme = {
  get colors(): ThemeColors {
    return colorsFor(activeName);
  },
  ...metrics,
} as Theme;

/**
 * Builds a style sheet per palette and resolves the right one at access time,
 * so a palette switch repaints without any component-local plumbing.
 *
 *   const styles = themedStyles((colors) => ({ card: { backgroundColor: colors.surface } }));
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
): T {
  const cache = new Map<ThemePaletteName, T>();
  const sheetFor = (name: ThemePaletteName): T => {
    let sheet = cache.get(name);
    if (sheet == null) {
      sheet = StyleSheet.create(factory(colorsFor(name)));
      cache.set(name, sheet);
    }
    return sheet;
  };

  // Materialise the key set once so the returned object behaves like a normal
  // style sheet (enumerable keys, spread-safe) instead of a lazy proxy.
  const resolved: Record<string, unknown> = {};
  for (const key of Object.keys(sheetFor(activeName))) {
    Object.defineProperty(resolved, key, {
      enumerable: true,
      get: () => sheetFor(activeName)[key as keyof T],
    });
  }
  return resolved as T;
}
