import { useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { createFieldAccessibility } from '@/accessibility';
import { AppText, Button, Field, Screen } from '@/components/ui';
import { spacing } from '@/design-system';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

export function ChangePasswordScreen() {
  const router = useRouter();
  const { changePassword, handleApiError } = useAuth();
  const { t } = useLocalization();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasError, setHasError] = useState(false);
  const matches = newPassword.length > 0 && newPassword === confirmation;

  const submit = async () => {
    if (!currentPassword || !matches || submitting) return;
    Keyboard.dismiss();
    setSubmitting(true);
    setHasError(false);
    try {
      await changePassword({ currentPassword, newPassword });
    } catch (error) {
      if (!handleApiError(error)) setHasError(true);
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.screen}>
      <View style={styles.heading}>
        <AppText accessibilityRole="header" variant="title1">
          {t('auth.changePassword')}
        </AppText>
        {hasError ? (
          <AppText accessibilityLiveRegion="assertive" tone="error" variant="subhead">
            {t('state.errorBody')}
          </AppText>
        ) : null}
      </View>
      <View style={styles.form}>
        <Field
          {...createFieldAccessibility({
            hint: t('accessibility.secureFieldHint'),
            label: t('auth.currentPassword'),
          })}
          autoComplete="current-password"
          label={t('auth.currentPassword')}
          onChangeText={setCurrentPassword}
          secureTextEntry
          textContentType="password"
          value={currentPassword}
        />
        <Field
          {...createFieldAccessibility({
            hint: t('accessibility.secureFieldHint'),
            label: t('auth.newPassword'),
          })}
          autoComplete="new-password"
          label={t('auth.newPassword')}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
          value={newPassword}
        />
        <Field
          {...createFieldAccessibility({
            hint: t('accessibility.secureFieldHint'),
            label: t('auth.confirmPassword'),
          })}
          autoComplete="new-password"
          label={t('auth.confirmPassword')}
          onChangeText={setConfirmation}
          onSubmitEditing={() => void submit()}
          secureTextEntry
          textContentType="newPassword"
          value={confirmation}
        />
        <Button
          accessibilityLabel={submitting ? t('auth.updatingPassword') : t('auth.updatePassword')}
          disabled={!currentPassword || !matches}
          fullWidth
          label={t('auth.updatePassword')}
          loading={submitting}
          onPress={() => void submit()}
        />
        <Button
          disabled={submitting}
          fullWidth
          label={t('common.cancel')}
          onPress={() => router.back()}
          variant="ghost"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.xxl,
  },
  heading: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
});
