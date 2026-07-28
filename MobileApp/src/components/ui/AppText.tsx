import { forwardRef, type ComponentProps } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  accessibility,
  colors,
  fontFamilies,
  typography,
  type SemanticTone,
  type TypographyVariant,
} from '@/design-system';

export type AppTextTone = 'default' | 'muted' | SemanticTone;

export type AppTextProps = ComponentProps<typeof Text> & {
  variant?: TypographyVariant;
  tone?: AppTextTone;
};

const toneStyles = StyleSheet.create({
  default: { color: colors.text },
  muted: { color: colors.muted },
  success: { color: colors.success },
  warning: { color: colors.warning },
  error: { color: colors.error },
  info: { color: colors.info },
});

export const AppText = forwardRef<Text, AppTextProps>(function AppText(
  {
    allowFontScaling = accessibility.allowFontScaling,
    adjustsFontSizeToFit = accessibility.adjustsFontSizeToFit,
    maxFontSizeMultiplier = accessibility.maxFontSizeMultiplier,
    style,
    tone = 'default',
    variant = 'body',
    ...props
  },
  ref,
) {
  return (
    <Text
      ref={ref}
      allowFontScaling={allowFontScaling}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[styles.base, typography[variant], toneStyles[tone], style]}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    fontFamily: fontFamilies.body,
    textAlign: 'auto',
  },
});
