import { Pressable, StyleSheet, View } from 'react-native';

import { createControlAccessibility } from '@/accessibility';
import { AppText } from '@/components/ui';
import { colors, layout, radii, spacing } from '@/design-system';
import { useLocalization, type SupportedLanguage, type TranslationKey } from '@/i18n';

const LANGUAGE_LABELS: Readonly<Record<SupportedLanguage, TranslationKey>> = Object.freeze({
  en: 'shell.english',
  ar: 'shell.arabic',
});

/**
 * Session-scoped language switch. The choice lives in provider state only: nothing is
 * written to storage, so a shared or lost device reveals no user preference.
 */
export function LanguageSelector() {
  const { availableLanguages, directionHelpers, language, setLanguage, t } = useLocalization();

  return (
    <View accessibilityRole="radiogroup" style={[styles.row, directionHelpers.row]}>
      {availableLanguages.map((option) => {
        const selected = option === language;
        const label = t(LANGUAGE_LABELS[option]);
        return (
          <Pressable
            {...createControlAccessibility({
              hint: selected ? t('accessibility.selectedLanguage') : undefined,
              label,
              role: 'radio',
              selected,
            })}
            key={option}
            onPress={() => setLanguage(option)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.selected,
              pressed && styles.pressed,
            ]}
            testID={`language-${option}`}
          >
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              variant={selected ? 'headline' : 'callout'}
            >
              {selected ? `✓  ${label}` : label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  option: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  selected: {
    borderColor: colors.text,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  pressed: {
    opacity: 0.76,
  },
});
