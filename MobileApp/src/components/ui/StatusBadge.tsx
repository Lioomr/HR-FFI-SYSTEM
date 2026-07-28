import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing, type SemanticTone } from '@/design-system';

import { AppText } from './AppText';

export type StatusTone = SemanticTone | 'neutral';

export type StatusBadgeProps = {
  label: string;
  tone?: StatusTone;
  /** Rendered before the label. Status must never be communicated by colour alone. */
  glyph?: string;
  style?: ViewStyle;
};

const toneBackground = StyleSheet.create({
  neutral: { backgroundColor: colors.overlay, borderColor: colors.muted },
  success: { backgroundColor: colors.successSoft, borderColor: colors.success },
  warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  error: { backgroundColor: colors.errorSoft, borderColor: colors.error },
  info: { backgroundColor: colors.infoSoft, borderColor: colors.info },
});

const toneText: Record<StatusTone, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  neutral: 'default',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
};

const toneGlyph: Record<StatusTone, string> = {
  neutral: '•',
  success: '✓',
  warning: '!',
  error: '×',
  info: 'i',
};

/**
 * A compact status chip. The text label carries the meaning; the tone and glyph are
 * redundant reinforcement so the badge stays readable without colour perception.
 */
export function StatusBadge({ glyph, label, style, tone = 'neutral' }: StatusBadgeProps) {
  return (
    <View accessibilityRole="text" style={[styles.badge, toneBackground[tone], style]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.glyph}
        tone={toneText[tone]}
        variant="caption"
      >
        {glyph ?? toneGlyph[tone]}
      </AppText>
      <AppText numberOfLines={2} style={styles.label} tone={toneText[tone]} variant="caption">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  glyph: {
    fontWeight: '700',
  },
  label: {
    flexShrink: 1,
  },
});
