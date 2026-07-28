import { accessibilityDefaults, minimumTouchTargetStyle, MINIMUM_TOUCH_TARGET } from './constants';
import { describe, expect, it } from '@jest/globals';

import {
  createControlAccessibility,
  createFieldAccessibility,
  createImageAccessibility,
  createStatusAccessibility,
  createTabAccessibility,
  joinAccessibilityLabel,
} from './helpers';
import { motionDuration } from './reducedMotion';

describe('accessibility foundations', () => {
  it('enforces the iOS minimum touch target and scalable text', () => {
    expect(MINIMUM_TOUCH_TARGET).toBe(44);
    expect(minimumTouchTargetStyle).toEqual({ minHeight: 44, minWidth: 44 });
    expect(accessibilityDefaults.allowFontScaling).toBe(true);
    expect(accessibilityDefaults.maxFontSizeMultiplier).toBeUndefined();
  });

  it('joins localized VoiceOver label segments without empty announcements', () => {
    expect(joinAccessibilityLabel('Attendance', undefined, 'Checked in', ' ')).toBe(
      'Attendance. Checked in',
    );
    expect(joinAccessibilityLabel('الحضور', 'تم تسجيل الحضور')).toBe('الحضور. تم تسجيل الحضور');
  });

  it('creates button and tab semantics without adding hardcoded spoken text', () => {
    expect(
      createControlAccessibility({
        disabled: true,
        hint: ' Opens attendance ',
        label: ' Attendance ',
      }),
    ).toEqual({
      accessible: true,
      accessibilityHint: 'Opens attendance',
      accessibilityLabel: 'Attendance',
      accessibilityRole: 'button',
      accessibilityState: { disabled: true },
    });
    expect(createTabAccessibility({ label: 'الإجازات', selected: true })).toMatchObject({
      accessibilityLabel: 'الإجازات',
      accessibilityRole: 'tab',
      accessibilityState: { selected: true },
    });
  });

  it('creates field, status, and decorative-image semantics', () => {
    expect(
      createFieldAccessibility({ disabled: false, errorMessage: 'Invalid email', label: 'Email' }),
    ).toMatchObject({
      accessibilityLabel: 'Email. Invalid email',
      accessibilityState: { disabled: false },
    });
    expect(createStatusAccessibility('Connection lost', 'assertive')).toMatchObject({
      accessibilityLiveRegion: 'assertive',
      accessibilityRole: 'alert',
    });
    expect(createImageAccessibility()).toEqual({
      accessible: false,
      accessibilityElementsHidden: true,
    });
    expect(createImageAccessibility('Company logo')).toMatchObject({
      accessibilityLabel: 'Company logo',
      accessibilityRole: 'image',
    });
  });

  it('removes animation duration when reduced motion is enabled', () => {
    expect(motionDuration(220, true)).toBe(0);
    expect(motionDuration(220, false)).toBe(220);
    expect(motionDuration(-10, false)).toBe(0);
  });
});
