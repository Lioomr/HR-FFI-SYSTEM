import { forwardRef, useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, layout, radii, spacing } from '@/design-system';

import { AppText } from './AppText';

export type FieldProps = TextInputProps & {
  label: string;
  error?: string;
  helperText?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  {
    accessibilityHint,
    accessibilityLabel,
    editable = true,
    error,
    helperText,
    label,
    leading,
    onBlur,
    onFocus,
    style,
    testID,
    trailing,
    ...props
  },
  ref,
) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const fieldId = useId();
  const description = error ?? helperText;

  const setInputRef = useCallback(
    (input: TextInput | null) => {
      inputRef.current = input;
      if (typeof ref === 'function') ref(input);
      else if (ref) ref.current = input;
    },
    [ref],
  );

  const handleFocus: NonNullable<TextInputProps['onFocus']> = (event) => {
    setIsFocused(true);
    onFocus?.(event);
  };

  const handleBlur: NonNullable<TextInputProps['onBlur']> = (event) => {
    setIsFocused(false);
    onBlur?.(event);
  };

  return (
    <View style={styles.container}>
      <AppText nativeID={`${fieldId}-label`} variant="subhead">
        {label}
      </AppText>
      <Pressable
        accessible={false}
        onPress={() => inputRef.current?.focus()}
        testID={testID ? `${testID}-frame` : undefined}
        style={[
          styles.inputFrame,
          isFocused && styles.focused,
          error && styles.invalid,
          !editable && styles.disabled,
        ]}
      >
        {leading}
        <TextInput
          ref={setInputRef}
          accessibilityHint={accessibilityHint ?? description}
          accessibilityLabel={accessibilityLabel ?? label}
          allowFontScaling
          editable={editable}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholderTextColor={colors.muted}
          showSoftInputOnFocus
          style={[styles.input, style]}
          testID={testID}
          {...props}
        />
        {trailing}
      </Pressable>
      {description ? (
        <AppText
          accessibilityLiveRegion={error ? 'polite' : 'none'}
          nativeID={`${fieldId}-description`}
          tone={error ? 'error' : 'muted'}
          variant="footnote"
        >
          {description}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  inputFrame: {
    minHeight: layout.fieldMinHeight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  focused: {
    borderWidth: 2,
    borderColor: colors.text,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
  },
  invalid: {
    borderWidth: 2,
    borderColor: colors.error,
  },
  disabled: {
    opacity: 0.5,
  },
  input: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'auto',
  },
});
