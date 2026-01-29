import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * Leave Type DTO
 */
export interface LeaveType {
  id: number;
  name: string;
  code: string;
  days_allowed_per_year: number;
  is_active: boolean;
}

/**
 * Leave Request DTO
 */
export interface LeaveRequest {
  id: number;
  employee_id?: number;
  employee_name?: string;
  leave_type: number;
  leave_type_name?: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string;
  status: "submitted" | "approved" | "rejected" | "cancelled" | string; // Normalized to lowercase in UI usually, but backend might send Capitalized. We should handle both.
  rejection_reason?: string;
  created_at?: string;
}

/**
 * Leave Balance DTO
 */
export interface LeaveBalance {
  leave_type: string;
  total_days: number;
  used_days: number;
  remaining_days: number;
}

/**
 * Payload for creating a leave request
 */
export interface CreateLeaveRequestPayload {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  reason: string;
}

/**
 * Filters for HR Inbox
 */
export interface LeaveRequestFilter {
  status?: string;
  employee_id?: number;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}


// --- Employee Endpoints ---

/**
 * Get all available leave types
 */
export async function getLeaveTypes(): Promise<ApiResponse<LeaveType[]>> {
  const { data } = await api.get<ApiResponse<LeaveType[]>>("/leave-types");
  return data;
}

/**
 * Submit a new leave request
 */
export async function createLeaveRequest(
  payload: CreateLeaveRequestPayload
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>("/leave-requests", payload);
  return data;
}

/**
 * Get my leave requests (Employee)
 */
export async function getMyLeaveRequests(
  params?: { page?: number; page_size?: number }
): Promise<ApiResponse<PaginatedResponse<LeaveRequest>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LeaveRequest>>>(
    "/employee/leave-requests",
    { params }
  );
  return data;
}

/**
 * Get my leave balance (Employee)
 */
export async function getMyLeaveBalance(
  year?: number
): Promise<ApiResponse<LeaveBalance[]>> {
  const { data } = await api.get<ApiResponse<LeaveBalance[]>>(
    "/employee/leave-balance",
    { params: { year } }
  );
  return data;
}


// --- HR Endpoints ---

/**
 * Get all leave requests (HR Inbox)
 */
export async function getLeaveRequests(
  params?: LeaveRequestFilter
): Promise<ApiResponse<PaginatedResponse<LeaveRequest>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LeaveRequest>>>(
    "/leave-requests",
    { params }
  );
  return data;
}

/**
 * Get single leave request details (HR)
 */
export async function getLeaveRequest(
  id: string | number
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.get<ApiResponse<LeaveRequest>>(`/leave-requests/${id}`);
  return data;
}

/**
 * Approve a leave request (HR)
 */
export async function approveLeaveRequest(
  id: string | number,
  comment?: string
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(
    `/leave-requests/${id}/approve`,
    { comment }
  );
  return data;
}

/**
 * Reject a leave request (HR)
 */
export async function rejectLeaveRequest(
  id: string | number,
  comment: string
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(
    `/leave-requests/${id}/reject`,
    { comment }
  );
  return data;
}

/**
 * Cancel a leave request (Optional - if backend supports)
 */
export async function cancelLeaveRequest(
  id: string | number
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(`/leave-requests/${id}/cancel`);
  return data;
}
