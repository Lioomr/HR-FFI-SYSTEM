import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { AuthUser } from '@/auth';
import { ApiError } from '@/services/api/api-error';

import { AuthProvider, type AuthService, useAuth } from './AuthProvider';

const user: AuthUser = {
  accessible_organizations: [
    { id: 7, name: 'FFI Egypt' },
    { id: 8, name: 'FFI Gulf' },
  ],
  default_organization_id: 7,
  email: 'employee@example.com',
  has_all_company_access: false,
  id: 'user-1',
  role: 'Employee',
};

function fakeAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    changePassword: jest.fn(async () => undefined),
    login: jest.fn(async () => user),
    logout: jest.fn(async () => undefined),
    restoreSession: jest.fn(async () => null),
    selectActiveCompany: jest.fn(() => undefined),
    ...overrides,
  };
}

function wrapperFor(client: AuthService) {
  return function Wrapper({ children }: React.PropsWithChildren) {
    return <AuthProvider client={client}>{children}</AuthProvider>;
  };
}

describe('AuthProvider', () => {
  it('bootstraps SecureStore-backed credentials through authClient restore and keeps identity in memory', async () => {
    const client = fakeAuthService({ restoreSession: jest.fn(async () => user) });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.user).toEqual(user);
    expect(result.current.company).toEqual(user.accessible_organizations[0]);
    expect(client.restoreSession).toHaveBeenCalledTimes(1);
  });

  it('always removes authenticated UI state when logout transport fails', async () => {
    const client = fakeAuthService({
      logout: jest.fn(async () => {
        throw new ApiError('network_unavailable');
      }),
      restoreSession: jest.fn(async () => user),
    });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await expect(result.current.logout()).rejects.toMatchObject({ code: 'network_unavailable' });
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
    expect(result.current.company).toBeNull();
  });

  it('handles only redacted session-expiration errors as an auth boundary transition', async () => {
    const client = fakeAuthService({ restoreSession: jest.fn(async () => user) });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      expect(result.current.handleApiError(new Error('private transport details'))).toBe(false);
      expect(result.current.handleApiError(new ApiError('session_expired', 401))).toBe(true);
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.sessionNotice).toBe('session-expired');
  });

  it('validates company selection against the memory-only user organization list', async () => {
    const client = fakeAuthService({ restoreSession: jest.fn(async () => user) });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => result.current.selectCompany(8));
    expect(result.current.company).toEqual(user.accessible_organizations[1]);
    expect(client.selectActiveCompany).toHaveBeenCalledWith(8);
  });
});
