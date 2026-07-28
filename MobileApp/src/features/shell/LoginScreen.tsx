import { useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';

import { createFieldAccessibility } from '@/accessibility';
import { ApiError } from '@/services/api/api-error';
import { AppText, Button, Field, OfflineState, Screen } from '@/components/ui';
import { spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

import { ShellSessionExpiredState } from './AppStateScreen';

export function LoginScreen() {
  const { login, sessionNotice } = useAuth();
  const { t } = useLocalization();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<ApiError['code'] | null>(null);

  const submit = async () => {
    if (!email.trim() || !password || submitting) return;
    Keyboard.dismiss();
    setSubmitting(true);
    setErrorCode(null);
    try {
      await login({ email, password });
    } catch (error) {
      setErrorCode(error instanceof ApiError ? error.code : 'request_failed');
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.screen}
      scrollViewProps={{ keyboardDismissMode: 'interactive' }}
    >
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="display">
          {t('auth.loginTitle')}
        </AppText>
        <AppText tone="muted" variant="body">
          {t('auth.loginSubtitle')}
        </AppText>
      </View>

      {sessionNotice === 'session-expired' ? <ShellSessionExpiredState /> : null}
      {errorCode === 'network_unavailable' ? (
        <OfflineState compact title={t('state.offlineTitle')} message={t('state.offlineBody')} />
      ) : null}
      {errorCode && errorCode !== 'network_unavailable' ? (
        <AppText accessibilityLiveRegion="assertive" tone="error" variant="subhead">
          {errorCode === 'authentication_failed'
            ? t('auth.invalidCredentials')
            : t('state.errorBody')}
        </AppText>
      ) : null}

      <View style={styles.form}>
        <Field
          {...createFieldAccessibility({ label: t('auth.emailLabel') })}
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          label={t('auth.emailLabel')}
          onChangeText={setEmail}
          placeholder={t('auth.emailPlaceholder')}
          returnKeyType="next"
          textContentType="username"
          value={email}
        />
        <Field
          {...createFieldAccessibility({
            hint: t('accessibility.secureFieldHint'),
            label: t('auth.passwordLabel'),
          })}
          autoCapitalize="none"
          autoComplete="current-password"
          label={t('auth.passwordLabel')}
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          placeholder={t('auth.passwordPlaceholder')}
          returnKeyType="go"
          secureTextEntry
          textContentType="password"
          value={password}
        />
        <Button
          accessibilityLabel={submitting ? t('auth.signingIn') : t('auth.signIn')}
          disabled={!email.trim() || !password}
          fullWidth
          label={t('auth.signIn')}
          loading={submitting}
          onPress={() => void submit()}
        />
      </View>

      <AppText style={styles.notice} tone="muted" variant="footnote">
        {t('auth.secureSessionNotice')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  heading: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  notice: {
    textAlign: 'center',
  },
});
