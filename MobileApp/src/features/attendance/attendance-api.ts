import {
  ApiError,
  apiClient,
  identifierOrNull,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import type {
  AttendanceActionOutcome,
  AttendanceDayState,
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

function outcomeFromError(error: unknown): AttendanceActionOutcome {
  if (error instanceof ApiError) {
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
      return { status: 'failed', messageKey: 'attendance.duplicate' };
    }
    if (error.code === 'network_unavailable') {
      return { status: 'failed', messageKey: 'state.offlineBody' };
    }
    if (error.code === 'session_expired') throw error;
  }
  return { status: 'failed', messageKey: 'state.actionFailed' };
}

async function mutate(
  path: `/${string}`,
  kind: 'check-in' | 'check-out',
  client: ApiClient,
): Promise<AttendanceActionOutcome> {
  try {
    await client.request<unknown>(path, { method: 'POST' });
    return { status: 'success', kind };
  } catch (error) {
    return outcomeFromError(error);
  }
}

export function checkIn(client: ApiClient = apiClient): Promise<AttendanceActionOutcome> {
  return mutate(ATTENDANCE_CHECK_IN_PATH, 'check-in', client);
}

export function checkOut(client: ApiClient = apiClient): Promise<AttendanceActionOutcome> {
  return mutate(ATTENDANCE_CHECK_OUT_PATH, 'check-out', client);
}
