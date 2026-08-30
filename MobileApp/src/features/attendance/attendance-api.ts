import {
  ApiError,
  apiClient,
  identifierOrNull,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import {
  captureCurrentReading,
  type CaptureLocation,
  type GeoReading,
  type LocationFailureReason,
} from '@/services/location';

import type {
  AttendanceActionOutcome,
  AttendanceDayState,
  AttendanceFailureKey,
  AttendanceRecord,
  AttendanceTimeline,
} from './types';

/** Verified Gate 1 routes. Paths are appended to the configured origin unchanged. */
export const ATTENDANCE_TIMELINE_PATH = '/api/attendance/me/' as const;
export const ATTENDANCE_CHECK_IN_PATH = '/api/attendance/me/check-in/' as const;
export const ATTENDANCE_CHECK_OUT_PATH = '/api/attendance/me/check-out/' as const;

export const ATTENDANCE_PAGE_SIZE = 30;

export function parseAttendanceRecord(value: unknown): AttendanceRecord {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    date: stringOrNull(item.date),
    checkInAt: stringOrNull(item.check_in_at),
    checkOutAt: stringOrNull(item.check_out_at),
    status: stringOrNull(item.status),
  };
}

/** Local calendar day in ISO `YYYY-MM-DD`, matching the server's `timezone.localdate()`. */
export function localIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseAttendanceTimeline(
  value: unknown,
  today = localIsoDate(),
): AttendanceTimeline {
  const page = parsePaginated(value, parseAttendanceRecord);
  return {
    records: page.items,
    count: page.count,
    today: page.items.find((item) => item.date === today) ?? null,
  };
}

export function attendanceDayState(today: AttendanceRecord | null): AttendanceDayState {
  if (!today || !today.checkInAt) return 'not-checked-in';
  return today.checkOutAt ? 'checked-out' : 'checked-in';
}

export async function loadAttendanceTimeline(
  client: ApiClient = apiClient,
  pageSize = ATTENDANCE_PAGE_SIZE,
): Promise<AttendanceTimeline> {
  const path = `${ATTENDANCE_TIMELINE_PATH}?page=1&page_size=${pageSize}` as `/${string}`;
  return parseAttendanceTimeline(await client.request<unknown>(path));
}

/**
 * The exact 400/422 sentences from the "Mobile self-service GPS contract" failure table
 * in `plans/Geofenced Attendance Phase 8 Backend Contract.md`, each mapped to a local
 * translated string.
 *
 * These are a closed allowlist matched with `===` and used only to *choose* a message
 * key. The server sentence itself is never rendered, so an unrecognised or reworded
 * response degrades to the existing generic copy instead of leaking raw server text.
 * The backend does not translate any of these sentences and the client sends no
 * `Accept-Language`, so the comparison is against a stable English value.
 */
const CONTRACT_FAILURE_KEYS: Readonly<Record<string, AttendanceFailureKey>> = Object.freeze({
  'Invalid GPS coordinates.': 'attendance.invalidLocation',
  'GPS accuracy must be 100 metres or better.': 'attendance.poorAccuracy',
  'Check-in already exists for today.': 'attendance.alreadyCheckedIn',
  'No check-in record found for today.': 'attendance.missingCheckIn',
  'Check-out already exists for today.': 'attendance.alreadyCheckedOut',
});

function contractFailureKey(details: readonly string[]): AttendanceFailureKey | null {
  for (const detail of details) {
    if (Object.hasOwn(CONTRACT_FAILURE_KEYS, detail)) return CONTRACT_FAILURE_KEYS[detail];
  }
  return null;
}

/** The two contract rejections that mean the server judged the GPS payload itself. */
const GPS_REJECTION_KEYS: readonly AttendanceFailureKey[] = [
  'attendance.invalidLocation',
  'attendance.poorAccuracy',
];

/** The local, actionable state for a device that could not produce a reading. */
function localFailureKey(reason: LocationFailureReason): AttendanceFailureKey {
  return reason === 'permission-denied'
    ? 'attendance.locationPermissionDenied'
    : 'attendance.locationUnavailable';
}

/**
 * `deviceFailure` is set only when this action was sent as a legacy request because the
 * device could not produce a reading. In that case a GPS rejection tells us geofencing is
 * enabled, and the employee's real, fixable problem is the local one - permission or no
 * fix - not the server's generic "invalid coordinates". Reporting the local cause keeps
 * the message actionable instead of pointing at a payload the employee never sent.
 */
function outcomeFromError(
  error: unknown,
  deviceFailure: LocationFailureReason | null,
): AttendanceActionOutcome {
  if (error instanceof ApiError) {
    // The dedicated outside-site state. The client reaches this only for the one exact
    // 403 envelope the contract defines; no site name, coordinate, radius, or distance
    // is present in the response or shown to the employee.
    if (error.code === 'outside_work_location') {
      return { status: 'failed', messageKey: 'attendance.outsideWorkLocation' };
    }
    if (error.code === 'forbidden') {
      return { status: 'failed', messageKey: 'attendance.actionsUnavailable' };
    }
    if (error.code === 'not_found') {
      return { status: 'failed', messageKey: 'attendance.actionsUnavailable' };
    }
    if (error.code === 'too_many_requests') {
      return { status: 'failed', messageKey: 'attendance.rateLimited' };
    }
    if (error.code === 'validation_failed') {
      const key = contractFailureKey(error.details);
      if (deviceFailure !== null && key !== null && GPS_REJECTION_KEYS.includes(key)) {
        return { status: 'failed', messageKey: localFailureKey(deviceFailure) };
      }
      return { status: 'failed', messageKey: key ?? 'attendance.duplicate' };
    }
    if (error.code === 'network_unavailable') {
      return { status: 'failed', messageKey: 'state.offlineBody' };
    }
    if (error.code === 'session_expired') throw error;
  }
  return { status: 'failed', messageKey: 'state.actionFailed' };
}

/**
 * The exact body from the Phase 8 contract, and nothing else. No work location, company,
 * site name, radius, or distance is inferred or sent; the server resolves the site.
 */
export function geofenceRequestBody(reading: GeoReading) {
  return {
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracy_meters: reading.accuracyMeters,
  };
}

/**
 * Performs one attendance action with exactly one POST.
 *
 * A fresh fix is attempted immediately before the request. When it succeeds the strict
 * three-field GPS body is sent. When the device cannot produce a reading, the *initial*
 * request is the legacy empty-body form, which the contract keeps compatible while
 * `attendance.geofence_enabled` is false. That choice is made before any request is
 * sent, so it is never a retry: whatever the server answers is reported as-is, and no
 * response - 403, 422, or otherwise - can cause a second request.
 */
async function mutate(
  path: `/${string}`,
  kind: 'check-in' | 'check-out',
  client: ApiClient,
  capture: CaptureLocation,
): Promise<AttendanceActionOutcome> {
  const location = await capture();
  // Partial coordinates are never sent: either all three fields, or none of them.
  const options =
    location.status === 'ready'
      ? { method: 'POST' as const, body: geofenceRequestBody(location.reading) }
      : { method: 'POST' as const };
  const deviceFailure = location.status === 'failed' ? location.reason : null;

  try {
    await client.request<unknown>(path, options);
    return { status: 'success', kind };
  } catch (error) {
    return outcomeFromError(error, deviceFailure);
  }
}

export function checkIn(
  client: ApiClient = apiClient,
  capture: CaptureLocation = captureCurrentReading,
): Promise<AttendanceActionOutcome> {
  return mutate(ATTENDANCE_CHECK_IN_PATH, 'check-in', client, capture);
}

export function checkOut(
  client: ApiClient = apiClient,
  capture: CaptureLocation = captureCurrentReading,
): Promise<AttendanceActionOutcome> {
  return mutate(ATTENDANCE_CHECK_OUT_PATH, 'check-out', client, capture);
}
