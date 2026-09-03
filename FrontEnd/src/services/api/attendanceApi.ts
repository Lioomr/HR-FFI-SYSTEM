import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import type {
  AttendanceFilters,
  AttendanceRecord,
} from "../../types/attendance";

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
}

export interface OverrideAttendanceDto {
  status?: "PRESENT" | "ABSENT" | "LATE" | "REJECTED";
  check_in_at?: string | null;
  check_out_at?: string | null;
  notes?: string;
  override_reason?: string;
}

export interface AttendanceDecisionDto {
  notes?: string;
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

export async function checkIn(): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.post<ApiResponse<AttendanceRecord>>(
    "/api/attendance/me/check-in/",
  );
  return data;
}

export async function checkOut(): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.post<ApiResponse<AttendanceRecord>>(
    "/api/attendance/me/check-out/",
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

export async function overrideAttendance(
  id: string | number,
  payload: OverrideAttendanceDto,
): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.patch<ApiResponse<AttendanceRecord>>(
    `/api/attendance/${id}/`,
    payload,
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

export async function approveCEOAttendance(
  id: string | number,
  payload?: AttendanceDecisionDto,
): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.post<ApiResponse<AttendanceRecord>>(
    `/api/ceo/attendance/${id}/approve/`,
    payload || {},
  );
  return data;
}

export async function rejectCEOAttendance(
  id: string | number,
  payload: AttendanceDecisionDto,
): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.post<ApiResponse<AttendanceRecord>>(
    `/api/ceo/attendance/${id}/reject/`,
    payload,
  );
  return data;
}
