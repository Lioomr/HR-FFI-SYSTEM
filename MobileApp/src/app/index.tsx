import { Redirect } from 'expo-router';

import { BootstrapScreen, initialRouteForAuthStatus } from '@/features/shell';
import { useAuth } from '@/providers';

export default function RootRoute() {
  const { status } = useAuth();

  const initialRoute = initialRouteForAuthStatus(status);
  if (!initialRoute) return <BootstrapScreen />;
  return <Redirect href={initialRoute} />;
}
