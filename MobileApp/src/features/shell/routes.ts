import type { AuthStatus } from '@/providers';

/** Public, token-free paths only. Sensitive values must never become route parameters. */
export const appRoutes = Object.freeze({
  attendance: '/attendance',
  changePassword: '/change-password',
  home: '/home',
  leave: '/leave',
  login: '/login',
  more: '/more',
  notifications: '/notifications',
} as const);

export function initialRouteForAuthStatus(status: AuthStatus) {
  if (status === 'bootstrapping') return null;
  return status === 'authenticated' ? appRoutes.home : appRoutes.login;
}
