import { type PropsWithChildren, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '@/design-system';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  edges?: Edge[];
  header?: ReactNode;
  footer?: ReactNode;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  scrollViewProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle'>;
  viewProps?: Omit<ViewProps, 'children'>;
}>;

export function Screen({
  children,
  contentContainerStyle,
  edges = ['top', 'right', 'bottom', 'left'],
  footer,
  header,
  scroll = false,
  scrollViewProps,
  viewProps,
}: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      {header}
      {scroll ? (
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          {...scrollViewProps}
          contentContainerStyle={[styles.content, contentContainerStyle]}
        >
          {children}
        </ScrollView>
      ) : (
        <View {...viewProps} style={[styles.content, styles.flexContent, viewProps?.style]}>
          {children}
        </View>
      )}
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenGutter,
    paddingVertical: spacing.lg,
  },
  flexContent: {
    flex: 1,
  },
});
