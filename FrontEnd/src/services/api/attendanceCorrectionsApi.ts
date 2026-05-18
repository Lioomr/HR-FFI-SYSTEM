import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type AttendanceCorrectionStatus =
  | "draft"
  | "pending_manager"
  | "pending_hr"
  | "approved"
  | "rejected"
  | "cancelled";

export type AttendanceRecordStatus = "PRESENT" | "ABSENT" | "LATE" | "REJECTED";

export type AttendanceCorrectionWorkflowActor = {
  id: number;
  email: string;
  full_name: string;
};

export type AttendanceCorrectionWorkflowHistoryEntry = {
  id: number;
  action: string;
  stage: string;
  approver_role: string;
  actor: AttendanceCorrectionWorkflowActor | null;
  at: string;
  note: string;
  from_status: string;
  to_status: string;
  from_stage: string;
  to_stage: string;
  metadata: Record<string, unknown>;
};

export type AttendanceCorrectionWorkflow = {
  status: string;
  current_stage: string;
  current_actor: AttendanceCorrectionWorkflowActor | null;
  current_approver_role: string;
  can_approve: boolean;
  can_reject: boolean;
  can_cancel: boolean;
  history: AttendanceCorrectionWorkflowHistoryEntry[];
};

export type AttendanceCorrectionRequest = {
  id: number;
  employee_profile: number;
  employee_name: string;
  employee_email: string;
  attendance_record: number | null;
  date: string;

  current_check_in_at: string | null;
  current_check_out_at: string | null;
  current_status: string | null;

  requested_check_in_at: string | null;
  requested_check_out_at: string | null;
  requested_status: AttendanceRecordStatus | "";

  reason: string;
  status: AttendanceCorrectionStatus;

  manager_decision_at: string | null;
  manager_decision_by: number | null;
  manager_decision_note: string;

  hr_decision_at: string | null;
  hr_decision_by: number | null;
  hr_decision_note: string;

  submitted_at: string | null;
  decided_at: string | null;
  cancelled_at: string | null;

  workflow: AttendanceCorrectionWorkflow;

  created_at: string;
  updated_at: string;
};

export type AttendanceCorrectionListResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: AttendanceCorrectionRequest[];
};

export type ListAttendanceCorrectionsParams = {
  status?: AttendanceCorrectionStatus;
  date_from?: string;
  date_to?: string;
  employee_profile?: number | string;
  search?: string;
  page?: number;
  page_size?: number;
};

export type CreateAttendanceCorrectionPayload = {
  attendance_record?: number | null;
  date: string;
  requested_check_in_at?: string | null;
  requested_check_out_at?: string | null;
  requested_status?: AttendanceRecordStatus | "";
  reason: string;
  employee_profile?: number;
};

export type UpdateAttendanceCorrectionPayload = Partial<CreateAttendanceCorrectionPayload>;

export type AttendanceCorrectionDecisionPayload = {
  notes?: string;
  comment?: string;
};

const BASE_URL = "/api/attendance-correction-requests/";

export async function listAttendanceCorrectionRequests(
  params?: ListAttendanceCorrectionsParams
): Promise<ApiResponse<AttendanceCorrectionListResponse>> {
  const { data } = await api.get<ApiResponse<AttendanceCorrectionListResponse>>(BASE_URL, { params });
  return data;
}

export async function getAttendanceCorrectionRequest(
  id: number | string
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.get<ApiResponse<AttendanceCorrectionRequest>>(`${BASE_URL}${id}/`);
  return data;
}

export async function createAttendanceCorrectionRequest(
  payload: CreateAttendanceCorrectionPayload
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.post<ApiResponse<AttendanceCorrectionRequest>>(BASE_URL, payload);
  return data;
}

export async function updateAttendanceCorrectionRequest(
  id: number | string,
  payload: UpdateAttendanceCorrectionPayload
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.patch<ApiResponse<AttendanceCorrectionRequest>>(`${BASE_URL}${id}/`, payload);
  return data;
}

export async function submitAttendanceCorrectionRequest(
  id: number | string
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.post<ApiResponse<AttendanceCorrectionRequest>>(`${BASE_URL}${id}/submit/`);
  return data;
}

export async function approveAttendanceCorrectionRequest(
  id: number | string,
  payload?: AttendanceCorrectionDecisionPayload
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.post<ApiResponse<AttendanceCorrectionRequest>>(
    `${BASE_URL}${id}/approve/`,
    payload || {}
  );
  return data;
}

export async function rejectAttendanceCorrectionRequest(
  id: number | string,
  payload: AttendanceCorrectionDecisionPayload
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.post<ApiResponse<AttendanceCorrectionRequest>>(
    `${BASE_URL}${id}/reject/`,
    payload
  );
  return data;
}

export async function cancelAttendanceCorrectionRequest(
  id: number | string
): Promise<ApiResponse<AttendanceCorrectionRequest>> {
  const { data } = await api.post<ApiResponse<AttendanceCorrectionRequest>>(`${BASE_URL}${id}/cancel/`);
  return data;
}
