import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  SessionExpiredState,
} from '@/components/ui';
import { useLocalization } from '@/i18n';

interface RetryableStateProps {
  onRetry?: () => void;
}

export function BootstrapScreen() {
  const { t } = useLocalization();
  return (
    <Screen>
      <LoadingState title={t('state.loadingTitle')} message={t('state.loadingBody')} />
    </Screen>
  );
}

/**
 * Shown when stored credentials could not be confirmed because the server was
 * unreachable. The session is intact, so the only action offered is to try again.
 */
export function BootstrapUnreachableScreen({ onRetry }: Required<RetryableStateProps>) {
  const { t } = useLocalization();
  return (
    <Screen>
      <OfflineState
        action={
          <Button
            accessibilityHint={t('accessibility.retryHint')}
            fullWidth
            label={t('common.retry')}
            onPress={onRetry}
            testID="bootstrap-retry"
          />
        }
        message={t('state.offlineBody')}
        title={t('state.offlineTitle')}
      />
    </Screen>
  );
}

/**
 * Gate 4 cold-launch lock. A stored session was restored but the device owner has not
 * been re-verified, so no HR data is rendered behind this screen. The challenge runs on
 * mount and can be retried; signing out is the only other way forward.
 */
export function SessionLockedScreen({
  busy,
  onSignOut,
  onUnlock,
  reason,
}: {
  busy: boolean;
  onSignOut: () => void;
  onUnlock: () => void;
  reason: 'refused' | 'unavailable' | null;
}) {
  const { t } = useLocalization();
  // A device with no biometric and no passcode cannot pass the challenge at all, so it
  // is told what to change rather than being looped through a futile retry.
  const unprotected = reason === 'unavailable';
  return (
    <Screen>
      <ErrorState
        action={
          <>
            <Button
              accessibilityHint={t('lock.unlockHint')}
              disabled={busy}
              fullWidth
              label={busy ? t('lock.unlocking') : t('lock.unlock')}
              loading={busy}
              onPress={onUnlock}
              testID="session-unlock"
            />
            <Button
              disabled={busy}
              fullWidth
              label={t('auth.logout')}
              onPress={onSignOut}
              testID="session-lock-sign-out"
              variant="secondary"
            />
          </>
        }
        message={unprotected ? t('lock.unprotectedBody') : t('lock.body')}
        title={unprotected ? t('lock.unprotectedTitle') : t('lock.title')}
      />
    </Screen>
  );
}

export function ShellEmptyState({ emoji }: { emoji?: string }) {
  const { t } = useLocalization();
  return <EmptyState emoji={emoji} title={t('state.emptyTitle')} message={t('state.emptyBody')} />;
}

export function ShellErrorState({ onRetry }: RetryableStateProps) {
  const { t } = useLocalization();
  return (
    <ErrorState
      title={t('state.errorTitle')}
      message={t('state.errorBody')}
      action={onRetry ? <Button label={t('common.retry')} onPress={onRetry} /> : undefined}
    />
  );
}

export function ShellOfflineState({ onRetry }: RetryableStateProps) {
  const { t } = useLocalization();
  return (
    <OfflineState
      title={t('state.offlineTitle')}
      message={t('state.offlineBody')}
      action={onRetry ? <Button label={t('common.retry')} onPress={onRetry} /> : undefined}
    />
  );
}

export function ShellSessionExpiredState() {
  const { t } = useLocalization();
  return (
    <SessionExpiredState
      compact
      title={t('state.sessionExpiredTitle')}
      message={t('state.sessionExpiredBody')}
    />
  );
}
