import { Redirect } from 'expo-router';

import {
  BootstrapScreen,
  BootstrapUnreachableScreen,
  initialRouteForAuthStatus,
} from '@/features/shell';
import { useAuth } from '@/providers';

export default function RootRoute() {
  const { retryBootstrap, status } = useAuth();

  const initialRoute = initialRouteForAuthStatus(status);
  if (status === 'bootstrap-unreachable') {
    return <BootstrapUnreachableScreen onRetry={() => void retryBootstrap()} />;
  }
  if (!initialRoute) return <BootstrapScreen />;
  return <Redirect href={initialRoute} />;
}
