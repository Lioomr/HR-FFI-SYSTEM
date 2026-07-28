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
