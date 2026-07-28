import { describe, expect, it, jest } from '@jest/globals';

import { ApiClient } from '@/services/api/api-client';
import type { CredentialStore, FetchLike, SessionCredentials } from '@/services/api/types';

import { AuthClient } from './auth-client';
import type { AuthUser } from './types';

class FakeCredentialStore implements CredentialStore {
  value: SessionCredentials | null = null;
  clearCount = 0;

  async read() {
    return this.value;
  }

  async replace(credentials: SessionCredentials) {
    this.value = { ...credentials };
  }

  async clear() {
    this.value = null;
    this.clearCount += 1;
  }
}

function response(status: number, data?: unknown): Response {
  return {
    json: async () => data,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function success<T>(data: T): Response {
  return response(200, { status: 'success', data });
}

const user: AuthUser = {
  accessible_organizations: [{ id: 7, name: 'FFI Egypt' }],
  default_organization_id: 7,
  email: 'employee@example.com',
  has_all_company_access: false,
  id: 'user-1',
  role: 'Employee',
};

const access = 'access-secret';
const refresh = 'refresh-secret';

describe('AuthClient', () => {
  it('implements the verified login contract and atomically establishes the session', async () => {
    const store = new FakeCredentialStore();
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      success({ access, refresh, token: access, user }),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });
    const auth = new AuthClient(api);

    await expect(
      auth.login({ email: ' employee@example.com ', password: 'not-a-real-password' }),
    ).resolves.toEqual(user);

    expect(store.value).toEqual({ accessToken: access, refreshToken: refresh });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hr.example.com/auth/login');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'employee@example.com',
      password: 'not-a-real-password',
    });
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('rejects a mismatched backward-compatible token alias', async () => {
    const store = new FakeCredentialStore();
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: jest.fn(async () =>
        success({ access, refresh, token: 'different', user }),
      ) as FetchLike,
    });

    await expect(
      new AuthClient(api).login({ email: user.email, password: 'not-a-real-password' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(store.value).toBeNull();
  });

  it('bootstraps with GET /auth/me then scopes later calls using memory-only company state', async () => {
    const store = new FakeCredentialStore();
    store.value = { accessToken: access, refreshToken: refresh };
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      success(user),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });
    const auth = new AuthClient(api);

    await expect(auth.restoreSession()).resolves.toEqual(user);
    await api.request('/api/notifications/');

    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(firstHeaders['x-active-company-id']).toBeUndefined();
    expect(secondHeaders['x-active-company-id']).toBe('7');
  });

  it('always clears credentials and memory after logout, including request failure', async () => {
    const store = new FakeCredentialStore();
    store.value = { accessToken: access, refreshToken: refresh };
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: jest.fn(async () => {
        throw new Error('private native failure');
      }) as FetchLike,
    });
    const auth = new AuthClient(api);

    await expect(auth.logout()).rejects.toMatchObject({ code: 'network_unavailable' });
    expect(store.value).toBeNull();
    expect(auth.user).toBeNull();
  });

  it('uses the verified password body and clears the revoked session on success', async () => {
    const store = new FakeCredentialStore();
    store.value = { accessToken: access, refreshToken: refresh };
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      success({}),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });
    const auth = new AuthClient(api);

    await auth.changePassword({ currentPassword: 'old-value', newPassword: 'new-value' });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      current_password: 'old-value',
      new_password: 'new-value',
    });
    expect(store.value).toBeNull();
    expect(auth.user).toBeNull();
  });

  it('does not clear a valid session when password validation fails', async () => {
    const store = new FakeCredentialStore();
    store.value = { accessToken: access, refreshToken: refresh };
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: jest.fn(async () => response(422, { detail: 'must never leak' })) as FetchLike,
    });

    await expect(
      new AuthClient(api).changePassword({ currentPassword: 'old-value', newPassword: 'weak' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(store.value).toEqual({ accessToken: access, refreshToken: refresh });
  });
});
