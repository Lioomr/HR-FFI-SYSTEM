import type { AuthStatus } from '@/providers';

/** Public, token-free paths only. Sensitive values must never become route parameters. */
export const appRoutes = Object.freeze({
  approvals: '/approvals',
  attendance: '/attendance',
  changePassword: '/change-password',
  home: '/home',
  leave: '/leave',
  login: '/login',
  more: '/more',
  notifications: '/notifications',
} as const);

/**
 * `null` keeps the entry route mounted so it can render a pending or retryable state.
 * An unreachable bootstrap must not fall through to the login screen: the stored
 * session is still valid and is retried rather than discarded.
 */
export function initialRouteForAuthStatus(status: AuthStatus) {
  // `locked` holds navigation on the entry route so the lock screen stays in control.
  if (status === 'bootstrapping' || status === 'bootstrap-unreachable' || status === 'locked') {
    return null;
  }
  return status === 'authenticated' ? appRoutes.home : appRoutes.login;
}
