import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type PermissionStatus =
  | "pending_manager"
  | "pending_hr"
  | "approved"
  | "rejected"
  | "cancelled";
export type ExitType = "business" | "personal" | "emergency";

export type PermissionActor = { id: number; email: string; full_name: string };
export type PermissionRequest = {
  id: number;
  reference_no: string;
  request_date: string;
  from_time: string;
  to_time: string;
  duration_minutes: number;
  exit_type: ExitType;
  exit_type_label: string;
  exit_type_label_ar: string;
  reason: string;
  status: PermissionStatus;
  status_label: string;
  status_label_ar: string;
  employee: PermissionActor & {
    employee_profile_id: number;
    employee_number?: string | null;
    department?: string | null;
    job_title?: string | null;
  };
  company_id: number;
  company_name: string;
  manager_decision: "approved" | "rejected" | null;
  manager_decision_by: PermissionActor | null;
  manager_decision_at: string | null;
  manager_decision_note: string;
  hr_decision: "approved" | "rejected" | null;
  hr_decision_by: PermissionActor | null;
  hr_decision_at: string | null;
  hr_decision_note: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  direct_manager?: {
    id: number;
    employee_profile_id: number;
    full_name: string;
  } | null;
  workflow: {
    status: string;
    current_stage: string;
    current_approver_role: string;
    current_actor: PermissionActor | null;
    can_approve: boolean;
    can_reject: boolean;
    can_cancel: boolean;
    history: Array<{
      id: number;
      action: string;
      stage: string;
      actor: PermissionActor | null;
      at: string;
      note: string;
      from_status: string;
      to_status: string;
    }>;
  };
};

type Filters = {
  status?: PermissionStatus | "all";
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
};

const base = "/api/permission-requests";
const list = (path: string, params?: Filters) =>
  api
    .get<
      ApiResponse<PaginatedResponse<PermissionRequest>>
    >(`${base}${path}`, { params })
    .then((r) => r.data);

export function getMyPermissionRequests(params?: Filters) {
  return list("/", params);
}
export function getManagerPermissionRequests(params?: Filters) {
  return list("/manager/", params);
}
export function getHrPermissionRequests(params?: Filters) {
  return list("/hr/", params);
}
export function getPermissionRequest(id: number | string) {
  return api
    .get<ApiResponse<PermissionRequest>>(`${base}/${id}/`)
    .then((r) => r.data);
}
export function createPermissionRequest(payload: {
  request_date: string;
  from_time: string;
  to_time: string;
  exit_type: ExitType;
  reason: string;
  duration_minutes?: number;
}) {
  return api
    .post<ApiResponse<PermissionRequest>>(`${base}/`, payload)
    .then((r) => r.data);
}
export function cancelPermissionRequest(id: number | string) {
  return api
    .post<ApiResponse<PermissionRequest>>(`${base}/${id}/cancel/`)
    .then((r) => r.data);
}
export function decidePermissionRequest(
  id: number | string,
  stage: "manager" | "hr",
  decision: "approve" | "reject",
  comment = "",
) {
  return api
    .post<
      ApiResponse<PermissionRequest>
    >(`${base}/${id}/${stage}-${decision}/`, { comment })
    .then((r) => r.data);
}
export async function downloadPermissionRequestPdf(
  id: number | string,
): Promise<Blob> {
  const response = await api.get(`${base}/${id}/pdf/`, {
    responseType: "blob",
  });
  return response.data;
}
