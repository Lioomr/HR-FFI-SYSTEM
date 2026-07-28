import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { apiClient } from '@/services/api';
import { ApiError } from '@/services/api/api-error';

const DEFAULT_POLL_INTERVAL_MS = 20_000;
const UNREAD_COUNT_PATH = '/api/notifications/unread-count/';

type PollingStatus = 'idle' | 'polling' | 'ready' | 'offline' | 'error';

interface UnreadCountPayload {
  unread_count: number;
}

export interface NotificationPollClient {
  request<T>(path: `/${string}`): Promise<T>;
}

export interface AppStateSource {
  currentState: AppStateStatus;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void,
  ): NativeEventSubscription;
}

interface NotificationPollingContextValue {
  unreadCount: number;
  status: PollingStatus;
  refresh(): Promise<void>;
}

interface NotificationPollingProviderProps extends PropsWithChildren {
  client?: NotificationPollClient;
  intervalMs?: number;
  appState?: AppStateSource;
}

const NotificationPollingContext = createContext<NotificationPollingContextValue | null>(null);

function validUnreadCount(payload: UnreadCountPayload): boolean {
  return Number.isInteger(payload?.unread_count) && payload.unread_count >= 0;
}

export function NotificationPollingProvider({
  appState = AppState,
  children,
  client = apiClient,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
}: NotificationPollingProviderProps) {
  const { handleApiError, status: authStatus } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<PollingStatus>('idle');
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      refreshRef.current = async () => undefined;
      return;
    }

    let alive = true;
    let generation = 0;
    let inFlightGeneration: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      const requestGeneration = generation;
      if (!alive || inFlightGeneration === requestGeneration) return;
      inFlightGeneration = requestGeneration;
      setStatus((current) => (current === 'ready' ? current : 'polling'));
      try {
        const payload = await client.request<UnreadCountPayload>(UNREAD_COUNT_PATH);
        if (!validUnreadCount(payload)) throw new ApiError('invalid_response');
        if (!alive || requestGeneration !== generation) return;
        setUnreadCount(payload.unread_count);
        setStatus('ready');
      } catch (error) {
        if (!alive || requestGeneration !== generation) return;
        if (handleApiError(error)) return;
        setStatus(
          error instanceof ApiError && error.code === 'network_unavailable' ? 'offline' : 'error',
        );
      } finally {
        if (inFlightGeneration === requestGeneration) inFlightGeneration = null;
      }
    };

    const stop = () => {
      generation += 1;
      if (timer) clearInterval(timer);
      timer = null;
    };

    const start = () => {
      stop();
      void poll();
      timer = setInterval(() => void poll(), intervalMs);
    };

    refreshRef.current = poll;
    if (appState.currentState === 'active') start();
    const subscription = appState.addEventListener('change', (nextState) => {
      if (nextState === 'active') start();
      else stop();
    });

    return () => {
      alive = false;
      refreshRef.current = async () => undefined;
      stop();
      subscription.remove();
    };
  }, [appState, authStatus, client, handleApiError, intervalMs]);

  const refresh = useCallback(() => refreshRef.current(), []);
  const value = useMemo(() => ({ refresh, status, unreadCount }), [refresh, status, unreadCount]);

  return (
    <NotificationPollingContext.Provider value={value}>
      {children}
    </NotificationPollingContext.Provider>
  );
}

export function useNotificationPolling(): NotificationPollingContextValue {
  const context = useContext(NotificationPollingContext);
  if (!context) {
    throw new Error('useNotificationPolling must be used within NotificationPollingProvider');
  }
  return context;
}
