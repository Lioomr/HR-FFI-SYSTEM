import { describe, expect, it } from '@jest/globals';

import { accessibility, colors, layout, typography } from './tokens';

describe('design-system tokens', () => {
  it('preserves the approved Option 2 brand palette', () => {
    expect(colors.primary).toBe('#FF7F3E');
    expect(colors.cream).toBe('#FFF6E9');
    expect(colors.text).toBe('#1F1F1F');
    expect(colors.muted).toBe('#6B6B6B');
    expect(colors.border).toBe('#E5E5E5');
  });

  it('uses dark text for controls on orange', () => {
    expect(colors.text).toBe('#1F1F1F');
    expect(colors.text).not.toBe('#FFFFFF');
  });

  it('keeps controls and fields at accessible target sizes', () => {
    expect(layout.minTouchTarget).toBeGreaterThanOrEqual(44);
    expect(layout.preferredTouchTarget).toBeGreaterThanOrEqual(layout.minTouchTarget);
    expect(layout.fieldMinHeight).toBeGreaterThanOrEqual(44);
  });

  it('supports Dynamic Type without shrinking content to fit', () => {
    expect(accessibility.allowFontScaling).toBe(true);
    expect(accessibility.adjustsFontSizeToFit).toBe(false);
    expect(accessibility.maxFontSizeMultiplier).toBeUndefined();
    expect(typography.body.lineHeight).toBeGreaterThan(typography.body.fontSize ?? 0);
  });
});
