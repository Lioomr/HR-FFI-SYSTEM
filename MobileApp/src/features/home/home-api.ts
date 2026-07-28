import { ApiError, apiClient, type ApiClient } from '@/services/api';

import type {
  AnnouncementPreview,
  AttendanceRecordPreview,
  HomeDashboardSnapshot,
  HomeSection,
  HomeSectionFailureKind,
  LeaveBalancePreview,
} from './types';

const ATTENDANCE_PATH = '/api/attendance/me/?page=1&page_size=7' as const;
const ANNOUNCEMENTS_PATH = '/api/announcements/?page=1&page_size=3' as const;
const UNREAD_COUNT_PATH = '/api/notifications/unread-count/' as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function identifierOrNull(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paginatedItems(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new ApiError('invalid_response');
  return value.items;
}

export function parseAttendance(value: unknown): AttendanceRecordPreview[] {
  return paginatedItems(value).map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      id: identifierOrNull(record.id),
      date: stringOrNull(record.date),
      checkInAt: stringOrNull(record.check_in_at),
      checkOutAt: stringOrNull(record.check_out_at),
      status: stringOrNull(record.status),
    };
  });
}

export function parseLeaveBalances(value: unknown): LeaveBalancePreview[] {
  if (!Array.isArray(value)) throw new ApiError('invalid_response');
  return value.map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      leaveTypeId: typeof record.leave_type_id === 'number' ? record.leave_type_id : null,
      leaveType: stringOrNull(record.leave_type),
      remainingDays: finiteNumberOrNull(record.remaining_days),
    };
  });
}

export function parseAnnouncements(value: unknown): AnnouncementPreview[] {
  return paginatedItems(value).map((item) => {
    const record = isRecord(item) ? item : {};
    return {
      id: identifierOrNull(record.id),
      title: stringOrNull(record.title),
      contentPreview: stringOrNull(record.content_preview),
      createdAt: stringOrNull(record.created_at),
    };
  });
}

export function parseUnreadCount(value: unknown): number {
  if (!isRecord(value) || typeof value.unread_count !== 'number' || value.unread_count < 0) {
    throw new ApiError('invalid_response');
  }
  return Math.floor(value.unread_count);
}

function failureKind(reason: unknown): HomeSectionFailureKind {
  if (reason instanceof ApiError) {
    if (reason.code === 'network_unavailable') return 'offline';
    if (reason.code === 'session_expired') return 'session-expired';
  }
  return 'unavailable';
}

function sectionFrom<T>(
  result: PromiseSettledResult<unknown>,
  parse: (value: unknown) => T,
): HomeSection<T> {
  if (result.status === 'rejected') return { status: 'error', kind: failureKind(result.reason) };
  try {
    return { status: 'ready', data: parse(result.value) };
  } catch (error) {
    return { status: 'error', kind: failureKind(error) };
  }
}

/**
 * Fetches each dashboard section independently. Returned HR data is a plain
 * in-memory snapshot; this feature owns no persistence or query cache.
 */
export async function loadHomeDashboard(
  year = new Date().getFullYear(),
  client: ApiClient = apiClient,
): Promise<HomeDashboardSnapshot> {
  const leavePath = `/api/leaves/employee/leave-balance/?year=${year}` as `/${string}`;
  const [attendance, leaveBalances, announcements, unreadNotifications] = await Promise.allSettled([
    client.request<unknown>(ATTENDANCE_PATH),
    client.request<unknown>(leavePath),
    client.request<unknown>(ANNOUNCEMENTS_PATH),
    client.request<unknown>(UNREAD_COUNT_PATH),
  ]);

  return {
    attendance: sectionFrom(attendance, parseAttendance),
    leaveBalances: sectionFrom(leaveBalances, parseLeaveBalances),
    announcements: sectionFrom(announcements, parseAnnouncements),
    unreadNotifications: sectionFrom(unreadNotifications, parseUnreadCount),
  };
}
