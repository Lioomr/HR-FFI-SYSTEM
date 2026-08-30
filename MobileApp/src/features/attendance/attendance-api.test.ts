import { describe, expect, it } from '@jest/globals';

import { ApiError, type ApiClient } from '@/services/api';
import type { CaptureLocation, LocationFailureReason, LocationOutcome } from '@/services/location';

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
  body?: unknown;
}

function fakeClient(handler: (call: Call) => unknown): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    async request(path: string, options?: { method?: string; body?: unknown }) {
      const call = { path, method: options?.method, body: options?.body };
      calls.push(call);
      const result = handler(call);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as ApiClient;
  return { client, calls };
}

/** A granted permission and a fix well inside any sane radius. */
const insideSite: CaptureLocation = async () => ({
  status: 'ready',
  reading: { latitude: '24.713600', longitude: '46.675300', accuracyMeters: '12.50' },
});

function locationFailure(reason: LocationFailureReason): CaptureLocation {
  return async (): Promise<LocationOutcome> => ({ status: 'failed', reason });
}

/** Both local reasons a device can fail to produce a reading. */
const captureFailures: LocationFailureReason[] = ['permission-denied', 'unavailable'];

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

describe('geofenced attendance mutations', () => {
  it('sends exactly the three contract fields on check-in and check-out', async () => {
    const { calls, client } = fakeClient(() => ({}));

    expect(await checkIn(client, insideSite)).toEqual({ status: 'success', kind: 'check-in' });
    expect(await checkOut(client, insideSite)).toEqual({ status: 'success', kind: 'check-out' });

    expect(calls).toEqual([
      {
        path: '/api/attendance/me/check-in/',
        method: 'POST',
        body: { latitude: '24.713600', longitude: '46.675300', accuracy_meters: '12.50' },
      },
      {
        path: '/api/attendance/me/check-out/',
        method: 'POST',
        body: { latitude: '24.713600', longitude: '46.675300', accuracy_meters: '12.50' },
      },
    ]);
  });

  it('sends no work location, site, radius, distance, or ownership selector', async () => {
    const { calls, client } = fakeClient(() => ({}));

    await checkIn(client, insideSite);

    expect(Object.keys(calls[0].body as object).sort()).toEqual([
      'accuracy_meters',
      'latitude',
      'longitude',
    ]);
    expect(JSON.stringify(calls[0].body)).not.toMatch(
      /work_location|site|radius|distance|company|employee/iu,
    );
  });

  it('captures a fresh fix for every action rather than reusing one', async () => {
    const { client } = fakeClient(() => ({}));
    let captures = 0;
    const capture: CaptureLocation = async () => {
      captures += 1;
      return {
        status: 'ready',
        reading: { latitude: '24.713600', longitude: '46.675300', accuracyMeters: '12.50' },
      };
    };

    await checkIn(client, capture);
    await checkOut(client, capture);

    expect(captures).toBe(2);
  });

  it.each(captureFailures)(
    'completes check-in with exactly one legacy empty-body request when capture fails (%s)',
    async (reason) => {
      const { calls, client } = fakeClient(() => ({}));

      expect(await checkIn(client, locationFailure(reason))).toEqual({
        status: 'success',
        kind: 'check-in',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ path: '/api/attendance/me/check-in/', method: 'POST' });
      expect(calls[0].body).toBeUndefined();
    },
  );

  it.each(captureFailures)(
    'completes check-out with exactly one legacy empty-body request when capture fails (%s)',
    async (reason) => {
      const { calls, client } = fakeClient(() => ({}));

      expect(await checkOut(client, locationFailure(reason))).toEqual({
        status: 'success',
        kind: 'check-out',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ path: '/api/attendance/me/check-out/', method: 'POST' });
      expect(calls[0].body).toBeUndefined();
    },
  );

  it('sends no partial coordinates when the device produced no reading', async () => {
    const { calls, client } = fakeClient(() => ({}));

    await checkIn(client, locationFailure('unavailable'));

    expect(JSON.stringify(calls[0])).not.toMatch(
      /latitude|longitude|accuracy|work_location|site|radius|distance|company|employee/iu,
    );
  });

  it('reports the device cause, not the server wording, when geofencing rejects the legacy request', async () => {
    const denied = fakeClient(
      () => new ApiError('validation_failed', 422, ['Invalid GPS coordinates.']),
    );
    const unavailable = fakeClient(
      () => new ApiError('validation_failed', 422, ['Invalid GPS coordinates.']),
    );

    expect(await checkIn(denied.client, locationFailure('permission-denied'))).toEqual({
      status: 'failed',
      messageKey: 'attendance.locationPermissionDenied',
    });
    expect(await checkOut(unavailable.client, locationFailure('unavailable'))).toEqual({
      status: 'failed',
      messageKey: 'attendance.locationUnavailable',
    });
    expect(denied.calls).toHaveLength(1);
    expect(unavailable.calls).toHaveLength(1);
  });

  it('still reports duplicate state honestly when the legacy request hits a used-up day', async () => {
    const { calls, client } = fakeClient(
      () => new ApiError('validation_failed', 400, ['Check-in already exists for today.']),
    );

    expect(await checkIn(client, locationFailure('permission-denied'))).toEqual({
      status: 'failed',
      messageKey: 'attendance.alreadyCheckedIn',
    });
    expect(calls).toHaveLength(1);
  });

  it('keeps the server GPS wording when a real reading was sent', async () => {
    const { client } = fakeClient(
      () => new ApiError('validation_failed', 422, ['Invalid GPS coordinates.']),
    );

    expect(await checkIn(client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.invalidLocation',
    });
  });

  it('makes at most one POST for every action, on every outcome', async () => {
    const outcomes: (() => unknown)[] = [
      () => ({}),
      () => new ApiError('outside_work_location', 403),
      () => new ApiError('forbidden', 403),
      () => new ApiError('validation_failed', 422, ['Invalid GPS coordinates.']),
      () => new ApiError('validation_failed', 422, ['GPS accuracy must be 100 metres or better.']),
      () => new ApiError('validation_failed', 400, ['Check-in already exists for today.']),
      () => new ApiError('not_found', 404),
      () => new ApiError('too_many_requests', 429),
      () => new ApiError('network_unavailable'),
    ];

    for (const outcome of outcomes) {
      for (const capture of [
        insideSite,
        locationFailure('permission-denied'),
        locationFailure('unavailable'),
      ]) {
        const forCheckIn = fakeClient(outcome);
        const forCheckOut = fakeClient(outcome);
        await checkIn(forCheckIn.client, capture);
        await checkOut(forCheckOut.client, capture);
        expect(forCheckIn.calls).toHaveLength(1);
        expect(forCheckOut.calls).toHaveLength(1);
      }
    }
  });

  it('maps the 403 outside-site contract response to its dedicated state', async () => {
    const { client } = fakeClient(() => new ApiError('outside_work_location', 403));

    expect(await checkIn(client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.outsideWorkLocation',
    });
  });

  it('keeps every other 403 on the generic unavailable state', async () => {
    const { client } = fakeClient(() => new ApiError('forbidden', 403));

    expect(await checkIn(client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.actionsUnavailable',
    });
  });

  it('maps the two 422 GPS rejections to distinct states', async () => {
    const invalid = fakeClient(
      () => new ApiError('validation_failed', 422, ['Invalid GPS coordinates.']),
    );
    const inaccurate = fakeClient(
      () => new ApiError('validation_failed', 422, ['GPS accuracy must be 100 metres or better.']),
    );

    expect(await checkIn(invalid.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.invalidLocation',
    });
    expect(await checkIn(inaccurate.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.poorAccuracy',
    });
  });

  it('distinguishes duplicate check-in, missing check-in, and duplicate check-out', async () => {
    const duplicateIn = fakeClient(
      () => new ApiError('validation_failed', 400, ['Check-in already exists for today.']),
    );
    const missingIn = fakeClient(
      () => new ApiError('validation_failed', 400, ['No check-in record found for today.']),
    );
    const duplicateOut = fakeClient(
      () => new ApiError('validation_failed', 400, ['Check-out already exists for today.']),
    );

    expect(await checkIn(duplicateIn.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.alreadyCheckedIn',
    });
    expect(await checkOut(missingIn.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.missingCheckIn',
    });
    expect(await checkOut(duplicateOut.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.alreadyCheckedOut',
    });
  });

  it('falls back to generic copy for a 400 the contract does not define', async () => {
    const { client } = fakeClient(
      () => new ApiError('validation_failed', 400, ['Some newly worded server rule.']),
    );

    expect(await checkIn(client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.duplicate',
    });
  });

  it('never replays a rejected action, and never drops coordinates after a rejection', async () => {
    const { calls, client } = fakeClient(() => new ApiError('outside_work_location', 403));

    await checkIn(client, insideSite);

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      latitude: '24.713600',
      longitude: '46.675300',
      accuracy_meters: '12.50',
    });
  });

  it('never replays with coordinates after a legacy request is rejected', async () => {
    const { calls, client } = fakeClient(
      () => new ApiError('validation_failed', 422, ['Invalid GPS coordinates.']),
    );

    await checkIn(client, locationFailure('permission-denied'));

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBeUndefined();
  });

  it('translates a missing employee profile into the unavailable state', async () => {
    const { client } = fakeClient(() => new ApiError('not_found', 404));

    expect(await checkOut(client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.actionsUnavailable',
    });
  });

  it('distinguishes throttled and offline failures', async () => {
    const throttled = fakeClient(() => new ApiError('too_many_requests', 429));
    const offline = fakeClient(() => new ApiError('network_unavailable'));

    expect(await checkIn(throttled.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'attendance.rateLimited',
    });
    expect(await checkIn(offline.client, insideSite)).toEqual({
      status: 'failed',
      messageKey: 'state.offlineBody',
    });
  });

  it('rethrows session expiry so the route boundary can sign the employee out', async () => {
    const { client } = fakeClient(() => new ApiError('session_expired', 401));

    await expect(checkIn(client, insideSite)).rejects.toBeInstanceOf(ApiError);
  });
});
