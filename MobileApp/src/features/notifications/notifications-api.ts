import {
  ApiError,
  apiClient,
  booleanOrNull,
  identifierOrNull,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import type {
  AnnouncementDetail,
  AnnouncementItem,
  NotificationItem,
  NotificationPage,
} from './types';

/** Verified Gate 1 notification and announcement routes. REST polling only. */
export const NOTIFICATIONS_PATH = '/api/notifications/' as const;
export const NOTIFICATIONS_UNREAD_COUNT_PATH = '/api/notifications/unread-count/' as const;
export const NOTIFICATIONS_READ_ALL_PATH = '/api/notifications/read-all/' as const;
export const ANNOUNCEMENTS_PATH = '/api/announcements/' as const;

export const NOTIFICATION_PAGE_SIZE = 25;
export const ANNOUNCEMENT_PAGE_SIZE = 20;

export function parseNotification(value: unknown): NotificationItem {
  const item = record(value);
  const readAt = stringOrNull(item.read_at);
  return {
    id: identifierOrNull(item.id),
    title: stringOrNull(item.title),
    message: stringOrNull(item.message),
    category: stringOrNull(item.category),
    isRead: booleanOrNull(item.is_read) ?? readAt !== null,
    readAt,
    createdAt: stringOrNull(item.created_at),
  };
}

export function parseNotificationPage(value: unknown): NotificationPage {
  const page = parsePaginated(value, parseNotification);
  return {
    items: page.items,
    count: page.count,
    unreadCount: page.items.filter((item) => !item.isRead).length,
  };
}

export function parseAnnouncement(value: unknown): AnnouncementItem {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    title: stringOrNull(item.title),
    contentPreview: stringOrNull(item.content_preview),
    createdAt: stringOrNull(item.created_at),
    createdByName: stringOrNull(item.created_by_name),
    hasAttachment: booleanOrNull(item.has_attachment) ?? false,
  };
}

/** The detail route wraps its payload as `data.announcement`. */
export function parseAnnouncementDetail(value: unknown): AnnouncementDetail {
  const envelope = record(value);
  const item = record(envelope.announcement);
  return {
    ...parseAnnouncement(item),
    contentPreview: stringOrNull(item.content_preview),
    content: stringOrNull(item.content),
    announcementType: stringOrNull(item.announcement_type),
    attachmentName: stringOrNull(item.attachment_name),
  };
}

export async function loadNotifications(
  client: ApiClient = apiClient,
  pageSize = NOTIFICATION_PAGE_SIZE,
): Promise<NotificationPage> {
  const path = `${NOTIFICATIONS_PATH}?page=1&page_size=${pageSize}` as `/${string}`;
  return parseNotificationPage(await client.request<unknown>(path));
}

export async function loadAnnouncements(
  client: ApiClient = apiClient,
  pageSize = ANNOUNCEMENT_PAGE_SIZE,
): Promise<AnnouncementItem[]> {
  const path = `${ANNOUNCEMENTS_PATH}?page=1&page_size=${pageSize}` as `/${string}`;
  return parsePaginated(await client.request<unknown>(path), parseAnnouncement).items;
}

export async function loadAnnouncementDetail(
  announcementId: number | string,
  client: ApiClient = apiClient,
): Promise<AnnouncementDetail> {
  const path =
    `${ANNOUNCEMENTS_PATH}${encodeURIComponent(String(announcementId))}/` as `/${string}`;
  return parseAnnouncementDetail(await client.request<unknown>(path));
}

export type MutationResult = 'success' | 'failed';

async function post(path: `/${string}`, client: ApiClient): Promise<MutationResult> {
  try {
    await client.request<unknown>(path, { method: 'POST' });
    return 'success';
  } catch (error) {
    if (error instanceof ApiError && error.code === 'session_expired') throw error;
    return 'failed';
  }
}

export function markNotificationRead(
  notificationId: number | string,
  client: ApiClient = apiClient,
): Promise<MutationResult> {
  const path =
    `${NOTIFICATIONS_PATH}${encodeURIComponent(String(notificationId))}/read/` as `/${string}`;
  return post(path, client);
}

export function markAllNotificationsRead(client: ApiClient = apiClient): Promise<MutationResult> {
  return post(NOTIFICATIONS_READ_ALL_PATH, client);
}
