import NativeDateTimePicker from '@expo/ui/community/datetime-picker';
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, layout, radii, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

import { fromIsoDate, toIsoDate } from './leave-dates';

export interface DateFieldProps {
  label: string;
  /** Always the API's `YYYY-MM-DD` calendar date, or empty when unset. */
  value: string;
  onChange: (isoDate: string) => void;
  error?: string;
  helperText?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
}

/**
 * A calendar date field. Tapping it reveals the native iOS graphical date picker from
 * `@expo/ui`, so the employee never types a date. The value handed to the caller stays
 * the exact `YYYY-MM-DD` string the leave API expects; only the on-screen label is
 * locale-formatted.
 */
export function DateField({
  error,
  helperText,
  label,
  maximumDate,
  minimumDate,
  onChange,
  testID,
  value,
}: DateFieldProps) {
  const { directionHelpers, formatDate, localeTag, t } = useLocalization();
  const [expanded, setExpanded] = useState(false);

  const selected = useMemo(() => fromIsoDate(value), [value]);
  /** An unset field opens on today rather than the epoch. */
  const pickerValue = useMemo(() => selected ?? new Date(), [selected]);
  const description = error ?? helperText;

  const displayValue = useMemo(() => {
    if (!selected) return t('leave.selectDate');
    try {
      return formatDate(selected, { dateStyle: 'full' });
    } catch {
      return value;
    }
  }, [formatDate, selected, t, value]);

  const handleChange = useCallback(
    (_event: unknown, date: Date) => {
      if (!date || Number.isNaN(date.getTime())) return;
      onChange(toIsoDate(date));
    },
    [onChange],
  );

  return (
    <View style={styles.container}>
      <AppText style={directionHelpers.text} variant="subhead">
        {label}
      </AppText>

      <Pressable
        accessibilityHint={t('leave.openCalendarHint')}
        accessibilityLabel={`${label}: ${displayValue}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityValue={selected ? { text: displayValue } : undefined}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [
          styles.trigger,
          expanded && styles.triggerExpanded,
          error ? styles.invalid : null,
          pressed && styles.pressed,
        ]}
        testID={testID}
      >
        <View style={[styles.triggerRow, directionHelpers.row]}>
          <AppText
            style={[styles.triggerText, directionHelpers.text]}
            tone={selected ? 'default' : 'muted'}
            variant="body"
          >
            {displayValue}
          </AppText>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            tone="muted"
            variant="callout"
          >
            {expanded ? '▴' : '▾'}
          </AppText>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.picker} testID={testID ? `${testID}-picker` : undefined}>
          <NativeDateTimePicker
            accentColor={colors.primary}
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            locale={localeTag}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            mode="date"
            onValueChange={handleChange}
            testID={testID ? `${testID}-native` : undefined}
            value={pickerValue}
          />
        </View>
      ) : null}

      {description ? (
        <AppText
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          style={directionHelpers.text}
          tone={error ? 'error' : 'muted'}
          variant="footnote"
        >
          {description}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  trigger: {
    minHeight: layout.fieldMinHeight,
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  triggerExpanded: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  invalid: {
    borderWidth: 2,
    borderColor: colors.error,
  },
  pressed: {
    opacity: 0.76,
  },
  triggerRow: {
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  triggerText: {
    flex: 1,
  },
  picker: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cream,
    padding: spacing.sm,
  },
});
