import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import type {
  AttendanceFilters,
  AttendanceRecord,
} from "../../types/attendance";
import type {
  AttendanceDailyResult,
  AttendanceLateNotice,
  AttendanceLateViolation,
  AttendanceNoticeFilters,
  AttendanceRecalculationRequest,
  AttendanceRecalculationResponse,
  AttendanceViolationFilters,
} from "../../types/attendancePolicy";
import { noticeFilename } from "../../utils/attendancePolicy";
import { downloadBlob } from "../../utils/download";

// `types/attendance.ts` holds the single record shape. This module used to
// carry a second copy that had drifted — it was missing `is_late_flagged` and
// `late_minutes`, so `AttendanceListResponse` was typed without the late fields
// the pages already read. Re-export instead of redeclaring.
export type { AttendanceRecord };

export interface AttendanceListResponse {
  results: AttendanceRecord[];
  count: number;
  page?: number;
  page_size?: number;
  summary?: Partial<Record<AttendanceRecord["status"], number>>;
  effective_summary?: Partial<
    Record<NonNullable<AttendanceRecord["effective_status"]>, number>
  >;
}

// Employee Endpoints
export async function getMyAttendance(
  params?: AttendanceFilters,
): Promise<ApiResponse<AttendanceListResponse>> {
  const { data } = await api.get<ApiResponse<AttendanceListResponse>>(
    "/api/attendance/me/",
    { params },
  );
  return data;
}

// HR Endpoints
export async function getGlobalAttendance(
  params?: AttendanceFilters,
): Promise<ApiResponse<AttendanceListResponse>> {
  const { data } = await api.get<ApiResponse<AttendanceListResponse>>(
    "/api/attendance/",
    { params },
  );
  return data;
}

export async function getCEOAttendance(
  params?: AttendanceFilters,
): Promise<ApiResponse<AttendanceListResponse>> {
  const { data } = await api.get<ApiResponse<AttendanceListResponse>>(
    "/api/ceo/attendance/",
    { params },
  );
  return data;
}

// Attendance policy endpoints. The active company travels in the
// X-Active-Company-Id header added by apiClient; never add it here.

/** Today's policy result for the signed-in employee. */
export async function getTodayAttendanceSummary(): Promise<
  ApiResponse<AttendanceDailyResult>
> {
  const { data } = await api.get<ApiResponse<AttendanceDailyResult>>(
    "/api/attendance/me/today-summary/",
  );
  return data;
}

/** HR Manager / System Admin: rebuild one employee's days from raw punches. */
export async function recalculateAttendance(
  payload: AttendanceRecalculationRequest,
): Promise<ApiResponse<AttendanceRecalculationResponse>> {
  const { data } = await api.post<ApiResponse<AttendanceRecalculationResponse>>(
    "/api/attendance/hr/recalculate/",
    payload,
  );
  return data;
}

/**
 * Query string for the violation list. Multi-value filters are joined with
 * commas and empty values are dropped, so an unset filter never narrows.
 */
export function toViolationQueryParams(
  filters: AttendanceViolationFilters = {},
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (filters.mine) params.mine = "true";
  if (filters.page) params.page = filters.page;
  if (filters.page_size) params.page_size = filters.page_size;
  const lifecycle = filters.lifecycle?.filter(Boolean) ?? [];
  if (lifecycle.length) params.lifecycle = lifecycle.join(",");
  const payrollStatus = filters.payroll_status?.filter(Boolean) ?? [];
  if (payrollStatus.length) params.payroll_status = payrollStatus.join(",");
  if (
    filters.employee_profile_id !== undefined &&
    String(filters.employee_profile_id).trim() !== ""
  ) {
    params.employee_profile_id = filters.employee_profile_id;
  }
  if (filters.date_from) params.date_from = filters.date_from;
  if (filters.date_to) params.date_to = filters.date_to;
  const search = filters.search?.trim();
  if (search) params.search = search;
  return params;
}

/** Newest first. HR sees the company; every other role sees only their own. */
export async function getAttendanceViolations(
  filters?: AttendanceViolationFilters,
): Promise<ApiResponse<PaginatedResponse<AttendanceLateViolation>>> {
  const { data } = await api.get<
    ApiResponse<PaginatedResponse<AttendanceLateViolation>>
  >("/api/attendance/violations/", {
    params: toViolationQueryParams(filters),
  });
  return data;
}

export async function getAttendanceViolation(
  id: number | string,
): Promise<ApiResponse<AttendanceLateViolation>> {
  const { data } = await api.get<ApiResponse<AttendanceLateViolation>>(
    `/api/attendance/violations/${id}/`,
  );
  return data;
}

/** Query string for the notice list, built like the violation list's. */
export function toNoticeQueryParams(
  filters: AttendanceNoticeFilters = {},
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (filters.mine) params.mine = "true";
  if (filters.page) params.page = filters.page;
  if (filters.page_size) params.page_size = filters.page_size;
  const levels = filters.notice_level?.filter(Boolean) ?? [];
  if (levels.length) params.notice_level = levels.join(",");
  if (
    filters.employee_profile_id !== undefined &&
    String(filters.employee_profile_id).trim() !== ""
  ) {
    params.employee_profile_id = filters.employee_profile_id;
  }
  if (filters.date_from) params.date_from = filters.date_from;
  if (filters.date_to) params.date_to = filters.date_to;
  const search = filters.search?.trim();
  if (search) params.search = search;
  return params;
}

/** Newest first. HR sees the active company; every other role sees only their own. */
export async function getAttendanceNotices(
  filters?: AttendanceNoticeFilters,
): Promise<ApiResponse<PaginatedResponse<AttendanceLateNotice>>> {
  const { data } = await api.get<
    ApiResponse<PaginatedResponse<AttendanceLateNotice>>
  >("/api/attendance/notices/", {
    params: toNoticeQueryParams(filters),
  });
  return data;
}

export async function getAttendanceNotice(
  id: number | string,
): Promise<ApiResponse<AttendanceLateNotice>> {
  const { data } = await api.get<ApiResponse<AttendanceLateNotice>>(
    `/api/attendance/notices/${id}/`,
  );
  return data;
}

/**
 * The notice PDF is private. It is fetched through apiClient, which adds the
 * bearer token and active company, and saved from the blob. Never link to a
 * storage URL.
 */
export async function downloadAttendanceNotice(
  notice: Pick<AttendanceLateNotice, "id" | "filename" | "reference_number">,
): Promise<void> {
  const response = await api.get<Blob>(
    `/api/attendance/notices/${notice.id}/download/`,
    { responseType: "blob" },
  );
  downloadBlob(response.data, noticeFilename(notice));
}
