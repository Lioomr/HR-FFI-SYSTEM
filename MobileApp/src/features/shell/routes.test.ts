import { describe, expect, it } from '@jest/globals';

import { appRoutes, initialRouteForAuthStatus } from './routes';

describe('protected navigation decisions', () => {
  it('keeps navigation pending while the secure session bootstraps', () => {
    expect(initialRouteForAuthStatus('bootstrapping')).toBeNull();
  });

  it('routes only authenticated state into the protected home anchor', () => {
    expect(initialRouteForAuthStatus('authenticated')).toBe('/home');
    expect(initialRouteForAuthStatus('unauthenticated')).toBe('/login');
  });

  it('contains no route parameters, query strings, or token-shaped path names', () => {
    for (const [name, path] of Object.entries(appRoutes)) {
      expect(path).toMatch(/^\/[a-z-]+$/);
      expect(`${name}:${path}`).not.toMatch(/token|jwt|secret|password=/i);
    }
  });
});
