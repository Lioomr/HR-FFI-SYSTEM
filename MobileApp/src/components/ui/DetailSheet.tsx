import type { PropsWithChildren, ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/accessibility';
import { colors, layout, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';

import { AppText } from './AppText';
import { Button } from './Button';

export type DetailSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
  subtitle?: string;
  footer?: ReactNode;
  testID?: string;
}>;

/**
 * Full-screen detail presentation driven entirely by in-memory selection state.
 * Record identifiers deliberately never become route or query parameters.
 */
export function DetailSheet({
  children,
  footer,
  onClose,
  subtitle,
  testID,
  title,
  visible,
}: DetailSheetProps) {
  const { directionHelpers, t } = useLocalization();
  const reduceMotion = useReducedMotion();

  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      testID={testID}
      visible={visible}
    >
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
        <View style={[styles.header, directionHelpers.row]}>
          <View style={styles.headerCopy}>
            <AppText accessibilityRole="header" style={directionHelpers.text} variant="title2">
              {title}
            </AppText>
            {subtitle ? (
              <AppText style={directionHelpers.text} tone="muted" variant="subhead">
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <Button
            accessibilityLabel={t('common.close')}
            label={t('common.close')}
            onPress={onClose}
            size="compact"
            variant="secondary"
          />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    gap: spacing.lg,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.xl,
    paddingBottom: spacing.section,
  },
  footer: {
    gap: spacing.md,
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
