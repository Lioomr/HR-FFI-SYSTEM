import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

import { AppText } from './AppText';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
};

/** The single screen-title treatment shared by all five tabs. */
export function ScreenHeader({ subtitle, title, trailing }: ScreenHeaderProps) {
  const { directionHelpers } = useLocalization();

  return (
    <View style={[styles.screenHeader, directionHelpers.row]}>
      <View style={styles.copy}>
        <AppText accessibilityRole="header" style={directionHelpers.text} variant="title1">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={directionHelpers.text} tone="muted" variant="subhead">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  hint?: string;
  trailing?: ReactNode;
};

/** The single in-card/section-title treatment shared by all feature sections. */
export function SectionHeader({ hint, title, trailing }: SectionHeaderProps) {
  const { directionHelpers } = useLocalization();

  return (
    <View style={[styles.sectionHeader, directionHelpers.row]}>
      <View style={styles.copy}>
        <AppText accessibilityRole="header" style={directionHelpers.text} variant="title2">
          {title}
        </AppText>
        {hint ? (
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {hint}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

type DetailRowProps = {
  label: string;
  value: string;
  tone?: 'default' | 'muted';
};

/** Label/value pair used across profile, leave, payslip, and document detail views. */
export function DetailRow({ label, tone = 'default', value }: DetailRowProps) {
  const { directionHelpers } = useLocalization();

  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="text"
      style={styles.detailRow}
    >
      <AppText style={directionHelpers.text} tone="muted" variant="footnote">
        {label}
      </AppText>
      <AppText
        style={directionHelpers.text}
        tone={tone === 'muted' ? 'muted' : 'default'}
        variant="callout"
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    alignItems: 'flex-start',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  sectionHeader: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  detailRow: {
    gap: spacing.xxs,
    minHeight: 40,
    justifyContent: 'center',
  },
});
