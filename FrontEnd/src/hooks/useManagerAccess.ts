import { useCallback, useEffect, useState } from "react";

import { useAuthStore } from "../auth/authStore";
import { isApiError } from "../services/api/apiTypes";
import {
  NO_MANAGER_ACCESS,
  getManagerAccess,
  type ManagerAccess,
} from "../services/api/managerApi";

/**
 * Manager capability shared by the route guard and the sidebar.
 *
 * Access is a backend capability (`GET /api/employees/manager/access/`), not a
 * role check: an Employee with assigned direct reports has it, a Manager-group
 * user without direct reports does not. The result is cached per user so the
 * guard and the layout resolve it with a single request.
 */

type CacheEntry = {
  userKey: string;
  access: ManagerAccess | null;
  failed: boolean;
  inflight: Promise<void> | null;
};

let cache: CacheEntry | null = null;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((listener) => listener());
}

/** Drops the cached capability. Exported for tests and for post-login resets. */
export function resetManagerAccessCache() {
  cache = null;
  notify();
}

function ensureEntry(userKey: string): CacheEntry {
  if (!cache || cache.userKey !== userKey) {
    cache = { userKey, access: null, failed: false, inflight: null };
  }
  return cache;
}

function fetchManagerAccess(userKey: string): Promise<void> {
  const entry = ensureEntry(userKey);
  if (entry.inflight) return entry.inflight;

  entry.inflight = (async () => {
    try {
      const res = await getManagerAccess();
      if (cache !== entry) return;
      entry.access = isApiError(res) ? NO_MANAGER_ACCESS : res.data;
      entry.failed = isApiError(res);
    } catch {
      if (cache !== entry) return;
      entry.access = NO_MANAGER_ACCESS;
      entry.failed = true;
    } finally {
      if (cache === entry) {
        entry.inflight = null;
        notify();
      }
    }
  })();

  return entry.inflight;
}

export type UseManagerAccessResult = {
  access: ManagerAccess;
  /** True while the capability is still being resolved. */
  loading: boolean;
  /** True when the capability request failed (access is denied defensively). */
  failed: boolean;
  refresh: () => void;
};

export function useManagerAccess(options?: {
  enabled?: boolean;
}): UseManagerAccessResult {
  const enabled = options?.enabled ?? true;
  const user = useAuthStore((s) => s.user);
  const userKey = user?.id ? String(user.id) : "";
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !userKey) return;
    const entry = ensureEntry(userKey);
    if (entry.access === null) {
      void fetchManagerAccess(userKey);
    }
  }, [enabled, userKey]);

  const refresh = useCallback(() => {
    if (!userKey) return;
    cache = null;
    void fetchManagerAccess(userKey);
  }, [userKey]);

  if (!enabled || !userKey) {
    return {
      access: NO_MANAGER_ACCESS,
      loading: false,
      failed: false,
      refresh,
    };
  }

  const entry = cache && cache.userKey === userKey ? cache : null;
  return {
    access: entry?.access ?? NO_MANAGER_ACCESS,
    loading: !entry || entry.access === null,
    failed: Boolean(entry?.failed),
    refresh,
  };
}
