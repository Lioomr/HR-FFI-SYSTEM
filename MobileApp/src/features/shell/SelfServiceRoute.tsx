import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

import { isEmployeeSelfServiceRole, normalizeRole } from '@/auth/role';
import { useAuth } from '@/providers';

import { appRoutes } from './routes';

/**
 * Defense in depth: Expo Router discovers every file under `(tabs)/` whether or
 * not the tab bar shows it, so an approver-only session that somehow reaches an
 * employee self-service route is sent to Approvals instead of rendering it.
 */
export function withSelfServiceGuard<P extends object>(Screen: ComponentType<P>) {
  return function SelfServiceRoute(props: P) {
    const { user } = useAuth();

    if (!isEmployeeSelfServiceRole(normalizeRole(user?.role))) {
      return <Redirect href={appRoutes.approvals} />;
    }

    return <Screen {...props} />;
  };
}
