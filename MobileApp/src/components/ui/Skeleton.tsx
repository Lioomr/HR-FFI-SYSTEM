import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

type SkeletonListProps = {
  rows?: number;
  /** Announced once for the whole placeholder block instead of per shimmering bar. */
  label?: string;
  testID?: string;
};

/**
 * A static, motion-free loading placeholder. It carries no animation, so it behaves
 * identically with reduce-motion enabled and never competes with screen-reader focus.
 */
export function SkeletonList({ label, rows = 3, testID }: SkeletonListProps) {
  const { t } = useLocalization();

  return (
    <View
      accessibilityLabel={label ?? t('state.loadingTitle')}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.container}
      testID={testID}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          key={index}
          style={styles.row}
        >
          <View style={[styles.bar, styles.title]} />
          <View style={[styles.bar, styles.subtitle]} />
        </View>
      ))}
    </View>
  );
}

export function SkeletonCard({ label, testID }: Omit<SkeletonListProps, 'rows'>) {
  const { t } = useLocalization();

  return (
    <View
      accessibilityLabel={label ?? t('state.loadingTitle')}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.card}
      testID={testID}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.cardInner}
      >
        <View style={[styles.bar, styles.title]} />
        <View style={[styles.bar, styles.subtitle]} />
        <View style={[styles.bar, styles.subtitle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  row: {
    gap: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  cardInner: {
    gap: spacing.md,
  },
  bar: {
    height: 12,
    borderRadius: radii.xs,
    backgroundColor: colors.overlay,
  },
  title: {
    width: '58%',
  },
  subtitle: {
    width: '86%',
    height: 10,
  },
});
