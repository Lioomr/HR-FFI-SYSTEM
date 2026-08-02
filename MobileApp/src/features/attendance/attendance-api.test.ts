import { describe, expect, it } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';

import {
  ATTENDANCE_CHECK_IN_PATH,
  ATTENDANCE_CHECK_OUT_PATH,
  ATTENDANCE_TIMELINE_PATH,
  attendanceDayState,
  checkIn,
  checkOut,
  loadAttendanceTimeline,
  localIsoDate,
  parseAttendanceTimeline,
} from './attendance-api';

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

const timelinePayload = {
  items: [
    {
      id: 11,
      date: '2026-07-28',
      check_in_at: '2026-07-28T06:02:00Z',
      check_out_at: null,
      status: 'PENDING_MGR',
      employee_email: 'employee@example.com',
    },
    {
      id: 10,
      date: '2026-07-27',
      check_in_at: '2026-07-27T06:00:00Z',
      check_out_at: '2026-07-27T15:00:00Z',
      status: 'PRESENT',
    },
  ],
  page: 1,
  page_size: 30,
  count: 2,
  total_pages: 1,
};

describe('attendance contract', () => {
  it('uses only the verified Gate 1 self-service paths', () => {
    expect(ATTENDANCE_TIMELINE_PATH).toBe('/api/attendance/me/');
    expect(ATTENDANCE_CHECK_IN_PATH).toBe('/api/attendance/me/check-in/');
    expect(ATTENDANCE_CHECK_OUT_PATH).toBe('/api/attendance/me/check-out/');
  });

  it('requests the owner timeline without any employee selector', async () => {
    const { calls, client } = fakeClient(() => timelinePayload);

    await loadAttendanceTimeline(client, 30);

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/attendance/me/?page=1&page_size=30');
    expect(calls[0].path).not.toMatch(/employee|employee_id|user/u);
  });

  it('maps the paginated envelope and isolates the local calendar day', () => {
    const timeline = parseAttendanceTimeline(timelinePayload, '2026-07-28');

    expect(timeline.count).toBe(2);
    expect(timeline.records).toHaveLength(2);
    expect(timeline.today?.id).toBe(11);
    expect(timeline.records[0]).toEqual({
      id: 11,
      date: '2026-07-28',
      checkInAt: '2026-07-28T06:02:00Z',
      checkOutAt: null,
      status: 'PENDING_MGR',
    });
  });

  it('does not project fields the mobile client has no reason to hold', () => {
    const timeline = parseAttendanceTimeline(timelinePayload, '2026-07-28');

    expect(Object.keys(timeline.records[0]).sort()).toEqual([
      'checkInAt',
      'checkOutAt',
      'date',
      'id',
      'status',
    ]);
  });

  it('reports no record for today when the server returned only past days', () => {
    const timeline = parseAttendanceTimeline(timelinePayload, '2026-07-29');

    expect(timeline.today).toBeNull();
    expect(attendanceDayState(timeline.today)).toBe('not-checked-in');
  });

  it('rejects a response that does not match the paginated contract', () => {
    expect(() => parseAttendanceTimeline({ results: [] })).toThrow(ApiError);
  });

  it('formats the local date without shifting across the UTC boundary', () => {
    expect(localIsoDate(new Date(2026, 6, 28, 1, 30))).toBe('2026-07-28');
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('attendance day state', () => {
  it('derives the three employee-visible states', () => {
    expect(attendanceDayState(null)).toBe('not-checked-in');
    expect(
      attendanceDayState({
        id: 1,
        date: '2026-07-28',
        checkInAt: null,
        checkOutAt: null,
        status: null,
      }),
    ).toBe('not-checked-in');
    expect(
      attendanceDayState({
        id: 1,
        date: '2026-07-28',
        checkInAt: '2026-07-28T06:00:00Z',
        checkOutAt: null,
        status: null,
      }),
    ).toBe('checked-in');
    expect(
      attendanceDayState({
        id: 1,
        date: '2026-07-28',
        checkInAt: '2026-07-28T06:00:00Z',
        checkOutAt: '2026-07-28T15:00:00Z',
        status: null,
      }),
    ).toBe('checked-out');
  });
});

describe('attendance mutations', () => {
  it('posts to the verified check-in and check-out actions with no body', async () => {
    const { calls, client } = fakeClient(() => ({}));

    expect(await checkIn(client)).toEqual({ status: 'success', kind: 'check-in' });
    expect(await checkOut(client)).toEqual({ status: 'success', kind: 'check-out' });
    expect(calls).toEqual([
      { path: '/api/attendance/me/check-in/', method: 'POST' },
      { path: '/api/attendance/me/check-out/', method: 'POST' },
    ]);
  });

  it('translates a company-scope or role rejection into an honest unavailable state', async () => {
    const { client } = fakeClient(() => new ApiError('forbidden', 403));

    expect(await checkIn(client)).toEqual({
      status: 'failed',
      messageKey: 'attendance.actionsUnavailable',
    });
  });

  it('translates a missing employee profile into the same unavailable state', async () => {
    const { client } = fakeClient(() => new ApiError('not_found', 404));

    expect(await checkOut(client)).toEqual({
      status: 'failed',
      messageKey: 'attendance.actionsUnavailable',
    });
  });

  it('distinguishes duplicate-state, throttled, and offline failures', async () => {
    const duplicate = fakeClient(() => new ApiError('validation_failed', 400));
    const throttled = fakeClient(() => new ApiError('too_many_requests', 429));
    const offline = fakeClient(() => new ApiError('network_unavailable'));

    expect(await checkIn(duplicate.client)).toEqual({
      status: 'failed',
      messageKey: 'attendance.duplicate',
    });
    expect(await checkIn(throttled.client)).toEqual({
      status: 'failed',
      messageKey: 'attendance.rateLimited',
    });
    expect(await checkIn(offline.client)).toEqual({
      status: 'failed',
      messageKey: 'state.offlineBody',
    });
  });

  it('rethrows session expiry so the route boundary can sign the employee out', async () => {
    const { client } = fakeClient(() => new ApiError('session_expired', 401));

    await expect(checkIn(client)).rejects.toBeInstanceOf(ApiError);
  });
});
