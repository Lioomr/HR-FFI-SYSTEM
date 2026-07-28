import { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing, type SemanticTone } from '@/design-system';

import { AppText } from './AppText';
import { AttendancePulse } from './AttendancePulse';

export type StateViewKind = 'loading' | 'empty' | 'error' | 'offline' | 'session-expired';

export type StateViewProps = {
  kind: StateViewKind;
  title?: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
  emoji?: string;
  compact?: boolean;
};

const stateTone: Record<StateViewKind, SemanticTone | 'muted'> = {
  loading: 'muted',
  empty: 'muted',
  error: 'error',
  offline: 'warning',
  'session-expired': 'warning',
};

const stateEmoji: Partial<Record<StateViewKind, string>> = {
  empty: '📭',
  error: '🛠️',
  offline: '📡',
  'session-expired': '🔐',
};

export function StateView({
  action,
  compact = false,
  emoji,
  icon,
  kind,
  message,
  title,
}: StateViewProps) {
  const isLoading = kind === 'loading';
  const displayedEmoji = emoji ?? stateEmoji[kind];

  return (
    <View
      accessibilityLiveRegion={isLoading ? 'polite' : 'assertive'}
      accessibilityRole={isLoading ? 'progressbar' : 'summary'}
      style={[styles.container, compact && styles.compact]}
    >
      {icon ??
        (isLoading ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : displayedEmoji ? (
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.emoji, compact && styles.compactEmoji]}
          >
            {displayedEmoji}
          </AppText>
        ) : (
          <AttendancePulse compact />
        ))}
      {title ? (
        <AppText style={styles.centered} tone={stateTone[kind]} variant="headline">
          {title}
        </AppText>
      ) : null}
      {message ? (
        <AppText style={styles.centered} tone="muted" variant="subhead">
          {message}
        </AppText>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

export type NamedStateViewProps = Omit<StateViewProps, 'kind'>;

export function LoadingState(props: NamedStateViewProps) {
  return <StateView {...props} kind="loading" />;
}

export function EmptyState(props: NamedStateViewProps) {
  return <StateView {...props} kind="empty" />;
}

export function ErrorState(props: NamedStateViewProps) {
  return <StateView {...props} kind="error" />;
}

export function OfflineState(props: NamedStateViewProps) {
  return <StateView {...props} kind="offline" />;
}

export function SessionExpiredState(props: NamedStateViewProps) {
  return <StateView {...props} kind="session-expired" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
  },
  compact: {
    flex: 0,
    minHeight: 144,
    padding: spacing.lg,
  },
  centered: {
    textAlign: 'center',
  },
  emoji: {
    fontFamily: undefined,
    fontSize: 36,
    lineHeight: 44,
  },
  compactEmoji: {
    fontSize: 28,
    lineHeight: 34,
  },
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
});
