import type { TextStyle, ViewStyle } from 'react-native';

export type LayoutDirection = 'ltr' | 'rtl';

export interface DirectionHelpers {
  direction: LayoutDirection;
  isRTL: boolean;
  row: Pick<ViewStyle, 'flexDirection'>;
  text: Pick<TextStyle, 'textAlign' | 'writingDirection'>;
  directionalIcon: Pick<ViewStyle, 'transform'>;
}

/**
 * Direction values for the few cases React Native cannot mirror implicitly.
 * Components should otherwise use start/end, marginStart/marginEnd and
 * paddingStart/paddingEnd instead of physical left/right properties.
 */
export function createDirectionHelpers(isRTL: boolean): DirectionHelpers {
  return {
    direction: isRTL ? 'rtl' : 'ltr',
    isRTL,
    row: { flexDirection: isRTL ? 'row-reverse' : 'row' },
    text: {
      textAlign: isRTL ? 'right' : 'left',
      writingDirection: isRTL ? 'rtl' : 'ltr',
    },
    directionalIcon: { transform: [{ scaleX: isRTL ? -1 : 1 }] },
  };
}

export interface LogicalSpacing {
  blockEnd?: number;
  blockStart?: number;
  inlineEnd?: number;
  inlineStart?: number;
}

export function logicalMargin(spacing: LogicalSpacing): ViewStyle {
  return {
    marginBottom: spacing.blockEnd,
    marginEnd: spacing.inlineEnd,
    marginStart: spacing.inlineStart,
    marginTop: spacing.blockStart,
  };
}

export function logicalPadding(spacing: LogicalSpacing): ViewStyle {
  return {
    paddingBottom: spacing.blockEnd,
    paddingEnd: spacing.inlineEnd,
    paddingStart: spacing.inlineStart,
    paddingTop: spacing.blockStart,
  };
}
