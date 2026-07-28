import { useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';

import { colors, elevation, layout, radii, spacing, type SemanticTone } from '@/design-system';

export type CardTone = 'default' | 'accent' | SemanticTone;

type SharedCardProps = PropsWithChildren<{
  tone?: CardTone;
  elevated?: boolean;
}>;

type StaticCardProps = SharedCardProps &
  Omit<ViewProps, 'children'> & {
    onPress?: never;
  };

type InteractiveCardProps = SharedCardProps &
  Omit<PressableProps, 'children'> & {
    onPress: NonNullable<PressableProps['onPress']>;
  };

export type CardProps = StaticCardProps | InteractiveCardProps;

export function Card({ children, elevated = false, tone = 'default', ...props }: CardProps) {
  const [isFocused, setIsFocused] = useState(false);

  if ('onPress' in props && props.onPress) {
    const { onBlur, onFocus, style, ...pressableProps } = props;

    return (
      <Pressable
        accessibilityRole="button"
        {...pressableProps}
        onBlur={(event) => {
          setIsFocused(false);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          setIsFocused(true);
          onFocus?.(event);
        }}
        style={(state) => [
          styles.base,
          toneStyles[tone],
          elevated && elevation.low,
          styles.interactive,
          isFocused && styles.focused,
          state.pressed && styles.pressed,
          typeof style === 'function' ? style(state) : style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  const { style, ...viewProps } = props;

  return (
    <View {...viewProps} style={[styles.base, toneStyles[tone], elevated && elevation.low, style]}>
      {children}
    </View>
  );
}

const toneStyles = StyleSheet.create({
  default: { backgroundColor: colors.cream },
  accent: { backgroundColor: colors.primarySoft },
  success: { backgroundColor: colors.successSoft },
  warning: { backgroundColor: colors.warningSoft },
  error: { backgroundColor: colors.errorSoft },
  info: { backgroundColor: colors.infoSoft },
});

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  interactive: {
    minHeight: layout.minTouchTarget,
  },
  focused: {
    borderColor: colors.text,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.992 }],
  },
});
