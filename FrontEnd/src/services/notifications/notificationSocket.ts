import type { ConnectionStatus } from "../../stores/notificationStore";
import type { NotificationDto } from "../api/notificationsApi";

/**
 * Minimal structural type for the browser `WebSocket`. Kept narrow so tests can
 * inject a fake implementation without pulling in the DOM lib surface.
 */
export interface WebSocketLike {
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  readyState: number;
}

export interface NotificationSocketOptions {
  /** Returns the fully-qualified WS URL (incl. auth token) or `null` when auth is unavailable. */
  getUrl: () => string | null;
  /** Invoked for each valid `notification.created` frame. */
  onCreated: (notification: NotificationDto, unreadCount?: number) => void;
  /** Reports transport status transitions to the store/UI. */
  onStatus: (status: ConnectionStatus) => void;
  /** Called on each polling tick while the socket is unavailable. */
  onPoll: () => void;
  /** Socket factory — overridable for tests. */
  createSocket?: (url: string) => WebSocketLike;
  pollIntervalMs?: number;
  baseReconnectMs?: number;
  maxReconnectMs?: number;
}

const DEFAULT_POLL_MS = 20000;
const DEFAULT_BASE_RECONNECT_MS = 1000;
const DEFAULT_MAX_RECONNECT_MS = 30000;

/**
 * Resolve the notifications WebSocket base URL.
 * Prefers `VITE_WS_BASE_URL`, otherwise derives it from `VITE_API_BASE_URL`
 * by swapping the HTTP scheme for the WS scheme.
 */
export function resolveWsBaseUrl(): string {
  const explicit = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  // In Docker, Nginx proxies /ws/ to the backend service. Same-origin keeps
  // the browser independent of container/service hostnames and ports.
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin.replace(/^http/, "ws");
  }

  const apiBase =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    "http://127.0.0.1:8000";
  try {
    const origin =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const url = new URL(apiBase, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString().replace(/\/+$/, "");
  } catch {
    if (typeof window !== "undefined") {
      return window.location.origin.replace(/^http/, "ws");
    }
    return "ws://127.0.0.1:8000";
  }
}

/** Build the authenticated `/ws/notifications/` URL for a given access token. */
export function buildNotificationSocketUrl(token: string | null): string | null {
  if (!token) return null;
  return `${resolveWsBaseUrl()}/ws/notifications/?access_token=${encodeURIComponent(
    token
  )}`;
}

/**
 * Single, self-healing WebSocket connection to `/ws/notifications/`.
 *
 * Responsibilities:
 * - Exactly one live socket at a time (no duplicate connections on re-render).
 * - Bounded exponential backoff reconnection.
 * - Polling fallback whenever the socket is down, stopped once it recovers.
 * - Safe handling of malformed frames, errors, and auth-failure closes.
 * - Full teardown on `stop()` (logout / scope change) with no stray reconnects.
 */
export class NotificationSocketManager {
  private readonly opts: Required<
    Omit<NotificationSocketOptions, "createSocket">
  > & { createSocket: (url: string) => WebSocketLike };

  private socket: WebSocketLike | null = null;
  private running = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NotificationSocketOptions) {
    this.opts = {
      pollIntervalMs: DEFAULT_POLL_MS,
      baseReconnectMs: DEFAULT_BASE_RECONNECT_MS,
      maxReconnectMs: DEFAULT_MAX_RECONNECT_MS,
      createSocket: (url: string) =>
        new WebSocket(url) as unknown as WebSocketLike,
      ...options,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempts = 0;
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearReconnect();
    this.stopPolling();
    this.teardownSocket();
    this.opts.onStatus("offline");
  }

  private connect(): void {
    if (!this.running) return;

    const url = this.opts.getUrl();
    if (!url) {
      // No auth token available yet — nothing to connect to. Keep the loop
      // alive via polling so we recover once credentials appear.
      this.opts.onStatus("reconnecting");
      this.startPolling();
      this.scheduleReconnect();
      return;
    }

    this.teardownSocket();
    this.opts.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");

    let socket: WebSocketLike;
    try {
      socket = this.opts.createSocket(url);
    } catch {
      // Construction itself can throw (e.g. bad URL) — fall back and retry.
      this.opts.onStatus("reconnecting");
      this.startPolling();
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (!this.running || this.socket !== socket) return;
      this.attempts = 0;
      this.clearReconnect();
      this.stopPolling();
      this.opts.onStatus("connected");
    };

    socket.onmessage = (ev) => {
      if (!this.running || this.socket !== socket) return;
      this.handleMessage(ev.data);
    };

    socket.onerror = () => {
      // Errors are always followed by `onclose`; let that path drive recovery.
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.running) return;
      // Covers unexpected drops and pre-accept auth rejections (403 handshake).
      this.opts.onStatus("reconnecting");
      this.startPolling();
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: unknown): void {
    let payload: unknown;
    try {
      payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return; // Malformed frame — ignore silently.
    }
    if (!payload || typeof payload !== "object") return;

    const data = payload as {
      type?: string;
      notification?: NotificationDto;
      unread_count?: number;
    };
    if (data.type !== "notification.created") return;
    if (!data.notification || typeof data.notification.id !== "number") return;

    this.opts.onCreated(data.notification, data.unread_count);
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    const exp = Math.min(
      this.opts.maxReconnectMs,
      this.opts.baseReconnectMs * 2 ** this.attempts
    );
    // Full jitter keeps a fleet of clients from reconnecting in lockstep.
    const delay = Math.round(Math.random() * exp) + this.opts.baseReconnectMs;
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    // Immediate refresh so the UI doesn't wait a full interval to catch up.
    try {
      this.opts.onPoll();
    } catch {
      /* poll callback errors are non-fatal */
    }
    this.pollTimer = setInterval(() => {
      try {
        this.opts.onPoll();
      } catch {
        /* poll callback errors are non-fatal */
      }
    }, this.opts.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private teardownSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    // Detach handlers first so the pending close doesn't trigger reconnection.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* already closing/closed */
    }
  }
}
