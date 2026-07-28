import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, type SemanticTone } from '@/design-system';

export type AppIconTone = 'default' | 'muted' | SemanticTone;
export type AppIconTreatment = 'plain' | 'soft' | 'contained';

export type AppIconProps = Omit<SymbolViewProps, 'tintColor'> & {
  tone?: AppIconTone;
  treatment?: AppIconTreatment;
  containerStyle?: ViewStyle;
  decorative?: boolean;
};

const toneColors = {
  default: colors.text,
  muted: colors.muted,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
  info: colors.info,
} as const;

const treatmentStyles = StyleSheet.create({
  plain: {},
  soft: {
    backgroundColor: colors.primarySoft,
  },
  contained: {
    backgroundColor: colors.primary,
  },
});

export function AppIcon({
  containerStyle,
  decorative = true,
  size = 20,
  tone = 'default',
  treatment = 'plain',
  ...props
}: AppIconProps) {
  const containedColor = treatment === 'contained' ? colors.text : toneColors[tone];
  const hasContainer = treatment !== 'plain';

  return (
    <View
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.container,
        hasContainer && styles.framed,
        treatmentStyles[treatment],
        containerStyle,
      ]}
    >
      <SymbolView size={size} tintColor={containedColor} type="monochrome" {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  framed: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
  },
});
