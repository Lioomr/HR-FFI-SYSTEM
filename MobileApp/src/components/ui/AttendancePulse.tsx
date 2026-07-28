import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/design-system';

type AttendancePulseProps = {
  style?: ViewStyle;
  compact?: boolean;
};

/** A quiet, motion-free attendance signature that remains safe for reduced motion. */
export function AttendancePulse({ compact = false, style }: AttendancePulseProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.row, compact && styles.compactRow, style]}
    >
      <View style={styles.line} />
      <View style={styles.dot} />
      <View style={styles.activeRing}>
        <View style={styles.activeDot} />
      </View>
      <View style={styles.dot} />
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  compactRow: {
    transform: [{ scale: 0.78 }],
  },
  line: {
    width: 22,
    height: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryPressed,
  },
  activeRing: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
});
