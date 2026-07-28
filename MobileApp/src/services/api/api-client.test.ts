import { describe, expect, it, jest } from '@jest/globals';

import { ApiClient, validateApiBaseUrl } from './api-client';
import { ApiError } from './api-error';
import type { CredentialStore, FetchLike, SessionCredentials } from './types';

class FakeCredentialStore implements CredentialStore {
  value: SessionCredentials | null;
  replacements: SessionCredentials[] = [];
  clearCount = 0;

  constructor(value: SessionCredentials | null = null) {
    this.value = value;
  }

  async read() {
    return this.value ? { ...this.value } : null;
  }

  async replace(credentials: SessionCredentials) {
    this.value = { ...credentials };
    this.replacements.push({ ...credentials });
  }

  async clear() {
    this.value = null;
    this.clearCount += 1;
  }
}

class BlockingReplacementStore extends FakeCredentialStore {
  private releaseReplacement!: () => void;
  private readonly replacementGate = new Promise<void>((resolve) => {
    this.releaseReplacement = resolve;
  });
  private replacementStartedResolve!: () => void;
  readonly replacementStarted = new Promise<void>((resolve) => {
    this.replacementStartedResolve = resolve;
  });

  override async replace(credentials: SessionCredentials) {
    this.replacementStartedResolve();
    await this.replacementGate;
    await super.replace(credentials);
  }

  release() {
    this.releaseReplacement();
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

const oldSession = { accessToken: 'old-access-secret', refreshToken: 'old-refresh-secret' };
const newSession = { accessToken: 'new-access-secret', refreshToken: 'new-refresh-secret' };

describe('validateApiBaseUrl', () => {
  it('accepts production HTTPS and strips trailing slashes', () => {
    expect(validateApiBaseUrl('https://hr.example.com///')).toBe('https://hr.example.com');
  });

  it('rejects insecure production origins and embedded URL data', () => {
    expect(() => validateApiBaseUrl('http://hr.example.com')).toThrow('must use HTTPS');
    expect(() => validateApiBaseUrl('https://user:pass@hr.example.com')).toThrow(
      'must not contain',
    );
    expect(() => validateApiBaseUrl('https://hr.example.com?access_token=secret')).toThrow(
      'must not contain',
    );
  });

  it('allows explicitly marked development HTTP and loopback HTTP only', () => {
    expect(validateApiBaseUrl('http://192.168.1.20:8000', true)).toBe('http://192.168.1.20:8000');
    expect(validateApiBaseUrl('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000');
  });
});

describe('ApiClient authentication lifecycle', () => {
  it('scopes authenticated requests with bearer and memory-only company headers', async () => {
    const store = new FakeCredentialStore(oldSession);
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      success({ id: 'me' }),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });
    api.setActiveCompanyId(42);

    await api.request('/auth/me');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://hr.example.com/auth/me');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Bearer ${oldSession.accessToken}`,
      'x-active-company-id': '42',
    });
    expect(JSON.stringify(store.value)).not.toContain('42');
  });

  it('never sends stale authorization or company headers to unauthenticated requests', async () => {
    const store = new FakeCredentialStore(oldSession);
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      success({ ok: true }),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });
    api.setActiveCompanyId('company-a');

    await api.request('/auth/login', {
      authenticated: false,
      body: { email: 'employee@example.com', password: 'not-a-real-password' },
      method: 'POST',
    });

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['x-active-company-id']).toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('omit');
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
  });

  it('rotates credentials on 401, omits stale access from refresh, and replays once', async () => {
    const store = new FakeCredentialStore(oldSession);
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      if (url.endsWith('/auth/refresh')) {
        expect(headers.Authorization).toBeUndefined();
        expect(headers['x-active-company-id']).toBeUndefined();
        expect(JSON.parse(String(init?.body))).toEqual({ refresh: oldSession.refreshToken });
        return success({
          access: newSession.accessToken,
          refresh: newSession.refreshToken,
          token: newSession.accessToken,
        });
      }
      return headers.Authorization === `Bearer ${oldSession.accessToken}`
        ? response(401)
        : success({ records: [] });
    });
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });

    await expect(api.request('/api/attendance/me/')).resolves.toEqual({ records: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.value).toEqual(newSession);
    expect(store.replacements).toEqual([newSession]);
  });

  it('uses one refresh for concurrent 401 responses', async () => {
    const store = new FakeCredentialStore(oldSession);
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshCalls = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await refreshGate;
        return success({
          access: newSession.accessToken,
          refresh: newSession.refreshToken,
          token: newSession.accessToken,
        });
      }
      return headers.Authorization === `Bearer ${oldSession.accessToken}`
        ? response(401)
        : success({ path: url });
    });
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });

    const first = api.request('/api/attendance/me/');
    const second = api.request('/api/notifications/');
    await Promise.resolve();
    await Promise.resolve();
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(refreshCalls).toBe(1);
    expect(store.replacements).toHaveLength(1);
  });

  it('cannot resurrect persisted credentials when session clearing races rotation', async () => {
    const store = new BlockingReplacementStore(oldSession);
    const fetchMock = jest.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/auth/refresh')
        ? success({
            access: newSession.accessToken,
            refresh: newSession.refreshToken,
            token: newSession.accessToken,
          })
        : response(401),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });

    const request = api.request('/auth/me');
    await store.replacementStarted;
    const clearing = api.clearSession();
    store.release();

    await expect(request).rejects.toMatchObject({ code: 'session_expired' });
    await expect(clearing).resolves.toBeUndefined();
    expect(store.value).toBeNull();
  });

  it('clears credentials when refresh fails and does not leak token data in errors', async () => {
    const store = new FakeCredentialStore(oldSession);
    const fetchMock = jest.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/auth/refresh') ? response(401) : response(401),
    );
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });

    let caught: unknown;
    try {
      await api.request('/auth/me');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe('session_expired');
    const serialized = JSON.stringify(caught);
    expect(`${String(caught)} ${serialized}`).not.toContain(oldSession.accessToken);
    expect(`${String(caught)} ${serialized}`).not.toContain(oldSession.refreshToken);
    expect(store.value).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not enter an infinite refresh loop when the replay is unauthorized', async () => {
    const store = new FakeCredentialStore(oldSession);
    let refreshCalls = 0;
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return success({
          access: newSession.accessToken,
          refresh: newSession.refreshToken,
          token: newSession.accessToken,
        });
      }
      return response(401);
    });
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });

    await expect(api.request('/auth/me')).rejects.toMatchObject({ code: 'session_expired' });
    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.value).toBeNull();
  });

  it('replaces native network details with a safe error', async () => {
    const store = new FakeCredentialStore(oldSession);
    const fetchMock = jest.fn(async () => {
      throw new Error(
        `failed request with ${oldSession.accessToken} at https://secret.example/path`,
      );
    });
    const api = new ApiClient({
      baseUrl: 'https://hr.example.com',
      credentialStore: store,
      fetchImpl: fetchMock as FetchLike,
    });

    await expect(api.request('/auth/me')).rejects.toEqual(new ApiError('network_unavailable'));
  });
});
