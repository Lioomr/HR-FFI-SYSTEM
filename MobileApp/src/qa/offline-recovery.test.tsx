import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react-native';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Pressable, Text } from 'react-native';

import { ResourceFailure, useResource } from '@/features/shared';
import { useAuth } from '@/providers';
import { ApiClient, ApiError, type CredentialStore, type FetchLike } from '@/services/api';

import { providerWrapper, renderWithProviders, stubAuthService } from './harness';

const sourceRoot = join(__dirname, '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'qa' ? [] : sourceFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(entry.name)) return [];
    return [path];
  });
}

const credentialStore: CredentialStore = {
  read: async () => ({ accessToken: 'access', refreshToken: 'refresh' }),
  replace: async () => undefined,
  clear: async () => undefined,
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ status: 'success', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('offline -> online -> retry recovery', () => {
  it('issues a fresh request and replaces the offline state with data', async () => {
    let online = false;
    const requestSignals: AbortSignal[] = [];
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignals.push(init?.signal as AbortSignal);
      if (!online) throw new TypeError('Network request failed');
      return jsonResponse({ items: [{ id: 1 }] });
    });
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const load = () => client.request<{ items: unknown[] }>('/api/attendance/me/');

    const { result } = await renderHook(() => useResource(load), { wrapper: providerWrapper() });

    await waitFor(() =>
      expect(result.current.resource).toEqual({ status: 'error', kind: 'offline' }),
    );

    online = true;
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.resource).toEqual({ status: 'ready', data: { items: [{ id: 1 }] } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals[0]).not.toBe(requestSignals[1]);
  });

  it('replaces the offline state with an honest empty state when the server has no data', async () => {
    let online = false;
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      fetchImpl: (async () => {
        if (!online) throw new TypeError('Network request failed');
        return jsonResponse({ items: [] });
      }) as unknown as FetchLike,
    });
    const load = () => client.request<{ items: unknown[] }>('/api/notifications/');

    const { result } = await renderHook(() => useResource(load), { wrapper: providerWrapper() });
    await waitFor(() => expect(result.current.resource.status).toBe('error'));

    online = true;
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.resource).toEqual({ status: 'ready', data: { items: [] } });
  });

  it('shows the loading state while the retry is in flight rather than the stale error', async () => {
    let release: (() => void) | null = null;
    let online = false;
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      fetchImpl: (async () => {
        if (!online) throw new TypeError('Network request failed');
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return jsonResponse({ items: [] });
      }) as unknown as FetchLike,
    });
    const load = () => client.request<unknown>('/api/notifications/');

    const { result } = await renderHook(() => useResource(load), { wrapper: providerWrapper() });
    await waitFor(() => expect(result.current.resource.status).toBe('error'));

    online = true;
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.retry();
    });

    expect(result.current.resource).toEqual({ status: 'loading' });
    await act(async () => {
      release?.();
      await pending;
    });
    expect(result.current.resource.status).toBe('ready');
  });

  it('keeps failing honestly when connectivity has not actually returned', async () => {
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      fetchImpl: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as FetchLike,
    });
    const load = () => client.request<unknown>('/api/attendance/me/');

    const { result } = await renderHook(() => useResource(load), { wrapper: providerWrapper() });
    await waitFor(() => expect(result.current.resource.status).toBe('error'));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.resource).toEqual({ status: 'error', kind: 'offline' });
  });

  it('does not let a stalled offline request overwrite a successful retry', async () => {
    let rejectStalled: ((reason: unknown) => void) | null = null;
    let call = 0;
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      fetchImpl: (async () => {
        call += 1;
        if (call === 1) {
          // The connection the device opened while offline: it settles late.
          return new Promise((_resolve, reject) => {
            rejectStalled = reject;
          });
        }
        return jsonResponse({ items: ['fresh'] });
      }) as unknown as FetchLike,
    });
    const load = () => client.request<{ items: string[] }>('/api/attendance/me/');

    const { result } = await renderHook(() => useResource(load), { wrapper: providerWrapper() });

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.resource).toEqual({ status: 'ready', data: { items: ['fresh'] } });

    await act(async () => {
      rejectStalled?.(new TypeError('Network request failed'));
      await Promise.resolve();
    });

    expect(result.current.resource).toEqual({ status: 'ready', data: { items: ['fresh'] } });
  });
});

describe('request deadline', () => {
  it('fails a stalled connection as offline instead of hanging forever', async () => {
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      requestTimeoutMs: 20,
      fetchImpl: ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as FetchLike,
    });

    await expect(client.request('/api/attendance/me/')).rejects.toMatchObject({
      code: 'network_unavailable',
    });
  });

  it('passes an abort signal on every request so no request can outlive its deadline', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ items: [] }));
    const client = new ApiClient({
      baseUrl: 'https://api-mobile-dev.example.com',
      credentialStore,
      fetchImpl: fetchImpl as unknown as FetchLike,
    });

    await client.request('/api/attendance/me/');

    const calls = fetchImpl.mock.calls as unknown as [unknown, { signal?: AbortSignal }][];
    const init = calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });
});

describe('every shared error state offers recovery', () => {
  /**
   * A failure with no retry action is indistinguishable from a broken retry to the
   * employee, so no screen may render `ResourceFailure` without one.
   */
  it('passes onRetry at every ResourceFailure call site', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(sourceRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const usage of source.match(/<ResourceFailure[\s\S]*?\/>/gu) ?? []) {
        if (!usage.includes('onRetry')) offenders.push(`${file}: ${usage.replace(/\s+/gu, ' ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it.each(['offline', 'forbidden', 'not-found', 'unavailable'] as const)(
    'renders a working retry action for the %s state',
    async (kind) => {
      const onRetry = jest.fn();
      const view = await renderWithProviders(<ResourceFailure kind={kind} onRetry={onRetry} />);

      const retry = view.getByRole('button', { name: 'Try again' });
      expect(retry.props.accessibilityHint).toBe('Attempts to load the information again');
      fireEvent.press(retry);

      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it('exposes a busy, disabled retry action while a shared retry is running', async () => {
    const view = await renderWithProviders(
      <ResourceFailure kind="offline" onRetry={jest.fn()} retrying />,
    );

    const retry = view.getByRole('button', { name: 'Trying again' });
    expect(retry.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });
});

describe('transient failure never destroys a stored session', () => {
  it('parks on a retryable offline state instead of signing the employee out', async () => {
    const restoreSession = jest
      .fn<() => Promise<null>>()
      .mockRejectedValue(new ApiError('network_unavailable'));

    const view = await renderWithProviders(<RootRouteProbe />, {
      authService: stubAuthService({ restoreSession }),
    });

    await waitFor(() =>
      expect(view.getByTestId('status')).toHaveTextContent('bootstrap-unreachable'),
    );
    expect(restoreSession).toHaveBeenCalledTimes(1);
  });

  it('recovers the session when the retry succeeds', async () => {
    const view = await renderWithProviders(<RootRouteProbe />, {
      authService: stubAuthService({
        restoreSession: jest
          .fn<() => Promise<null>>()
          .mockRejectedValueOnce(new ApiError('network_unavailable'))
          .mockResolvedValue(null),
      }),
    });

    expect(await view.findByTestId('status')).toHaveTextContent('bootstrap-unreachable');

    await fireEvent.press(view.getByTestId('probe-retry'));

    await waitFor(() => expect(view.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('still signs the employee out when the server actually revokes the session', async () => {
    const view = await renderWithProviders(<RootRouteProbe />, {
      authService: stubAuthService({
        restoreSession: jest
          .fn<() => Promise<null>>()
          .mockRejectedValue(new ApiError('session_expired', 401)),
      }),
    });

    await waitFor(() => expect(view.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });
});

function RootRouteProbe() {
  const { retryBootstrap, status } = useAuth();
  return (
    <>
      <Text testID="status">{status}</Text>
      <Pressable onPress={() => void retryBootstrap()} testID="probe-retry">
        <Text>retry</Text>
      </Pressable>
    </>
  );
}
