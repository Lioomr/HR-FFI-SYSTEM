import type { ReactNode } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  SessionExpiredState,
  StateView,
} from '@/components/ui';
import { useLocalization } from '@/i18n';

import type { ResourceFailureKind } from './resource';

interface FailureProps {
  kind: ResourceFailureKind;
  onRetry?: () => void;
  compact?: boolean;
  retrying?: boolean;
}

/**
 * One localized failure vocabulary for every Gate 3 screen. Forbidden and not-found stay
 * deliberately generic: the server already hides cross-company and cross-owner records.
 */
export function ResourceFailure({
  compact = false,
  kind,
  onRetry,
  retrying = false,
}: FailureProps) {
  const { t } = useLocalization();
  const action =
    onRetry && kind !== 'session-expired' ? (
      <Button
        accessibilityLabel={retrying ? t('common.retrying') : t('common.retry')}
        accessibilityHint={t('accessibility.retryHint')}
        fullWidth
        label={retrying ? t('common.retrying') : t('common.retry')}
        loading={retrying}
        onPress={onRetry}
        size="compact"
        variant="secondary"
      />
    ) : undefined;

  if (kind === 'offline') {
    return (
      <OfflineState
        action={action}
        compact={compact}
        message={t('state.offlineBody')}
        title={t('state.offlineTitle')}
      />
    );
  }
  if (kind === 'session-expired') {
    return (
      <SessionExpiredState
        compact={compact}
        message={t('state.sessionExpiredBody')}
        title={t('state.sessionExpiredTitle')}
      />
    );
  }
  if (kind === 'forbidden') {
    return (
      <StateView
        action={action}
        compact={compact}
        emoji="🔒"
        kind="session-expired"
        message={t('state.unauthorizedBody')}
        title={t('state.unauthorizedTitle')}
      />
    );
  }
  if (kind === 'not-found') {
    return (
      <EmptyState
        action={action}
        compact={compact}
        message={t('state.notFoundBody')}
        title={t('state.notFoundTitle')}
      />
    );
  }
  return (
    <ErrorState
      action={action}
      compact={compact}
      message={t('state.errorBody')}
      title={t('state.errorTitle')}
    />
  );
}

interface ResourceLoadingProps {
  compact?: boolean;
  skeleton?: ReactNode;
}

export function ResourceLoading({ compact = false, skeleton }: ResourceLoadingProps) {
  const { t } = useLocalization();
  if (skeleton) return <>{skeleton}</>;
  return (
    <LoadingState
      compact={compact}
      message={t('state.loadingBody')}
      title={t('state.loadingTitle')}
    />
  );
}
