import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, EmptyState, Screen } from '@/components/ui';
import { spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useNotificationPolling } from '@/providers';

import { ShellErrorState, ShellOfflineState } from './AppStateScreen';

export function NotificationsScreen() {
  const { refresh, status, unreadCount } = useNotificationPolling();
  const { t } = useLocalization();

  return (
    <Screen edges={['top', 'right', 'left']}>
      <View style={styles.container}>
        <AppText accessibilityRole="header" variant="title1">
          {t('notifications.title')}
        </AppText>
        {status === 'offline' ? <ShellOfflineState onRetry={() => void refresh()} /> : null}
        {status === 'error' ? <ShellErrorState onRetry={() => void refresh()} /> : null}
        {(status === 'idle' || status === 'polling') && unreadCount === 0 ? (
          <EmptyState title={t('state.loadingTitle')} message={t('state.loadingBody')} />
        ) : null}
        {status === 'ready' && unreadCount === 0 ? (
          <EmptyState
            emoji="🔔"
            title={t('notifications.title')}
            message={t('notifications.noNotifications')}
          />
        ) : null}
        {status === 'ready' && unreadCount > 0 ? (
          <Card>
            <AppText variant="title2">
              {t('notifications.unreadCount', { count: unreadCount })}
            </AppText>
            <Button
              label={t('common.refresh')}
              onPress={() => void refresh()}
              variant="secondary"
            />
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: spacing.lg,
  },
});
