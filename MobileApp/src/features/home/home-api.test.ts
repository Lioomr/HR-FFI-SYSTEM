import { describe, expect, it, jest } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  loadHomeDashboard,
  parseAnnouncements,
  parseAttendance,
  parseLeaveBalances,
} from './home-api';

function fakeClient(request: unknown): ApiClient {
  return { request } as unknown as ApiClient;
}

describe('home dashboard API contract', () => {
  it('uses only the four verified routes and delegates authentication/company headers to ApiClient', async () => {
    const request = jest.fn(async (path: string) => {
      if (path.includes('attendance') || path.includes('announcements')) return { items: [] };
      if (path.includes('leave-balance')) return [];
      return { unread_count: 0 };
    });

    await loadHomeDashboard(2026, fakeClient(request));

    expect(request.mock.calls).toEqual([
      ['/api/attendance/me/?page=1&page_size=7'],
      ['/api/leaves/employee/leave-balance/?year=2026'],
      ['/api/announcements/?page=1&page_size=3'],
      ['/api/notifications/unread-count/'],
    ]);
  });

  it('parses the verified enveloped-data shapes without depending on undocumented fields', () => {
    expect(
      parseAttendance({
        items: [
          {
            id: 4,
            date: '2026-07-21',
            check_in_at: '2026-07-21T08:00:00Z',
            check_out_at: null,
            status: 'PENDING_MANAGER',
            undocumented: 'ignored',
          },
        ],
      }),
    ).toEqual([
      {
        id: 4,
        date: '2026-07-21',
        checkInAt: '2026-07-21T08:00:00Z',
        checkOutAt: null,
        status: 'PENDING_MANAGER',
      },
    ]);
    expect(
      parseLeaveBalances([{ leave_type_id: 2, leave_type: 'Annual', remaining_days: '7.50' }]),
    ).toEqual([{ leaveTypeId: 2, leaveType: 'Annual', remainingDays: 7.5 }]);
    expect(
      parseAnnouncements({
        items: [
          {
            id: 8,
            title: 'Office update',
            content_preview: 'A short update',
            created_at: '2026-07-20T09:00:00Z',
          },
        ],
      }),
    ).toEqual([
      {
        id: 8,
        title: 'Office update',
        contentPreview: 'A short update',
        createdAt: '2026-07-20T09:00:00Z',
      },
    ]);
  });

  it('settles sections independently so one failed endpoint does not hide successful data', async () => {
    const request = jest.fn(async (path: string) => {
      if (path.includes('attendance')) throw new ApiError('network_unavailable');
      if (path.includes('leave-balance')) {
        return [{ leave_type_id: 1, leave_type: 'Annual', remaining_days: '4.00' }];
      }
      if (path.includes('announcements')) return { items: [] };
      return { unread_count: 3 };
    });

    const snapshot = await loadHomeDashboard(2026, fakeClient(request));

    expect(snapshot.attendance).toEqual({ status: 'error', kind: 'offline' });
    expect(snapshot.leaveBalances).toEqual({
      status: 'ready',
      data: [{ leaveTypeId: 1, leaveType: 'Annual', remainingDays: 4 }],
    });
    expect(snapshot.announcements).toEqual({ status: 'ready', data: [] });
    expect(snapshot.unreadNotifications).toEqual({ status: 'ready', data: 3 });
  });

  it('normalizes absent or malformed optional fields to safe unavailable values', () => {
    expect(parseAttendance({ items: [{}] })).toEqual([
      { id: null, date: null, checkInAt: null, checkOutAt: null, status: null },
    ]);
    expect(parseLeaveBalances([{}])).toEqual([
      { leaveTypeId: null, leaveType: null, remainingDays: null },
    ]);
    expect(parseAnnouncements({ items: [{}] })).toEqual([
      { id: null, title: null, contentPreview: null, createdAt: null },
    ]);
  });

  it('fails only the affected section when a required response container is invalid', async () => {
    const request = jest.fn(async (path: string) => {
      if (path.includes('attendance')) return { results: [] };
      if (path.includes('leave-balance')) return [];
      if (path.includes('announcements')) return { items: [] };
      return { unread_count: 0 };
    });

    const snapshot = await loadHomeDashboard(2026, fakeClient(request));

    expect(snapshot.attendance).toEqual({ status: 'error', kind: 'unavailable' });
    expect(snapshot.leaveBalances.status).toBe('ready');
  });
});
