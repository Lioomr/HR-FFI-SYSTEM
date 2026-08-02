import { describe, expect, it } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  ANNOUNCEMENTS_PATH,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_READ_ALL_PATH,
  NOTIFICATIONS_UNREAD_COUNT_PATH,
  loadAnnouncementDetail,
  loadAnnouncements,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  parseAnnouncementDetail,
  parseNotification,
} from './notifications-api';

interface Call {
  path: string;
  method?: string;
}

function fakeClient(handler: (call: Call) => unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async request(path: string, options?: { method?: string }) {
      const call = { path, method: options?.method };
      calls.push(call);
      const result = handler(call);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

const notificationsPayload = {
  items: [
    {
      id: 4,
      title: 'Leave approved',
      message: 'Your leave request was approved.',
      category: 'leave',
      is_read: false,
      read_at: null,
      created_at: '2026-07-27T10:00:00Z',
      deliveries: [{ channel: 'whatsapp', status: 'pending' }],
    },
    {
      id: 3,
      title: 'Payslip ready',
      message: 'A new payslip is available.',
      category: 'payroll',
      is_read: true,
      read_at: '2026-07-26T08:00:00Z',
      created_at: '2026-07-26T07:00:00Z',
    },
  ],
  page: 1,
  page_size: 25,
  count: 2,
  total_pages: 1,
};

describe('notification contract', () => {
  it('uses only the verified REST notification and announcement paths', () => {
    expect(NOTIFICATIONS_PATH).toBe('/api/notifications/');
    expect(NOTIFICATIONS_UNREAD_COUNT_PATH).toBe('/api/notifications/unread-count/');
    expect(NOTIFICATIONS_READ_ALL_PATH).toBe('/api/notifications/read-all/');
    expect(ANNOUNCEMENTS_PATH).toBe('/api/announcements/');
  });

  it('reads the paginated recipient-scoped list', async () => {
    const { calls, client } = fakeClient(() => notificationsPayload);

    const page = await loadNotifications(client, 25);

    expect(calls[0].path).toBe('/api/notifications/?page=1&page_size=25');
    expect(page.count).toBe(2);
    expect(page.unreadCount).toBe(1);
    expect(page.items[0].isRead).toBe(false);
    expect(page.items[1].isRead).toBe(true);
  });

  it('derives read state from read_at when is_read is absent', () => {
    expect(parseNotification({ id: 1, read_at: '2026-07-26T08:00:00Z' }).isRead).toBe(true);
    expect(parseNotification({ id: 1, read_at: null }).isRead).toBe(false);
  });

  it('never projects delivery provider internals into the mobile model', () => {
    const notification = parseNotification(notificationsPayload.items[0]);

    expect(Object.keys(notification).sort()).toEqual([
      'category',
      'createdAt',
      'id',
      'isRead',
      'message',
      'readAt',
      'title',
    ]);
  });

  it('reads the announcement list and the wrapped detail envelope', async () => {
    const { calls, client } = fakeClient((call) =>
      call.path.startsWith('/api/announcements/?')
        ? {
            items: [
              {
                id: 8,
                title: 'Office closure',
                content_preview: 'The office will close…',
                created_at: '2026-07-25T09:00:00Z',
                created_by_name: 'HR Team',
                has_attachment: true,
              },
            ],
            page: 1,
            page_size: 20,
            count: 1,
            total_pages: 1,
          }
        : {
            announcement: {
              id: 8,
              title: 'Office closure',
              content: 'Full text',
              has_attachment: true,
            },
          },
    );

    const list = await loadAnnouncements(client, 20);
    const detail = await loadAnnouncementDetail(8, client);

    expect(calls.map((call) => call.path)).toEqual([
      '/api/announcements/?page=1&page_size=20',
      '/api/announcements/8/',
    ]);
    expect(list[0]).toEqual({
      id: 8,
      title: 'Office closure',
      contentPreview: 'The office will close…',
      createdAt: '2026-07-25T09:00:00Z',
      createdByName: 'HR Team',
      hasAttachment: true,
    });
    expect(detail.content).toBe('Full text');
  });

  it('rejects an announcement detail that is not wrapped as documented', () => {
    expect(parseAnnouncementDetail({ id: 8, title: 'Loose' }).id).toBeNull();
  });

  it('posts read and read-all to the verified recipient-scoped actions', async () => {
    const { calls, client } = fakeClient(() => ({ unread_count: 0 }));

    expect(await markNotificationRead(4, client)).toBe('success');
    expect(await markAllNotificationsRead(client)).toBe('success');
    expect(calls).toEqual([
      { path: '/api/notifications/4/read/', method: 'POST' },
      { path: '/api/notifications/read-all/', method: 'POST' },
    ]);
  });

  it('encodes an unexpected notification identifier', async () => {
    const { calls, client } = fakeClient(() => ({}));

    await markNotificationRead('4/../read-all', client);

    expect(calls[0].path).toBe('/api/notifications/4%2F..%2Fread-all/read/');
  });

  it('reports a failed mark-read without surfacing server detail', async () => {
    const { client } = fakeClient(() => new ApiError('not_found', 404));

    expect(await markNotificationRead(999, client)).toBe('failed');
  });

  it('rethrows session expiry from a mutation', async () => {
    const { client } = fakeClient(() => new ApiError('session_expired', 401));

    await expect(markAllNotificationsRead(client)).rejects.toBeInstanceOf(ApiError);
  });
});
