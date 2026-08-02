import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import { getUserPreference, saveUserPreference } from "./preferencesApi";

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationDeliveryChannel = "whatsapp" | "email";
export type NotificationDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped";

/**
 * Read-only per-channel delivery record nested on a notification.
 * WhatsApp is attempted first; email is the fallback. The backend already
 * privacy-filters `error` down to a single redacted line (or `null`).
 *
 * Only `channel` and `status` are guaranteed. Historical rows can omit delivery
 * details entirely (`deliveries: []`), so every other field is optional.
 */
export interface NotificationDelivery {
  channel: NotificationDeliveryChannel;
  status: NotificationDeliveryStatus;
  provider?: string;
  provider_message_id?: string | null;
  error?: string | null;
  attempt_count?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * A single in-app notification as returned by the backend.
 * Mirrors `in_app_notifications.Notification` serialization documented in
 * `plans/Real-Time In-App Notification System Implementation Plan.md`.
 */
export interface NotificationDto {
  id: number;
  title: string;
  message: string;
  event_key: string;
  category: string;
  action_url: string | null;
  related_object_type: string | null;
  related_object_id: string | null;
  metadata: Record<string, unknown>;
  deduplication_key: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  /** WhatsApp-first, email-fallback delivery records. `[]` for historical rows. */
  deliveries?: NotificationDelivery[];
}

export interface NotificationListParams {
  page?: number;
  page_size?: number;
  /** `true` -> unread only, `false` -> read only, omit -> all */
  unread?: boolean;
  category?: string;
}

export interface NotificationListData {
  items: NotificationDto[];
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export interface UnreadCountData {
  unread_count: number;
}

/**
 * `POST /{id}/read/` returns the serialized notification plus the remaining
 * unread count. Backends vary between nesting the notification under
 * `notification` and spreading it at the top level, so both are accepted.
 */
export type MarkReadData = {
  notification?: NotificationDto;
  unread_count: number;
} & Partial<NotificationDto>;

export interface MarkAllReadData {
  updated_count: number;
  unread_count: number;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

/** `GET /api/notifications/` — paginated, newest-first list. */
export async function listNotifications(
  params: NotificationListParams = {},
): Promise<ApiResponse<NotificationListData>> {
  const query: Record<string, unknown> = {};
  if (params.page != null) query.page = params.page;
  if (params.page_size != null) query.page_size = params.page_size;
  if (params.unread != null) query.unread = params.unread;
  if (params.category) query.category = params.category;

  const { data } = await api.get<ApiResponse<NotificationListData>>(
    "/api/notifications/",
    { params: query },
  );
  return data;
}

/** `GET /api/notifications/unread-count/` — active recipient/company scope. */
export async function getUnreadNotificationCount(): Promise<
  ApiResponse<UnreadCountData>
> {
  const { data } = await api.get<ApiResponse<UnreadCountData>>(
    "/api/notifications/unread-count/",
  );
  return data;
}

/** `POST /api/notifications/{id}/read/` — idempotent single mark-as-read. */
export async function markNotificationRead(
  id: number | string,
): Promise<ApiResponse<MarkReadData>> {
  const { data } = await api.post<ApiResponse<MarkReadData>>(
    `/api/notifications/${id}/read/`,
    {},
  );
  return data;
}

/** `POST /api/notifications/read-all/` — mark every unread item in scope read. */
export async function markAllNotificationsRead(): Promise<
  ApiResponse<MarkAllReadData>
> {
  const { data } = await api.post<ApiResponse<MarkAllReadData>>(
    "/api/notifications/read-all/",
    {},
  );
  return data;
}

// ─── Delivery channel preferences ─────────────────────────────────────────────
//
// The backend delivers WhatsApp-first, then falls back to email. Per-user channel
// preferences are stored via the generic user-preference endpoint
// (`GET/PUT /api/core/preferences/{scope}/{key}/`) under scope `notifications`,
// key `channels`, with value `{ whatsapp_enabled, email_enabled }`.
// `Backend/in_app_notifications/dispatcher.py` reads exactly this preference and
// combines it with the global `NOTIFICATION_*` settings (the frontend preference
// can never override a globally-disabled channel or a missing WhatsApp number).
//
// NOTE: per-notification delivery *status* (whatsapp/email sent/failed/skipped) is
// tracked server-side in `NotificationDelivery` and exposed through the
// privacy-filtered nested `deliveries` array on notification REST responses.

export const NOTIFICATION_PREF_SCOPE = "notifications";
export const NOTIFICATION_PREF_KEY = "channels";

export interface NotificationChannelPreferences {
  whatsapp_enabled: boolean;
  email_enabled: boolean;
}

/**
 * Normalize a stored preference value into concrete booleans. The backend treats
 * any value that is *not* `false` as enabled, so an empty/absent preference means
 * both channels are enabled by default.
 */
function normalizeChannelPreferences(
  value: Record<string, unknown> | undefined | null,
): NotificationChannelPreferences {
  const v = value ?? {};
  return {
    whatsapp_enabled: v.whatsapp_enabled !== false,
    email_enabled: v.email_enabled !== false,
  };
}

/** Read the current user's notification channel preferences. */
export async function getNotificationChannelPreferences(): Promise<
  ApiResponse<NotificationChannelPreferences>
> {
  const res = await getUserPreference(
    NOTIFICATION_PREF_SCOPE,
    NOTIFICATION_PREF_KEY,
  );
  if (res.status !== "success") return res;
  return {
    status: "success",
    data: normalizeChannelPreferences(res.data?.value),
  };
}

/** Persist the current user's notification channel preferences. */
export async function saveNotificationChannelPreferences(
  prefs: NotificationChannelPreferences,
): Promise<ApiResponse<NotificationChannelPreferences>> {
  const res = await saveUserPreference(
    NOTIFICATION_PREF_SCOPE,
    NOTIFICATION_PREF_KEY,
    {
      whatsapp_enabled: prefs.whatsapp_enabled,
      email_enabled: prefs.email_enabled,
    },
  );
  if (res.status !== "success") return res;
  return {
    status: "success",
    data: normalizeChannelPreferences(res.data?.value),
  };
}
