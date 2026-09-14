import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import { downloadBlob } from "../../utils/download";

export type PermissionStatus =
  | "pending_manager"
  | "pending_hr"
  | "approved"
  | "rejected"
  | "cancelled";
export type ExitType = "business" | "personal" | "emergency";
/** A request without `permission_type` is an Exit Permission. */
export type PermissionType = "exit" | "late" | "during_shift";
export const PERMISSION_TYPES: PermissionType[] = [
  "exit",
  "late",
  "during_shift",
];

/** Camera or picker details stored with an evidence file. */
export type CaptureMetadata = {
  source?: string;
  captured_at?: string;
  [key: string]: unknown;
};

export type PermissionAttachment = {
  id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  /**
   * An object. Rows saved before the backend began decoding multipart parts
   * may hold the JSON text instead, so read it through `parseCaptureMetadata`.
   */
  capture_metadata: CaptureMetadata | string | null;
  created_at: string;
  /** Authenticated forced-download route; fetch it through apiClient. */
  download_url: string;
};

export type PermissionActor = { id: number; email: string; full_name: string };
export type PermissionRequest = {
  id: number;
  reference_no: string;
  permission_type: PermissionType;
  request_date: string;
  /** Null for Late Permission, which has no employee-entered times. */
  from_time: string | null;
  to_time: string | null;
  duration_minutes: number;
  /** Empty for Late and During Shift. */
  exit_type: ExitType | "";
  exit_type_label: string;
  exit_type_label_ar: string;
  reason: string;
  status: PermissionStatus;
  status_label: string;
  status_label_ar: string;
  employee: PermissionActor & {
    full_name_ar?: string;
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
  attachments: PermissionAttachment[];
  attachment_count: number;
  /** Final-approved Late Permissions in the request month; null unless Late. */
  monthly_late_permission_usage: number | null;
  monthly_late_permission_limit: number | null;
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

/** The server has no permission_type filter; filter a loaded page client-side. */
type Filters = {
  status?: PermissionStatus | "all";
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
};

type EvidenceFields = {
  /** One multipart `attachments` part per file. */
  attachments?: File[];
  /** Optional, aligned one-to-one with `attachments`. */
  attachment_metadata?: Array<CaptureMetadata | undefined>;
};

export type ExitPermissionPayload = {
  permission_type?: "exit";
  request_date: string;
  from_time: string;
  to_time: string;
  exit_type: ExitType;
  reason: string;
  duration_minutes?: number;
};
export type LatePermissionPayload = EvidenceFields & {
  permission_type: "late";
  request_date: string;
  reason: string;
};
export type DuringShiftPermissionPayload = EvidenceFields & {
  permission_type: "during_shift";
  request_date: string;
  from_time: string;
  to_time: string;
  reason: string;
};
export type CreatePermissionRequestPayload =
  | ExitPermissionPayload
  | LatePermissionPayload
  | DuringShiftPermissionPayload;

const base = "/api/permission-requests";
// apiClient defaults to JSON, and axios would serialize FormData to JSON under
// that header. Naming multipart lets the browser add the boundary itself.
const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

const list = (path: string, params?: Filters) =>
  api
    .get<
      ApiResponse<PaginatedResponse<PermissionRequest>>
    >(`${base}${path}`, { params })
    .then((r) => r.data);

function appendEvidence(
  form: FormData,
  files: File[],
  metadata?: Array<CaptureMetadata | undefined>,
) {
  files.forEach((file) => form.append("attachments", file, file.name));
  // The server requires one metadata entry per file when any is sent.
  if (metadata?.some(Boolean)) {
    files.forEach((_, index) =>
      form.append("attachment_metadata", JSON.stringify(metadata[index] ?? {})),
    );
  }
}

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

/**
 * JSON when there is no evidence (legacy Exit payloads are unchanged),
 * multipart as soon as a file is attached.
 */
export function createPermissionRequest(
  payload: CreatePermissionRequestPayload,
) {
  const {
    attachments = [],
    attachment_metadata,
    ...fields
  } = payload as CreatePermissionRequestPayload & EvidenceFields;
  if (attachments.length === 0) {
    return api
      .post<ApiResponse<PermissionRequest>>(`${base}/`, fields)
      .then((r) => r.data);
  }
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, String(value));
  });
  appendEvidence(form, attachments, attachment_metadata);
  return api
    .post<ApiResponse<PermissionRequest>>(`${base}/`, form, MULTIPART)
    .then((r) => r.data);
}

/** Owner only, while the request is pending. */
export function addPermissionRequestAttachments(
  id: number | string,
  files: File[],
  metadata?: Array<CaptureMetadata | undefined>,
) {
  const form = new FormData();
  appendEvidence(form, files, metadata);
  return api
    .post<
      ApiResponse<PermissionRequest>
    >(`${base}/${id}/attachments/`, form, MULTIPART)
    .then((r) => r.data);
}

/**
 * Fetches evidence through apiClient (bearer token and company header are
 * required) and saves it. Only the server's own relative download route is
 * followed, so credentials are never sent to another origin.
 */
export async function downloadPermissionRequestAttachment(
  id: number | string,
  attachment: Pick<
    PermissionAttachment,
    "id" | "download_url" | "original_filename"
  >,
): Promise<void> {
  const expectedPrefix = `${base}/${id}/attachments/`;
  const url = attachment.download_url?.startsWith(expectedPrefix)
    ? attachment.download_url
    : `${expectedPrefix}${attachment.id}/download/`;
  const response = await api.get<Blob>(url, { responseType: "blob" });
  downloadBlob(
    response.data,
    attachment.original_filename || `permission-evidence-${attachment.id}`,
  );
}

/** Accepts the object or JSON-text encodings of `capture_metadata`. */
export function parseCaptureMetadata(
  value: PermissionAttachment["capture_metadata"] | undefined,
): CaptureMetadata | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as CaptureMetadata)
    : null;
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
