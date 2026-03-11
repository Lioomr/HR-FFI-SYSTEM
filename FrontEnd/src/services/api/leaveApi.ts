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
  requires_ceo_approval: boolean;
}

/**
 * Leave Request DTO
 */
export interface LeaveRequest {
  id: number;
  // Backend returns nested objects
  employee: {
    id: number;
    email: string;
    full_name: string;
  };
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number; // Backend returns 'days' field via get_days method (was days_requested in frontend?)
  // Let's check serializer again. Serializer has get_days -> 'days'.
  // Frontend had 'days_requested'. I should use 'days' to match backend.
  reason: string;
  document?: string | null;
  status: "submitted" | "pending_manager" | "pending_hr" | "pending_ceo" | "approved" | "rejected" | "cancelled";
  source?: "employee" | "hr_manual";
  manual_entry_reason?: string;
  source_document_ref?: string;
  entered_by?: number | null;
  warning_messages?: string[];
  rejection_reason?: string; // If mapped from hr_decision_note? Serializer fields=__all__. 
  // Model has hr_decision_note, manager_decision_note. Frontend might want generic 'rejection_reason'.
  // Backend keys: hr_decision_note, manager_decision_note.
  // I will keep existing + add specific ones if needed.
  hr_decision_note?: string;
  manager_decision_note?: string;
  ceo_decision_note?: string;
  manager_decision_at?: string | null;
  ceo_decision_at?: string | null;
  decided_at?: string | null;
  decision_reason?: string;
  created_at?: string;
}

/**
 * Leave Balance DTO
 */
export interface LeaveBalance {
  leave_type_id: number;
  leave_type: string;
  total_days: number;
  used_days: number;
  remaining_days: number;
}

/**
 * Payload for creating a leave request
 */
export interface CreateLeaveRequestPayload {
  leave_type: number; // Changed from leave_type_id
  start_date: string;
  end_date: string;
  reason: string;
  document?: File;
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
  const { data } = await api.get<ApiResponse<LeaveType[]>>("/api/leaves/leave-types/");
  return data;
}

/**
 * Submit a new leave request
 */
export async function createLeaveRequest(
  payload: CreateLeaveRequestPayload | FormData
): Promise<ApiResponse<LeaveRequest>> {
  const config = payload instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : undefined;
  const { data } = await api.post<ApiResponse<LeaveRequest>>("/api/leaves/leave-requests/", payload, config);
  return data;
}

/**
 * Get my leave requests (Employee)
 */
export async function getMyLeaveRequests(
  params?: { page?: number; page_size?: number }
): Promise<ApiResponse<PaginatedResponse<LeaveRequest>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LeaveRequest>>>(
    "/api/leaves/employee/leave-requests/",
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
    "/api/leaves/employee/leave-balance/",
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
    "/api/leaves/leave-requests/",
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
  const { data } = await api.get<ApiResponse<LeaveRequest>>(`/api/leaves/leave-requests/${id}/`);
  return data;
}

export async function getLeaveRequestDocumentBlob(
  id: string | number,
  download = false
): Promise<Blob> {
  const { data } = await api.get(
    `/api/leaves/leave-requests/${id}/document/`,
    {
      params: download ? { download: 1 } : undefined,
      responseType: "blob",
    }
  );
  return data;
}

export async function getLeaveRequestPdfBlob(
  id: string | number,
  download = true
): Promise<Blob> {
  const { data } = await api.get(
    `/api/leaves/leave-requests/${id}/pdf/`,
    {
      params: download ? { download: 1 } : { download: 0 },
      responseType: "blob",
    }
  );
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
    `/api/leaves/leave-requests/${id}/approve/`,
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
    `/api/leaves/leave-requests/${id}/reject/`,
    { comment }
  );
  return data;
}

export interface HRManualLeaveRequestPayload {
  employee_id: number;
  leave_type: number;
  start_date: string;
  end_date: string;
  reason?: string;
  manual_entry_reason: string;
  source_document_ref: string;
  document?: File;
}

export async function sendLeaveRequestToCEO(
  id: string | number,
  comment?: string
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(
    `/api/leaves/leave-requests/${id}/send-to-ceo/`,
    { comment }
  );
  return data;
}

export async function createHRManualLeaveRequest(
  payload: HRManualLeaveRequestPayload | FormData
): Promise<ApiResponse<LeaveRequest>> {
  const config = payload instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : undefined;
  const { data } = await api.post<ApiResponse<LeaveRequest>>("/api/leaves/hr/manual-leave-requests/", payload, config);
  return data;
}

export async function updateHRManualLeaveRequest(
  id: string | number,
  payload: Partial<HRManualLeaveRequestPayload> | FormData
): Promise<ApiResponse<LeaveRequest>> {
  const config = payload instanceof FormData ? { headers: { "Content-Type": "multipart/form-data" } } : undefined;
  const { data } = await api.patch<ApiResponse<LeaveRequest>>(`/api/leaves/hr/manual-leave-requests/${id}/`, payload, config);
  return data;
}

export async function deleteHRManualLeaveRequest(id: string | number): Promise<ApiResponse<Record<string, never>>> {
  const { data } = await api.delete<ApiResponse<Record<string, never>>>(`/api/leaves/hr/manual-leave-requests/${id}/`);
  return data;
}

export async function cancelLeaveRequest(
  id: string | number
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(`/api/leaves/leave-requests/${id}/cancel/`);
  return data;
}

/**
 * Get leave balances for an employee (HR)
 */
export async function getLeaveBalances(
  employeeId: number | string,
  year?: number
): Promise<ApiResponse<LeaveBalance[]>> {
  const { data } = await api.get<ApiResponse<LeaveBalance[]>>("/api/leaves/leave-balances/", {
    params: { employee_id: employeeId, year }
  });
  return data;
}

/**
 * Create a leave balance adjustment
 */
export interface CreateAdjustmentPayload {
  employee_id: number;
  leave_type: number;
  adjustment_days: number;
  reason: string;
}

export async function createLeaveAdjustment(
  payload: CreateAdjustmentPayload
): Promise<ApiResponse<any>> {
  const { data } = await api.post<ApiResponse<any>>("/api/leaves/adjustments/", payload);
  return data;
}


// --- CEO Endpoints ---

/**
 * Get all leave requests pending CEO approval
 */
export async function getCEOLeaveRequests(
  params?: { page?: number; page_size?: number; status?: string }
): Promise<ApiResponse<PaginatedResponse<LeaveRequest>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<LeaveRequest>>>(
    "/api/leaves/ceo/leave-requests/",
    { params }
  );
  return data;
}

/**
 * CEO approves a leave request
 */
export async function approveCEOLeaveRequest(
  id: string | number,
  comment?: string
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(
    `/api/leaves/ceo/leave-requests/${id}/approve/`,
    { comment }
  );
  return data;
}

/**
 * CEO rejects a leave request
 */
export async function rejectCEOLeaveRequest(
  id: string | number,
  comment: string
): Promise<ApiResponse<LeaveRequest>> {
  const { data } = await api.post<ApiResponse<LeaveRequest>>(
    `/api/leaves/ceo/leave-requests/${id}/reject/`,
    { comment }
  );
  return data;
}
