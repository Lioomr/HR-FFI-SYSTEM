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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

  it('keeps a transient bootstrap failure retryable instead of presenting login', async () => {
    const client = fakeAuthService({
      restoreSession: jest.fn(async () => {
        throw new ApiError('network_unavailable');
      }),
    });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.status).toBe('bootstrap-unreachable'));
    expect(result.current.user).toBeNull();
    expect(result.current.sessionNotice).toBeNull();
  });

  it('guards duplicate retries while a bootstrap request is in flight', async () => {
    const retry = deferred<AuthUser>();
    const restoreSession = jest
      .fn<() => Promise<AuthUser | null>>()
      .mockRejectedValueOnce(new ApiError('network_unavailable'))
      .mockImplementationOnce(() => retry.promise);
    const client = fakeAuthService({ restoreSession });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('bootstrap-unreachable'));

    let firstRetry!: Promise<void>;
    let duplicateRetry!: Promise<void>;
    await act(async () => {
      firstRetry = result.current.retryBootstrap();
      duplicateRetry = result.current.retryBootstrap();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('bootstrapping');
    expect(restoreSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      retry.resolve(user);
      await firstRetry;
      await duplicateRetry;
    });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(restoreSession).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale bootstrap failure overwrite a successful retry', async () => {
    const staleBootstrap = deferred<AuthUser>();
    const retry = deferred<AuthUser>();
    const restoreSession = jest
      .fn<() => Promise<AuthUser | null>>()
      .mockImplementationOnce(() => staleBootstrap.promise)
      .mockImplementationOnce(() => retry.promise);
    const client = fakeAuthService({ restoreSession });
    const { result } = await renderHook(() => useAuth(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.status).toBe('bootstrapping'));

    let retryRequest!: Promise<void>;
    await act(async () => {
      retryRequest = result.current.retryBootstrap();
      await Promise.resolve();
    });
    expect(restoreSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      retry.resolve(user);
      await retryRequest;
    });
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      staleBootstrap.reject(new ApiError('network_unavailable'));
      await staleBootstrap.promise.catch(() => undefined);
    });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(user);
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
