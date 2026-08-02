import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, layout, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

import { AppText } from './AppText';

export type ListRowProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: ReactNode;
  leading?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onPress?: () => void;
  /** Draws a quiet unread marker without relying on colour alone. */
  emphasized?: boolean;
  testID?: string;
};

/**
 * The one row shape used by attendance, leave, notification, payslip, and document
 * lists so the whole app reads as a single system.
 */
export function ListRow({
  accessibilityHint,
  accessibilityLabel,
  emphasized = false,
  leading,
  meta,
  onPress,
  subtitle,
  testID,
  title,
  trailing,
}: ListRowProps) {
  const { directionHelpers } = useLocalization();
  const label = accessibilityLabel ?? [title, subtitle, meta].filter(Boolean).join('. ');

  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.copy}>
        <AppText numberOfLines={2} style={directionHelpers.text} variant="headline">
          {title}
        </AppText>
        {subtitle ? (
          <AppText numberOfLines={2} style={directionHelpers.text} tone="muted" variant="subhead">
            {subtitle}
          </AppText>
        ) : null}
        {meta ? (
          <AppText style={directionHelpers.text} tone="muted" variant="caption">
            {meta}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessibilityLabel={label}
        accessibilityRole="text"
        style={[styles.row, directionHelpers.row, emphasized && styles.emphasized]}
        testID={testID}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        directionHelpers.row,
        emphasized && styles.emphasized,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  emphasized: {
    borderStartWidth: 3,
    borderStartColor: colors.primary,
    backgroundColor: colors.primarySoft,
    paddingStart: spacing.md,
  },
  pressed: {
    opacity: 0.76,
  },
  leading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
