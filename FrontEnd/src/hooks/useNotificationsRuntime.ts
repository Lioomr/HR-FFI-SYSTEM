import { useEffect, useRef } from "react";
import { useAuthStore } from "../auth/authStore";
import { useNotificationStore } from "../stores/notificationStore";
import { NotificationPollingManager } from "../services/notifications/notificationSocket";

/**
 * Mounts the REST-polling notification runtime for the authenticated shell.
 *
 * Call this exactly once (from `BaseLayout`). It:
 * - resets/rescopes the store on login, logout, user change, or company switch,
 * - performs the initial fetch (recent list + unread count),
 * - owns a single polling lifecycle while realtime delivery is deferred,
 * - tears everything down when the user logs out or the scope changes.
 */
export function useNotificationsRuntime(): void {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const userId = user?.id ?? null;
  const companyId = user?.active_organization_id ?? null;

  const managerRef = useRef<NotificationPollingManager | null>(null);

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

    const manager = new NotificationPollingManager({
      onStatus: (status) =>
        useNotificationStore.getState().setConnection(status),
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
    // which prevents duplicate polling lifecycles. Store actions are accessed via getState().
  }, [isAuthenticated, userId, companyId]);
}
