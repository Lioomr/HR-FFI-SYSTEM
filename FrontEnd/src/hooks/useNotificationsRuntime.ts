import { useEffect, useRef } from "react";
import { useAuthStore } from "../auth/authStore";
import { useI18nStore } from "../i18n/i18nStore";
import { useNotificationStore } from "../stores/notificationStore";
import { NotificationPollingManager } from "../services/notifications/notificationSocket";

/**
 * Mounts the REST-polling notification runtime for the authenticated shell.
 *
 * Call this exactly once (from `BaseLayout`). It:
 * - resets/rescopes the store on login, logout, user change, or company switch,
 * - performs the initial fetch (recent list + unread count),
 * - owns a single polling lifecycle while realtime delivery is deferred,
 * - refetches when the UI language changes (the API renders text per language),
 * - tears everything down when the user logs out or the scope changes.
 */
export function useNotificationsRuntime(): void {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const language = useI18nStore((s) => s.language);

  const userId = user?.id ?? null;
  const companyId = user?.active_organization_id ?? null;

  const managerRef = useRef<NotificationPollingManager | null>(null);
  const languageRef = useRef(language);

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

  useEffect(() => {
    if (languageRef.current === language) return;
    languageRef.current = language;
    if (!isAuthenticated || !userId) return;
    void useNotificationStore.getState().fetchRecent();
  }, [language, isAuthenticated, userId]);
}
