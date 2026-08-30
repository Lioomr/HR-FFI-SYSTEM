import { forwardRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { colors, elevation, layout, radii, spacing } from '@/design-system';

import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'regular' | 'compact';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  fullWidth?: boolean;
};

export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    accessibilityLabel,
    disabled = false,
    fullWidth = false,
    label,
    leading,
    loading = false,
    onBlur,
    onFocus,
    size = 'regular',
    trailing,
    variant = 'primary',
    ...props
  },
  ref,
) {
  const [isFocused, setIsFocused] = useState(false);
  const isDisabled = disabled || loading;
  const foregroundColor =
    variant === 'destructive' ? colors.cream : variant === 'ghost' ? colors.muted : colors.text;

  return (
    <Pressable
      ref={ref}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        variantStyles[variant],
        fullWidth && styles.fullWidth,
        isFocused && styles.focused,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={foregroundColor} />
      ) : (
        <>
          {leading}
          <AppText
            numberOfLines={2}
            style={[styles.label, { color: foregroundColor }]}
            variant="headline"
          >
            {label}
          </AppText>
          {trailing}
        </>
      )}
    </Pressable>
  );
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
    borderColor: 'transparent',
    ...elevation.low,
  },
  secondary: {
    backgroundColor: colors.overlay,
    borderColor: 'transparent',
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  destructive: {
    backgroundColor: colors.error,
    borderColor: 'transparent',
    ...elevation.low,
  },
});

const styles = StyleSheet.create({
  base: {
    minWidth: layout.minTouchTarget,
    borderWidth: 1,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  regular: {
    minHeight: layout.preferredTouchTarget,
    paddingVertical: spacing.md,
  },
  compact: {
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
  focused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.45,
  },
});
