import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";
import type { AttendanceFilters } from "../../types/attendance";

// Attendance record type
export interface AttendanceRecord {
  id: number;
  employee_profile: number;
  employee_name?: string;
  employee_email?: string;
  date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: "PRESENT" | "ABSENT" | "LATE";
  source: "EMPLOYEE" | "HR" | "SYSTEM";
  is_overridden: boolean;
  notes?: string;
  override_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceListResponse {
  results: AttendanceRecord[];
  count: number;
  page?: number;
  page_size?: number;
}

export interface OverrideAttendanceDto {
  status?: "PRESENT" | "ABSENT" | "LATE";
  check_in_at?: string | null;
  check_out_at?: string | null;
  notes?: string;
  override_reason?: string;
}

// Employee Endpoints
export async function getMyAttendance(
  params?: AttendanceFilters
): Promise<ApiResponse<AttendanceListResponse>> {
  const { data } = await api.get<ApiResponse<AttendanceListResponse>>(
    "/api/attendance/me/",
    { params }
  );
  return data;
}

export async function checkIn(): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.post<ApiResponse<AttendanceRecord>>(
    "/api/attendance/me/check-in/"
  );
  return data;
}

export async function checkOut(): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.post<ApiResponse<AttendanceRecord>>(
    "/api/attendance/me/check-out/"
  );
  return data;
}

// HR Endpoints
export async function getGlobalAttendance(
  params?: AttendanceFilters
): Promise<ApiResponse<AttendanceListResponse>> {
  const { data } = await api.get<ApiResponse<AttendanceListResponse>>(
    "/api/attendance/",
    { params }
  );
  return data;
}

export async function overrideAttendance(
  id: string | number,
  payload: OverrideAttendanceDto
): Promise<ApiResponse<AttendanceRecord>> {
  const { data } = await api.patch<ApiResponse<AttendanceRecord>>(
    `/api/attendance/${id}/`,
    payload
  );
  return data;
}
