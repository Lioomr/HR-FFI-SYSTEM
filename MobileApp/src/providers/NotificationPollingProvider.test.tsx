import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { AppStateStatus } from 'react-native';

import type { AuthUser } from '@/auth';
import { ApiError } from '@/services/api/api-error';

import { AuthProvider, type AuthService, useAuth } from './AuthProvider';
import {
  type AppStateSource,
  type NotificationPollClient,
  NotificationPollingProvider,
  useNotificationPolling,
} from './NotificationPollingProvider';

const user: AuthUser = {
  accessible_organizations: [{ id: 7, name: 'FFI Egypt' }],
  default_organization_id: 7,
  email: 'employee@example.com',
  has_all_company_access: false,
  id: 'user-1',
  role: 'Employee',
};

class FakePollClient implements NotificationPollClient {
  calls: string[] = [];

  constructor(private readonly response: () => Promise<unknown>) {}

  async request<T>(path: `/${string}`): Promise<T> {
    this.calls.push(path);
    return (await this.response()) as T;
  }
}

class FakeAppState implements AppStateSource {
  currentState: AppStateStatus = 'active';
  listener: ((state: AppStateStatus) => void) | null = null;
  removeCount = 0;

  addEventListener(_type: 'change', listener: (state: AppStateStatus) => void) {
    this.listener = listener;
    return {
      remove: () => {
        this.removeCount += 1;
        this.listener = null;
      },
    };
  }

  emit(state: AppStateStatus) {
    this.currentState = state;
    this.listener?.(state);
  }
}

function authService(): AuthService {
  return {
    changePassword: jest.fn(async () => undefined),
    login: jest.fn(async () => user),
    logout: jest.fn(async () => undefined),
    restoreSession: jest.fn(async () => user),
    selectActiveCompany: jest.fn(() => undefined),
  };
}

function wrapperFor(client: NotificationPollClient, appState: AppStateSource) {
  return function Wrapper({ children }: React.PropsWithChildren) {
    return (
      <AuthProvider client={authService()}>
        <NotificationPollingProvider appState={appState} client={client} intervalMs={20_000}>
          {children}
        </NotificationPollingProvider>
      </AuthProvider>
    );
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('NotificationPollingProvider', () => {
  it('polls immediately and every 20 seconds, then removes timers and listeners on unmount', async () => {
    jest.useFakeTimers();
    const client = new FakePollClient(async () => ({ unread_count: 3 }));
    const appState = new FakeAppState();
    const hook = await renderHook(() => useNotificationPolling(), {
      wrapper: wrapperFor(client, appState),
    });

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(client.calls).toEqual(['/api/notifications/unread-count/']);
    expect(hook.result.current.unreadCount).toBe(3);

    await act(async () => jest.advanceTimersByTimeAsync(20_000));
    expect(client.calls).toHaveLength(2);

    await hook.unmount();
    await jest.advanceTimersByTimeAsync(40_000);
    expect(client.calls).toHaveLength(2);
    expect(appState.removeCount).toBe(1);
  });

  it('stops in the background and resumes with an immediate foreground poll', async () => {
    jest.useFakeTimers();
    const client = new FakePollClient(async () => ({ unread_count: 1 }));
    const appState = new FakeAppState();
    const hook = await renderHook(() => useNotificationPolling(), {
      wrapper: wrapperFor(client, appState),
    });
    await waitFor(() => expect(client.calls).toHaveLength(1));

    await act(async () => appState.emit('background'));
    await jest.advanceTimersByTimeAsync(40_000);
    expect(client.calls).toHaveLength(1);

    await act(async () => appState.emit('active'));
    await waitFor(() => expect(client.calls).toHaveLength(2));
    await hook.unmount();
  });

  it('uses the auth boundary for a redacted session-expiration response', async () => {
    jest.useFakeTimers();
    const client = new FakePollClient(async () => {
      throw new ApiError('session_expired', 401);
    });
    const appState = new FakeAppState();
    const hook = await renderHook(
      () => ({ auth: useAuth(), notifications: useNotificationPolling() }),
      { wrapper: wrapperFor(client, appState) },
    );

    await waitFor(() => expect(hook.result.current.auth.status).toBe('unauthenticated'));
    expect(hook.result.current.auth.sessionNotice).toBe('session-expired');
    const callsAfterExpiration = client.calls.length;
    await jest.advanceTimersByTimeAsync(40_000);
    expect(client.calls).toHaveLength(callsAfterExpiration);
    expect(hook.result.current.notifications.unreadCount).toBe(0);
    await hook.unmount();
  });
});
