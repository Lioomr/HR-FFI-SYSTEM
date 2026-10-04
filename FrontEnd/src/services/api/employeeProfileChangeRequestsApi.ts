import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import type { WorkflowSnapshot } from "../../types/workflow";

/**
 * Employee "update my details" requests. One request carries several field
 * changes; HR approves or rejects each field. Nothing reaches the profile
 * until HR decides. The field whitelist, ownership, company scope and file
 * validation are enforced server-side; the checks here are fast feedback only.
 */
export type ProfileChangeField =
  | "full_name"
  | "date_of_birth"
  | "nationality"
  | "email"
  | "mobile"
  | "passport_no"
  | "passport_issue_date"
  | "passport_expiry"
  | "national_id"
  | "id_expiry"
  | "passport_file"
  | "national_id_file";

export type ProfileChangeStatus =
  | "PENDING_HR"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "REJECTED"
  | "CANCELLED";

export type ProfileChangeDocumentType = "PASSPORT" | "SAUDI_ID";
export type ProfileChangeItemDecision = "pending" | "approved" | "rejected";

export type ProfileChangeItem = {
  field: ProfileChangeField;
  label_key?: string;
  old: string | null;
  new: string;
  source: "manual" | "ocr";
  decision: ProfileChangeItemDecision;
  note: string;
};

export type ProfileChangeRequestAttachment = {
  id: number;
  document_type: ProfileChangeDocumentType;
  original_filename: string;
  field: "passport_file" | "national_id_file";
};

export type ProfileChangeRequest = {
  id: number;
  employee: { id: number; full_name: string; employee_number: string | null };
  status: ProfileChangeStatus;
  items: ProfileChangeItem[];
  attachments: ProfileChangeRequestAttachment[];
  decision_note: string | null;
  submitted_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  workflow?: WorkflowSnapshot;
  can_act: boolean;
};

/** Upload / poll shape of a document attached before submitting. */
export type ProfileChangeAttachment = {
  id: number;
  document_type: ProfileChangeDocumentType;
  original_filename: string;
  extraction_status: string;
  suggested: Partial<Record<ProfileChangeField, string>>;
  warnings: string[];
  confidence: number | null;
};

export type ProfileChangeSubmitPayload = {
  items: Partial<Record<ProfileChangeField, string>>;
  attachment_ids: number[];
};

export type ProfileChangeDecision = {
  field: ProfileChangeField;
  decision: "approve" | "reject";
  note?: string;
};

type ListParams = {
  status?: ProfileChangeStatus;
  page?: number;
  page_size?: number;
};

const ME_BASE = "/api/employees/me/profile-change-requests/";
const HR_BASE = "/api/employees/profile-change-requests/";

/** Personal fields first, then documents: the order used in every list. */
export const PROFILE_CHANGE_FIELDS: ProfileChangeField[] = [
  "full_name",
  "date_of_birth",
  "nationality",
  "email",
  "mobile",
  "passport_no",
  "passport_issue_date",
  "passport_expiry",
  "passport_file",
  "national_id",
  "id_expiry",
  "national_id_file",
];

export const PROFILE_CHANGE_DATE_FIELDS: ProfileChangeField[] = [
  "date_of_birth",
  "passport_issue_date",
  "passport_expiry",
  "id_expiry",
];

export const profileChangeFieldLabelKey = (field: string) =>
  `profileChange.field.${field}`;

/** Extraction states after which polling stops. */
const TERMINAL_EXTRACTION_STATUSES = [
  "success",
  "partial",
  "failed",
  "not_applicable",
];

export const isExtractionTerminal = (status: string | null | undefined) =>
  TERMINAL_EXTRACTION_STATUSES.includes((status || "").toLowerCase());

/** Mirrors the backend employee-document rules (pdf/jpg/jpeg/png, 5 MB). */
export const PROFILE_CHANGE_MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = PROFILE_CHANGE_MAX_SIZE_MB * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];
export const PROFILE_CHANGE_ACCEPT = [
  ...ALLOWED_EXTENSIONS,
  "application/pdf",
  "image/jpeg",
  "image/png",
].join(",");

export type ProfileChangeFileRejection = "type" | "size" | "empty";

export function validateProfileChangeFile(
  file: File,
): ProfileChangeFileRejection | null {
  const name = file.name || "";
  const dot = name.lastIndexOf(".");
  const extension = dot === -1 ? "" : name.slice(dot).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) return "type";
  if (!file.size) return "empty";
  if (file.size > MAX_SIZE_BYTES) return "size";
  return null;
}

export function uploadProfileChangeAttachment(
  documentType: ProfileChangeDocumentType,
  file: File,
) {
  const form = new FormData();
  form.append("document_type", documentType);
  form.append("file", file, file.name);
  // apiClient defaults to JSON; naming multipart lets the browser add the boundary.
  return api
    .post<ApiResponse<ProfileChangeAttachment>>(
      `${ME_BASE}attachments/`,
      form,
      {
        headers: { "Content-Type": "multipart/form-data" },
      },
    )
    .then((r) => r.data);
}

export function getProfileChangeAttachment(id: number) {
  return api
    .get<ApiResponse<ProfileChangeAttachment>>(`${ME_BASE}attachments/${id}/`)
    .then((r) => r.data);
}

export function submitProfileChangeRequest(
  payload: ProfileChangeSubmitPayload,
) {
  return api
    .post<ApiResponse<ProfileChangeRequest>>(ME_BASE, payload)
    .then((r) => r.data);
}

export function getMyProfileChangeRequests(params?: ListParams) {
  return api
    .get<
      ApiResponse<PaginatedResponse<ProfileChangeRequest>>
    >(ME_BASE, { params })
    .then((r) => r.data);
}

export function cancelProfileChangeRequest(id: number) {
  return api
    .post<ApiResponse<ProfileChangeRequest>>(`${ME_BASE}${id}/cancel/`)
    .then((r) => r.data);
}

/** Authenticated blob; `scope` picks the owner or the HR route. */
export async function getProfileChangeAttachmentFile(
  requestId: number,
  attachmentId: number,
  scope: "me" | "hr",
): Promise<Blob> {
  const base = scope === "me" ? ME_BASE : HR_BASE;
  const { data } = await api.get<Blob>(
    `${base}${requestId}/attachments/${attachmentId}/file/`,
    { responseType: "blob" },
  );
  return data;
}

export function getHrProfileChangeRequests(params?: ListParams) {
  return api
    .get<
      ApiResponse<PaginatedResponse<ProfileChangeRequest>>
    >(HR_BASE, { params })
    .then((r) => r.data);
}

export function getHrProfileChangeRequest(id: number) {
  return api
    .get<ApiResponse<ProfileChangeRequest>>(`${HR_BASE}${id}/`)
    .then((r) => r.data);
}

export function decideProfileChangeRequest(
  id: number,
  decisions: ProfileChangeDecision[],
) {
  return api
    .post<
      ApiResponse<ProfileChangeRequest>
    >(`${HR_BASE}${id}/decide/`, { decisions })
    .then((r) => r.data);
}
