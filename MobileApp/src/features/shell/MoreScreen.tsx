import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppText, Button, Card, Screen } from '@/components/ui';
import { spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { appRoutes } from './routes';

export function MoreScreen() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const { t } = useLocalization();
  const [loggingOut, setLoggingOut] = useState(false);

  const submitLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // AuthProvider transitions to unauthenticated in finally; errors remain redacted.
    }
  };

  return (
    <Screen edges={['top', 'right', 'left']} scroll>
      <View style={styles.container}>
        <AppText accessibilityRole="header" variant="title1">
          {t('more.title')}
        </AppText>
        <Card>
          <AppText variant="headline">{user?.full_name?.trim() || user?.email}</AppText>
          <AppText tone="muted" variant="subhead">
            {user?.role}
          </AppText>
        </Card>
        <View style={styles.actions}>
          <Button
            fullWidth
            label={t('more.changePassword')}
            onPress={() => router.push(appRoutes.changePassword)}
            variant="secondary"
          />
          <Button
            accessibilityLabel={loggingOut ? t('auth.loggingOut') : t('more.logout')}
            fullWidth
            label={t('more.logout')}
            loading={loggingOut}
            onPress={() => void submitLogout()}
            variant="destructive"
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxl,
  },
  actions: {
    gap: spacing.md,
  },
});
