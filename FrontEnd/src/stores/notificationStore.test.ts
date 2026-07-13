import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/api/notificationsApi", () => ({
  listNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

import * as api from "../services/api/notificationsApi";
import type { NotificationDto } from "../services/api/notificationsApi";
import { useNotificationStore } from "./notificationStore";

const listNotifications = api.listNotifications as unknown as ReturnType<
  typeof vi.fn
>;
const getUnreadNotificationCount =
  api.getUnreadNotificationCount as unknown as ReturnType<typeof vi.fn>;
const markNotificationRead = api.markNotificationRead as unknown as ReturnType<
  typeof vi.fn
>;
const markAllNotificationsRead =
  api.markAllNotificationsRead as unknown as ReturnType<typeof vi.fn>;

const ok = <T>(data: T) => ({ status: "success" as const, data });

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 1,
    title: "Leave approved",
    message: "Your leave was approved.",
    event_key: "leave.approved",
    category: "leave",
    action_url: "/employee/leave/requests",
    related_object_type: "leaves.leaverequest",
    related_object_id: "17",
    metadata: {},
    deduplication_key: "leave.approved:17",
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationStore.getState().reset();
});

describe("notificationStore", () => {
  it("fetches the recent list for the bell", async () => {
    const items = [makeNotification({ id: 1 }), makeNotification({ id: 2 })];
    listNotifications.mockResolvedValue(
      ok({ items, page: 1, page_size: 8, count: 2, total_pages: 1 })
    );

    await useNotificationStore.getState().fetchRecent();

    expect(useNotificationStore.getState().recent).toHaveLength(2);
    expect(useNotificationStore.getState().recentLoading).toBe(false);
  });

  it("fetches the unread count", async () => {
    getUnreadNotificationCount.mockResolvedValue(ok({ unread_count: 7 }));
    await useNotificationStore.getState().fetchUnreadCount();
    expect(useNotificationStore.getState().unreadCount).toBe(7);
  });

  it("requests unread-only when the filter is 'unread'", async () => {
    listNotifications.mockResolvedValue(
      ok({ items: [], page: 1, page_size: 20, count: 0, total_pages: 1 })
    );
    await useNotificationStore.getState().fetchList({ filter: "unread" });
    expect(listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ unread: true, page: 1 })
    );
  });

  it("appends paginated results de-duplicated by id", async () => {
    listNotifications.mockResolvedValueOnce(
      ok({
        items: [makeNotification({ id: 1 }), makeNotification({ id: 2 })],
        page: 1,
        page_size: 20,
        count: 3,
        total_pages: 2,
      })
    );
    await useNotificationStore.getState().fetchList({ page: 1 });

    listNotifications.mockResolvedValueOnce(
      ok({
        items: [makeNotification({ id: 2 }), makeNotification({ id: 3 })],
        page: 2,
        page_size: 20,
        count: 3,
        total_pages: 2,
      })
    );
    await useNotificationStore.getState().fetchList({ page: 2, append: true });

    const ids = useNotificationStore.getState().items.map((n) => n.id);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });

  it("marks one notification read and lowers the unread count", async () => {
    useNotificationStore.setState({
      recent: [makeNotification({ id: 1, is_read: false })],
      items: [makeNotification({ id: 1, is_read: false })],
      unreadCount: 2,
    });
    markNotificationRead.mockResolvedValue(ok({ unread_count: 1 }));

    await useNotificationStore.getState().markRead(1);

    const state = useNotificationStore.getState();
    expect(state.recent[0].is_read).toBe(true);
    expect(state.items[0].is_read).toBe(true);
    expect(state.unreadCount).toBe(1);
  });

  it("marks all read and zeroes the unread count", async () => {
    useNotificationStore.setState({
      recent: [
        makeNotification({ id: 1, is_read: false }),
        makeNotification({ id: 2, is_read: false }),
      ],
      unreadCount: 2,
    });
    markAllNotificationsRead.mockResolvedValue(
      ok({ updated_count: 2, unread_count: 0 })
    );

    await useNotificationStore.getState().markAllRead();

    const state = useNotificationStore.getState();
    expect(state.recent.every((n) => n.is_read)).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it("inserts an incoming socket notification and updates the count", () => {
    const n = makeNotification({ id: 10 });
    useNotificationStore.getState().applyIncoming(n, 3);

    const state = useNotificationStore.getState();
    expect(state.recent[0].id).toBe(10);
    expect(state.unreadCount).toBe(3);
  });

  it("de-duplicates repeated socket events by id", () => {
    const n = makeNotification({ id: 10 });
    useNotificationStore.getState().applyIncoming(n, 3);
    useNotificationStore.getState().applyIncoming(n, 3);

    expect(useNotificationStore.getState().recent).toHaveLength(1);
  });

  it("does not duplicate a notification after a WebSocket insert then REST refresh", async () => {
    const live = makeNotification({ id: 55, title: "Live push" });
    // 1. Arrives over the socket.
    useNotificationStore.getState().applyIncoming(live, 1);
    expect(useNotificationStore.getState().recent).toHaveLength(1);

    // 2. A REST refresh returns the same notification (now persisted server-side).
    listNotifications.mockResolvedValue(
      ok({ items: [live], page: 1, page_size: 8, count: 1, total_pages: 1 })
    );
    await useNotificationStore.getState().fetchRecent();

    const ids = useNotificationStore.getState().recent.map((n) => n.id);
    expect(ids).toEqual([55]);
    expect(ids).toHaveLength(1);
  });

  it("resets when the active company scope changes", () => {
    useNotificationStore.getState().ensureScope("user-1", "company-A");
    useNotificationStore.setState({
      recent: [makeNotification({ id: 1 })],
      unreadCount: 5,
    });

    useNotificationStore.getState().ensureScope("user-1", "company-B");

    const state = useNotificationStore.getState();
    expect(state.recent).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    expect(state.scopeKey).toBe("user-1:company-B");
  });

  it("does not reset when the scope is unchanged", () => {
    useNotificationStore.getState().ensureScope("user-1", "company-A");
    useNotificationStore.setState({ unreadCount: 4 });
    useNotificationStore.getState().ensureScope("user-1", "company-A");
    expect(useNotificationStore.getState().unreadCount).toBe(4);
  });

  it("clears everything on reset (logout)", () => {
    useNotificationStore.setState({
      recent: [makeNotification({ id: 1 })],
      items: [makeNotification({ id: 1 })],
      unreadCount: 9,
      scopeKey: "user-1:company-A",
    });

    useNotificationStore.getState().reset();

    const state = useNotificationStore.getState();
    expect(state.recent).toHaveLength(0);
    expect(state.items).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    expect(state.scopeKey).toBeNull();
  });
});
