import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeader,
} from '@/components/ui';
import { colors, spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { appRoutes } from '../shell/routes';

import { DocumentsSheet } from './DocumentsSheet';
import { LanguageSelector } from './LanguageSelector';
import { PayslipsSheet } from './PayslipsSheet';
import { ProfileSheet } from './ProfileSheet';

type OpenSheet = 'profile' | 'payslips' | 'documents' | null;

export function MoreScreen() {
  const router = useRouter();
  const { company, logout, user } = useAuth();
  const { directionHelpers, t } = useLocalization();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const submitLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // AuthProvider transitions to unauthenticated in finally; errors remain redacted.
    }
  }, [loggingOut, logout]);

  const displayName = user?.full_name?.trim() || user?.email || t('common.notAvailable');

  return (
    <Screen contentContainerStyle={styles.content} edges={['top', 'right', 'left']} scroll>
      <ScreenHeader subtitle={t('more.subtitle')} title={t('more.title')} />

      <Card elevated>
        <View style={styles.identity}>
          <AppText accessibilityRole="header" style={directionHelpers.text} variant="title2">
            {displayName}
          </AppText>
          {user?.email ? (
            <AppText style={directionHelpers.text} tone="muted" variant="subhead">
              {user.email}
            </AppText>
          ) : null}
          {company?.name ? (
            <AppText style={directionHelpers.text} tone="muted" variant="footnote">
              {`${t('more.company')}: ${company.name}`}
            </AppText>
          ) : null}
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader title={t('more.account')} />
        <Card>
          <View accessibilityRole="list" style={styles.list}>
            <ListRow
              accessibilityHint={t('accessibility.opensDetailHint')}
              onPress={() => setSheet('profile')}
              subtitle={t('more.profileHint')}
              testID="more-profile"
              title={t('more.profile')}
            />
            <View style={styles.separated}>
              <ListRow
                accessibilityHint={t('accessibility.opensDetailHint')}
                onPress={() => setSheet('payslips')}
                subtitle={t('more.payslipsHint')}
                testID="more-payslips"
                title={t('more.payslips')}
              />
            </View>
            <View style={styles.separated}>
              <ListRow
                accessibilityHint={t('accessibility.opensDetailHint')}
                onPress={() => setSheet('documents')}
                subtitle={t('more.documentsHint')}
                testID="more-documents"
                title={t('more.documents')}
              />
            </View>
          </View>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('more.language')} />
        <Card>
          <AppText style={directionHelpers.text} tone="muted" variant="footnote">
            {t('more.languageHint')}
          </AppText>
          <LanguageSelector />
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('more.security')} />
        <View style={styles.actions}>
          <Button
            accessibilityHint={t('more.changePasswordHint')}
            fullWidth
            label={t('more.changePassword')}
            onPress={() => router.push(appRoutes.changePassword)}
            testID="more-change-password"
            variant="secondary"
          />
          <Button
            accessibilityHint={t('more.logoutHint')}
            accessibilityLabel={loggingOut ? t('auth.loggingOut') : t('more.logout')}
            fullWidth
            label={t('more.logout')}
            loading={loggingOut}
            onPress={() => void submitLogout()}
            testID="more-logout"
            variant="destructive"
          />
        </View>
      </View>

      {sheet === 'profile' ? <ProfileSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'payslips' ? <PayslipsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'documents' ? <DocumentsSheet onClose={() => setSheet(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingBottom: spacing.section,
  },
  identity: {
    gap: spacing.xxs,
  },
  section: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.xs,
  },
  separated: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actions: {
    gap: spacing.md,
  },
});
