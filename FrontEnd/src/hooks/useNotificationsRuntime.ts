import { useEffect, useRef } from "react";
import { useAuthStore } from "../auth/authStore";
import { getToken } from "../services/api/tokenStorage";
import { useNotificationStore } from "../stores/notificationStore";
import {
  NotificationSocketManager,
  buildNotificationSocketUrl,
} from "../services/notifications/notificationSocket";

/**
 * Mounts the real-time notification runtime for the authenticated shell.
 *
 * Call this exactly once (from `BaseLayout`). It:
 * - resets/rescopes the store on login, logout, user change, or company switch,
 * - performs the initial fetch (recent list + unread count),
 * - owns a single WebSocket connection with reconnect + polling fallback,
 * - tears everything down when the user logs out or the scope changes.
 */
export function useNotificationsRuntime(): void {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const userId = user?.id ?? null;
  const companyId = user?.active_organization_id ?? null;

  const managerRef = useRef<NotificationSocketManager | null>(null);

  useEffect(() => {
    const store = useNotificationStore.getState();

    if (!isAuthenticated || !userId) {
      managerRef.current?.stop();
      managerRef.current = null;
      store.reset();
      return;
    }

    // Reset first so a scope change never surfaces the previous scope's data.
    store.ensureScope(userId, companyId);

    // Initial hydration.
    void store.fetchRecent();
    void store.fetchUnreadCount();

    const manager = new NotificationSocketManager({
      getUrl: () => buildNotificationSocketUrl(getToken()),
      onCreated: (notification, unreadCount) =>
        useNotificationStore.getState().applyIncoming(notification, unreadCount),
      onStatus: (status) => useNotificationStore.getState().setConnection(status),
      onPoll: () => {
        const s = useNotificationStore.getState();
        void s.fetchUnreadCount();
        void s.fetchRecent();
      },
    });
    managerRef.current = manager;
    manager.start();

    return () => {
      manager.stop();
      managerRef.current = null;
    };
    // Re-run only when identity or active company changes — NOT on every render,
    // which prevents duplicate sockets. Store actions are accessed via getState().
  }, [isAuthenticated, userId, companyId]);
}
