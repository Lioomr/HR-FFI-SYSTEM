import { create } from "zustand";
import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationDto,
} from "../services/api/notificationsApi";
import { unwrapEnvelope } from "../utils/dataUtils";

export type NotificationFilter = "all" | "unread";

/**
 * Live connection status for the notification transport.
 * - `connecting`   — first WebSocket attempt in flight
 * - `connected`    — WebSocket open, real-time delivery active
 * - `reconnecting` — WebSocket dropped, retrying with backoff (polling fallback active)
 * - `offline`      — transport stopped (logout / no auth); UI hidden in this state
 */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

/** Number of notifications shown in the header bell dropdown. */
export const RECENT_LIMIT = 8;
/** Default page size for the full inbox page. */
export const INBOX_PAGE_SIZE = 20;

interface NotificationState {
  // Header-bell cache (latest, unfiltered)
  recent: NotificationDto[];
  recentLoading: boolean;
  recentError: string | null;

  // Full inbox list (query-driven, paginated)
  items: NotificationDto[];
  listLoading: boolean;
  listError: string | null;
  page: number;
  pageSize: number;
  totalPages: number;
  count: number;
  filter: NotificationFilter;

  // Shared
  unreadCount: number;
  connection: ConnectionStatus;
  /** `${userId}:${companyId}` — guards against cross-scope data leaking. */
  scopeKey: string | null;

  ensureScope: (userId: string | null, companyId: string | number | null) => void;
  reset: () => void;

  fetchRecent: () => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  fetchList: (opts?: {
    page?: number;
    filter?: NotificationFilter;
    append?: boolean;
  }) => Promise<void>;
  setFilter: (filter: NotificationFilter) => void;

  markRead: (id: number | string) => Promise<void>;
  markAllRead: () => Promise<void>;

  /** Insert or update a notification arriving over the WebSocket (dedup by id). */
  applyIncoming: (notification: NotificationDto, unreadCount?: number) => void;
  setConnection: (connection: ConnectionStatus) => void;
}

const initialState = {
  recent: [] as NotificationDto[],
  recentLoading: false,
  recentError: null as string | null,

  items: [] as NotificationDto[],
  listLoading: false,
  listError: null as string | null,
  page: 1,
  pageSize: INBOX_PAGE_SIZE,
  totalPages: 1,
  count: 0,
  filter: "all" as NotificationFilter,

  unreadCount: 0,
  connection: "offline" as ConnectionStatus,
  scopeKey: null as string | null,
};

/** Merge a list into an accumulator, de-duplicating by notification id. */
function dedupeById(
  existing: NotificationDto[],
  incoming: NotificationDto[]
): NotificationDto[] {
  const byId = new Map<number, NotificationDto>();
  for (const n of existing) byId.set(n.id, n);
  for (const n of incoming) byId.set(n.id, n);
  return Array.from(byId.values());
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object") {
    const anyErr = err as { message?: string; response?: { data?: { message?: string } } };
    return anyErr.response?.data?.message || anyErr.message || fallback;
  }
  return fallback;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  ...initialState,

  ensureScope: (userId, companyId) => {
    const nextScope = userId ? `${userId}:${companyId ?? "none"}` : null;
    if (get().scopeKey === nextScope) return;
    // Scope changed (login, user switch, or active-company change): drop
    // everything so the previous scope's data can never bleed through.
    set({ ...initialState, scopeKey: nextScope, connection: get().connection });
  },

  reset: () => set({ ...initialState }),

  fetchRecent: async () => {
    set({ recentLoading: true, recentError: null });
    try {
      const res = await listNotifications({ page: 1, page_size: RECENT_LIMIT });
      const data = unwrapEnvelope(res);
      set({ recent: data.items ?? [], recentLoading: false });
    } catch (err) {
      set({
        recentLoading: false,
        recentError: errorMessage(err, "Failed to load notifications"),
      });
    }
  },

  fetchUnreadCount: async () => {
    try {
      const res = await getUnreadNotificationCount();
      const data = unwrapEnvelope(res);
      set({ unreadCount: data.unread_count ?? 0 });
    } catch {
      // Unread count is a soft signal — never surface a hard error for it.
    }
  },

  fetchList: async (opts = {}) => {
    const state = get();
    const filter = opts.filter ?? state.filter;
    const page = opts.page ?? 1;
    const append = opts.append ?? false;

    set({ listLoading: true, listError: null, filter });
    try {
      const res = await listNotifications({
        page,
        page_size: state.pageSize,
        unread: filter === "unread" ? true : undefined,
      });
      const data = unwrapEnvelope(res);
      set((prev) => ({
        items: append ? dedupeById(prev.items, data.items ?? []) : data.items ?? [],
        page: data.page ?? page,
        totalPages: data.total_pages ?? 1,
        count: data.count ?? (data.items ?? []).length,
        listLoading: false,
      }));
    } catch (err) {
      set({
        listLoading: false,
        listError: errorMessage(err, "Failed to load notifications"),
      });
    }
  },

  setFilter: (filter) => {
    set({ filter });
  },

  markRead: async (id) => {
    const numericId = typeof id === "string" ? Number(id) : id;
    // Optimistic: flip the flag locally so the UI responds instantly.
    const nowIso = new Date().toISOString();
    const flip = (n: NotificationDto): NotificationDto =>
      n.id === numericId && !n.is_read
        ? { ...n, is_read: true, read_at: n.read_at ?? nowIso }
        : n;
    const wasUnread = [...get().recent, ...get().items].some(
      (n) => n.id === numericId && !n.is_read
    );
    set((prev) => ({
      recent: prev.recent.map(flip),
      items: prev.items.map(flip),
      unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
    }));

    try {
      const res = await markNotificationRead(id);
      const data = unwrapEnvelope(res);
      if (typeof data?.unread_count === "number") {
        set({ unreadCount: data.unread_count });
      }
    } catch {
      // Reconcile against the server on the next poll/refresh; a failed
      // idempotent read is non-critical and should stay silent.
    }
  },

  markAllRead: async () => {
    const nowIso = new Date().toISOString();
    const flipAll = (n: NotificationDto): NotificationDto =>
      n.is_read ? n : { ...n, is_read: true, read_at: nowIso };
    set((prev) => ({
      recent: prev.recent.map(flipAll),
      items: prev.items.map(flipAll),
      unreadCount: 0,
    }));

    try {
      const res = await markAllNotificationsRead();
      const data = unwrapEnvelope(res);
      set({ unreadCount: data.unread_count ?? 0 });
    } catch {
      // Non-critical; the next poll reconciles the true unread count.
    }
  },

  applyIncoming: (notification, unreadCount) => {
    set((prev) => {
      const existsInRecent = prev.recent.some((n) => n.id === notification.id);
      const recent = existsInRecent
        ? prev.recent.map((n) => (n.id === notification.id ? notification : n))
        : [notification, ...prev.recent].slice(0, RECENT_LIMIT);

      // Only fold into the inbox list when it belongs to the active filter.
      const belongsToFilter =
        prev.filter === "all" || !notification.is_read;
      const existsInItems = prev.items.some((n) => n.id === notification.id);
      let items = prev.items;
      if (existsInItems) {
        items = prev.items.map((n) =>
          n.id === notification.id ? notification : n
        );
      } else if (belongsToFilter && prev.page === 1) {
        items = [notification, ...prev.items];
      }

      return {
        recent,
        items,
        unreadCount:
          typeof unreadCount === "number" ? unreadCount : prev.unreadCount,
      };
    });
  },

  setConnection: (connection) => set({ connection }),
}));
