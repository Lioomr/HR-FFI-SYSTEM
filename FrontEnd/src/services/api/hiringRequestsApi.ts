import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/** Lifecycle of a hiring request, from HR draft to a converted job offer. */
export type HiringRequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "converted";

/** Actor recorded on a workflow snapshot or one of its history entries. */
export type WorkflowActor = {
  id: number | null;
  email: string | null;
  full_name: string | null;
};

export type WorkflowHistoryEntry = {
  id: number;
  action: string;
  stage: string | null;
  approver_role: string | null;
  actor: WorkflowActor | null;
  at: string;
  note: string;
  from_status: string | null;
  to_status: string | null;
  from_stage: string | null;
  to_stage: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Server-computed permissions for the signed-in user.
 *
 * These are the authority on which actions to render. Deriving visibility from
 * the role instead would drift from the backend, which also weighs company
 * scope, workflow stage and whether the user is the assigned approver.
 */
export type HiringRequestWorkflow = {
  /** Workflow-engine status, which is not the same vocabulary as the request status. */
  status: string;
  current_stage: string | null;
  current_actor: WorkflowActor | null;
  current_approver_role: string | null;
  can_approve: boolean;
  can_reject: boolean;
  can_cancel: boolean;
  can_edit: boolean;
  can_submit: boolean;
  history: WorkflowHistoryEntry[];
};

export type HiringRequest = {
  id: number;
  company_id: number;
  company_name: string;
  reference_number: string;
  candidate_full_name: string;
  candidate_email: string;
  candidate_phone_number: string;
  nationality: string;
  date_of_birth: string | null;
  proposed_salary: string;
  has_cv: boolean;
  cv_download_url: string | null;
  status: HiringRequestStatus;
  status_label: string;
  requested_by_id: number | null;
  requested_by_name: string | null;
  submitted_at: string | null;
  ceo_decision_by_id: number | null;
  ceo_decision_by_name: string | null;
  ceo_decision_at: string | null;
  ceo_decision_note: string;
  job_offer_id: number | null;
  workflow: HiringRequestWorkflow;
  created_at: string;
  updated_at: string;
};

export type HiringRequestListResponse = PaginatedResponse<HiringRequest>;

export type HiringRequestListParams = {
  page?: number;
  page_size?: number;
  status?: HiringRequestStatus | "";
  search?: string;
};

/**
 * The only fields HR may write. Company, reference number, status, requester
 * and decision fields are all server-owned; sending them would be ignored at
 * best and misleading to read in this file at worst.
 */
export type HiringRequestPayload = {
  candidate_full_name?: string;
  candidate_email?: string;
  candidate_phone_number?: string;
  nationality?: string;
  date_of_birth?: string;
  proposed_salary?: string | number;
  cv_file?: File | null;
};

/** One CEO notification attempt recorded when a request is submitted. */
export type HiringRequestNotification = {
  user_id?: number;
  display_name?: string;
  channel?: string;
  sent?: boolean;
  skipped?: boolean;
  error?: string | null;
};

export type HiringRequestSubmitResult = {
  hiring_request: HiringRequest;
  notifications: HiringRequestNotification[];
};

export type HiringRequestDecisionPayload = {
  note?: string;
};

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

/** Client-side ceiling mirroring the backend's 5 MB cap, so the file is rejected before upload. */
export const MAX_CV_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_CV_EXTENSIONS = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];

/** `accept` attribute for the picker; the backend re-checks extension, MIME and signature. */
export const CV_ACCEPT = ALLOWED_CV_EXTENSIONS.join(",");

function toFormData(payload: HiringRequestPayload): FormData {
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (value instanceof File) form.append(key, value);
    else form.append(key, String(value));
  });
  return form;
}

/** True when the payload carries a file and therefore has to go up as multipart. */
function hasFile(payload: HiringRequestPayload): boolean {
  return payload.cv_file instanceof File;
}

export async function listHiringRequests(params: HiringRequestListParams = {}) {
  const { data } = await api.get<ApiResponse<HiringRequestListResponse>>("/hiring-requests/", { params });
  return data;
}

export async function createHiringRequest(payload: HiringRequestPayload) {
  const { data } = await api.post<ApiResponse<HiringRequest>>(
    "/hiring-requests/",
    toFormData(payload),
    MULTIPART,
  );
  return data;
}

export async function getHiringRequest(id: number | string) {
  const { data } = await api.get<ApiResponse<HiringRequest>>(`/hiring-requests/${id}/`);
  return data;
}

/**
 * Sends multipart only when a new CV is attached; a plain JSON PATCH otherwise,
 * so editing a text field cannot blank the stored file.
 */
export async function updateHiringRequest(id: number | string, payload: HiringRequestPayload) {
  if (hasFile(payload)) {
    const { data } = await api.patch<ApiResponse<HiringRequest>>(
      `/hiring-requests/${id}/`,
      toFormData(payload),
      MULTIPART,
    );
    return data;
  }
  const rest: HiringRequestPayload = { ...payload };
  delete rest.cv_file;
  const { data } = await api.patch<ApiResponse<HiringRequest>>(`/hiring-requests/${id}/`, rest);
  return data;
}

export async function submitHiringRequest(id: number | string) {
  const { data } = await api.post<ApiResponse<HiringRequestSubmitResult>>(
    `/hiring-requests/${id}/submit/`,
    {},
  );
  return data;
}

export async function cancelHiringRequest(id: number | string) {
  const { data } = await api.post<ApiResponse<HiringRequest>>(`/hiring-requests/${id}/cancel/`, {});
  return data;
}

export async function approveHiringRequest(id: number | string, payload: HiringRequestDecisionPayload = {}) {
  const { data } = await api.post<ApiResponse<HiringRequest>>(`/hiring-requests/${id}/approve/`, {
    note: payload.note || "",
  });
  return data;
}

export async function rejectHiringRequest(id: number | string, payload: HiringRequestDecisionPayload) {
  const { data } = await api.post<ApiResponse<HiringRequest>>(`/hiring-requests/${id}/reject/`, {
    note: payload.note || "",
  });
  return data;
}

/**
 * Fetched as a blob through the same-origin path rather than following
 * `cv_download_url`: that URL is absolute to the backend host, which the
 * browser reaches only through this app's proxy and without the bearer token.
 */
export async function downloadHiringRequestCv(id: number | string): Promise<Blob> {
  const response = await api.get(`/hiring-requests/${id}/cv/`, { responseType: "blob" });
  return response.data;
}
