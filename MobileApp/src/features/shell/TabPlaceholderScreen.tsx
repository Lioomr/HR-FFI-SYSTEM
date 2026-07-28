import { AppText, Screen } from '@/components/ui';
import { spacing } from '@/design-system';
import { useLocalization, type TranslationKey } from '@/i18n';
import { StyleSheet, View } from 'react-native';

import { ShellEmptyState } from './AppStateScreen';

interface TabPlaceholderScreenProps {
  titleKey: TranslationKey;
  emoji?: string;
}

export function TabPlaceholderScreen({ emoji, titleKey }: TabPlaceholderScreenProps) {
  const { t } = useLocalization();
  return (
    <Screen edges={['top', 'right', 'left']}>
      <View style={styles.container}>
        <AppText accessibilityRole="header" variant="title1">
          {t(titleKey)}
        </AppText>
        <ShellEmptyState emoji={emoji} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.lg,
  },
});
