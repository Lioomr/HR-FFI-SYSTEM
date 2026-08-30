import { Redirect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  BootstrapScreen,
  BootstrapUnreachableScreen,
  initialRouteForAuthStatus,
  SessionLockedScreen,
} from '@/features/shell';
import { useLocalization } from '@/i18n';
import { useAuth } from '@/providers';

export default function RootRoute() {
  const { lockReason, logout, retryBootstrap, status, unlock } = useAuth();
  const { t } = useLocalization();
  const [unlocking, setUnlocking] = useState(false);

  // The bootstrap already issued one challenge. Further attempts are user-initiated so a
  // cancelled prompt cannot loop.
  const runUnlock = useCallback(async () => {
    setUnlocking(true);
    try {
      await unlock({ promptMessage: t('lock.prompt'), cancelLabel: t('common.cancel') });
    } finally {
      setUnlocking(false);
    }
  }, [t, unlock]);

  if (status === 'bootstrap-unreachable') {
    return <BootstrapUnreachableScreen onRetry={() => void retryBootstrap()} />;
  }
  if (status === 'locked') {
    return (
      <SessionLockedScreen
        busy={unlocking}
        onSignOut={() => void logout()}
        onUnlock={() => void runUnlock()}
        reason={lockReason}
      />
    );
  }

  const initialRoute = initialRouteForAuthStatus(status);
  if (!initialRoute) return <BootstrapScreen />;
  return <Redirect href={initialRoute} />;
}
