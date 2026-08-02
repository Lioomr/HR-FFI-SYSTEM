import type { AccessibilityProps, AccessibilityRole } from 'react-native';

type AccessibilityState = NonNullable<AccessibilityProps['accessibilityState']>;

export function joinAccessibilityLabel(...parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('. ');
}

interface ControlAccessibilityOptions {
  busy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  hint?: string;
  label: string;
  role?: AccessibilityRole;
  selected?: boolean;
}

export function createControlAccessibility({
  busy,
  disabled,
  expanded,
  hint,
  label,
  role = 'button',
  selected,
}: ControlAccessibilityOptions): AccessibilityProps {
  const accessibilityState: AccessibilityState = {};

  if (busy !== undefined) accessibilityState.busy = busy;
  if (disabled !== undefined) accessibilityState.disabled = disabled;
  if (expanded !== undefined) accessibilityState.expanded = expanded;
  if (selected !== undefined) accessibilityState.selected = selected;

  return {
    accessible: true,
    accessibilityHint: hint?.trim() || undefined,
    accessibilityLabel: label.trim(),
    accessibilityRole: role,
    accessibilityState,
  };
}

interface TabAccessibilityOptions {
  hint?: string;
  label: string;
  selected: boolean;
}

export function createTabAccessibility({
  hint,
  label,
  selected,
}: TabAccessibilityOptions): AccessibilityProps {
  return createControlAccessibility({ hint, label, role: 'tab', selected });
}

interface FieldAccessibilityOptions {
  disabled?: boolean;
  errorMessage?: string;
  hint?: string;
  label: string;
}

export function createFieldAccessibility({
  disabled,
  errorMessage,
  hint,
  label,
}: FieldAccessibilityOptions): AccessibilityProps {
  return {
    accessible: true,
    accessibilityHint: hint?.trim() || undefined,
    accessibilityLabel: joinAccessibilityLabel(label, errorMessage),
    accessibilityState: { disabled },
  };
}

export function createStatusAccessibility(
  label: string,
  politeness: 'assertive' | 'polite' = 'polite',
): AccessibilityProps {
  return {
    accessible: true,
    accessibilityLabel: label.trim(),
    accessibilityLiveRegion: politeness,
    accessibilityRole: politeness === 'assertive' ? 'alert' : 'text',
  };
}

export function createImageAccessibility(label?: string): AccessibilityProps {
  const normalizedLabel = label?.trim();

  if (!normalizedLabel) {
    return { accessible: false, accessibilityElementsHidden: true };
  }

  return {
    accessible: true,
    accessibilityLabel: normalizedLabel,
    accessibilityRole: 'image',
  };
}
