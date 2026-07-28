import type { ViewStyle } from 'react-native';

/** iOS Human Interface Guidelines minimum interactive target. */
export const MINIMUM_TOUCH_TARGET = 44;
export const PREFERRED_TOUCH_TARGET = 48;

export const minimumTouchTargetStyle = {
  minHeight: MINIMUM_TOUCH_TARGET,
  minWidth: MINIMUM_TOUCH_TARGET,
} as const satisfies ViewStyle;

export const compactControlHitSlop = {
  bottom: 8,
  left: 8,
  right: 8,
  top: 8,
} as const;

export const accessibilityDefaults = {
  allowFontScaling: true,
  maxFontSizeMultiplier: undefined,
} as const;
