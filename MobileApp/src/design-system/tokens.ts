import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Option 2 — Minimalist / Refined.
 *
 * Cream is the dominant canvas, near-black carries hierarchy, and orange is a
 * deliberate action/attendance accent. Semantic colors are reserved for real
 * status meaning and must not be used as decoration.
 */
export const colors = {
  primary: '#FF7F3E',
  cream: '#FFF6E9',
  text: '#1F1F1F',
  muted: '#6B6B6B',
  border: '#E5E5E5',
  primarySoft: 'rgba(255, 127, 62, 0.14)',
  primaryPressed: 'rgba(255, 127, 62, 0.78)',
  textPressed: 'rgba(31, 31, 31, 0.72)',
  overlay: 'rgba(31, 31, 31, 0.08)',
  success: '#1F7A4D',
  successSoft: 'rgba(31, 122, 77, 0.12)',
  warning: '#9C5700',
  warningSoft: 'rgba(156, 87, 0, 0.12)',
  error: '#B42318',
  errorSoft: 'rgba(180, 35, 24, 0.12)',
  info: '#175CD3',
  infoSoft: 'rgba(23, 92, 211, 0.12)',
} as const;

export type SemanticTone = 'success' | 'warning' | 'error' | 'info';

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  jumbo: 40,
  section: 48,
  hero: 64,
} as const;

export const radii = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.7 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.4 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400', letterSpacing: 0 },
  callout: { fontSize: 16, lineHeight: 22, fontWeight: '500', letterSpacing: 0 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: 0 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: 0.1 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.2 },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

export const fontFamilies = {
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: undefined }),
  rounded: Platform.select({ ios: 'ui-rounded', android: 'sans-serif-medium', default: undefined }),
} as const;

export const elevation = {
  none: {} satisfies ViewStyle,
  low: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  } satisfies ViewStyle,
  medium: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  } satisfies ViewStyle,
} as const;

export const layout = {
  minTouchTarget: 44,
  preferredTouchTarget: 48,
  screenGutter: spacing.lg,
  maxContentWidth: 680,
  fieldMinHeight: 52,
} as const;

export const motion = {
  durations: {
    immediate: 0,
    quick: 140,
    standard: 220,
    emphasized: 320,
  },
  easing: {
    standard: [0.22, 1, 0.36, 1] as const,
  },
  /** Replace movement with an immediate state change when reduce-motion is enabled. */
  reducedMotionDuration: 0,
} as const;

export const accessibility = {
  minimumContrastFocusWidth: 2,
  allowFontScaling: true,
  adjustsFontSizeToFit: false,
  /** Keep layouts reflowable; do not cap Dynamic Type in content text. */
  maxFontSizeMultiplier: undefined,
  /** Motion communicates state only and must respect the OS reduce-motion setting. */
  motionPolicy: 'respect-reduce-motion',
} as const;

export const lightTheme = {
  colors,
  spacing,
  radii,
  typography,
  elevation,
  layout,
  motion,
  accessibility,
} as const;

export type AppTheme = typeof lightTheme;
