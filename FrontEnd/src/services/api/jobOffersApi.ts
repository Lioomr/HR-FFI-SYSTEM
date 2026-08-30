import { api } from "./apiClient";
import type {
  ApiResponse,
  LastDeliveryStatus,
  PaginatedResponse,
} from "./apiTypes";

/** Lifecycle states the backend reports for a job offer. */
export type JobOfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

/**
 * The CEO approval track, which is independent of the delivery lifecycle above.
 *
 * An offer is written as `draft`, goes to the CEO as `pending_ceo`, and only an
 * `approved` offer may be sent to the candidate.
 */
export type JobOfferApprovalStatus =
  | "draft"
  | "pending_ceo"
  | "approved"
  | "changes_requested"
  | "rejected";

/** Actor recorded on a workflow snapshot or one of its history entries. */
export type JobOfferWorkflowActor = {
  id: number | null;
  email: string | null;
  full_name: string | null;
};

export type JobOfferWorkflowHistoryEntry = {
  id: number;
  action: string;
  stage: string | null;
  approver_role: string | null;
  actor: JobOfferWorkflowActor | null;
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
 * the role or the status instead would drift from the backend, which also
 * weighs company scope, workflow stage, the CV, expiry and whether the user is
 * the assigned approver.
 */
export type JobOfferWorkflow = {
  /** Workflow-engine status, which is not the same vocabulary as `approval_status`. */
  status: string;
  current_stage: string | null;
  current_actor: JobOfferWorkflowActor | null;
  current_approver_role: string | null;
  can_approve: boolean;
  can_reject: boolean;
  can_request_changes: boolean;
  can_cancel: boolean;
  can_edit: boolean;
  can_submit: boolean;
  can_send: boolean;
  history: JobOfferWorkflowHistoryEntry[];
};

/**
 * Whether the offer's employee profile is wired to a BioTime device record.
 *
 * Never a blocker: an unmapped profile only means HR still has to finish the
 * attendance-device setup, and the backend has already notified them.
 */
export type JobOfferBioTimeStatus = {
  is_mapped: boolean;
  biotime_emp_code: string | null;
  mapping_id: number | null;
};

/**
 * A job offer as returned by the HR and CEO (authenticated) endpoints.
 *
 * The single-use response token itself is never exposed here — the backend only
 * reports whether one exists via `has_response_token`. The token lives in the
 * candidate's delivery message and in the public URL, nowhere in staff screens.
 * The CV is likewise write-only: `has_cv` says whether one is stored and the
 * bytes come from `GET /job-offers/{id}/cv/`.
 */
export type JobOffer = {
  id: number;
  company_id: number;
  company_name?: string;
  employee_profile_id?: number | null;
  account_invite_id?: number | null;

  candidate_full_name: string;
  candidate_email: string;
  candidate_phone_number: string;
  nationality: string;
  date_of_birth: string | null;
  id_passport_iqama_number: string;
  has_cv: boolean;
  cv_download_url: string | null;

  department_id: number | null;
  position_id: number | null;
  position_title: string;
  classification: string;
  department: string;
  location: string;

  basic_salary: string;
  housing_allowance: string;
  transportation_allowance: string;
  other_allowance: string;
  total_salary_package: string;

  vacation: string;
  tickets: string;
  contract_status: string;
  contract_type: string;
  contract_duration: string;
  medical_insurance: string;

  offer_date: string;
  expiry_date: string;
  reference_number: string;
  hr_signer_user_id: number;
  hr_signer_name: string;
  hr_signer_title: string;

  status: JobOfferStatus;
  status_label: string;
  approval_status: JobOfferApprovalStatus;
  approval_status_label: string;
  submitted_at: string | null;
  ceo_decision_by_id: number | null;
  ceo_decision_by_name: string | null;
  ceo_decision_at: string | null;
  ceo_decision_reason: string;
  ceo_recommendation: string;
  workflow: JobOfferWorkflow;

  has_response_token: boolean;
  biotime: JobOfferBioTimeStatus;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  rejection_reason: string;
  delivery_metadata: JobOfferDeliveryMetadata | null;

  created_by_id?: number;
  updated_by_id?: number;
  created_at: string;
  updated_at: string;
};

/** Per-channel delivery outcome recorded when the offer was sent. */
export type JobOfferChannelDelivery = LastDeliveryStatus & {
  /** Set when the channel was never attempted, e.g. no phone number on file. */
  skipped?: boolean;
  /** Email only: whether the offer PDF rode along or the link was used alone. */
  attachment?: "attached" | "link_only";
};

/** Every PDF copy sent to one CEO recipient when the offer went out. */
export type JobOfferCeoRecipientDelivery = {
  user_id: number;
  display_name: string;
  whatsapp_pdf: JobOfferChannelDelivery;
  email_pdf: JobOfferChannelDelivery;
};

/** Warnings grouped by the leg of delivery that produced them. */
export type JobOfferWarningDetails = {
  candidate_text?: string[];
  candidate_whatsapp_pdf?: string[];
  candidate_email_pdf?: string[];
  ceo_whatsapp_pdf?: string[];
  ceo_email_pdf?: string[];
};

export type JobOfferDeliveryMetadata = {
  /**
   * Kept by the backend for offers sent before delivery was split per leg:
   * `whatsapp` is the candidate text and `email` the candidate email PDF.
   */
  channels: {
    whatsapp?: JobOfferChannelDelivery;
    email?: JobOfferChannelDelivery;
  };
  candidate?: {
    text: JobOfferChannelDelivery;
    whatsapp_pdf: JobOfferChannelDelivery;
    email_pdf: JobOfferChannelDelivery;
  };
  ceo?: { recipients: JobOfferCeoRecipientDelivery[] };
  warning_details?: JobOfferWarningDetails;
  warnings: string[];
};

/** Response body of POST /job-offers/{id}/send/. */
export type JobOfferDeliveryResult = {
  offer: JobOffer;
  delivery: JobOfferDeliveryMetadata;
};

/** One CEO notification attempt recorded when an offer is submitted. */
export type JobOfferNotification = {
  user_id?: number;
  display_name?: string;
  channel?: string;
  sent?: boolean;
  skipped?: boolean;
  error?: string | null;
};

/** Response body of POST /job-offers/{id}/submit/. */
export type JobOfferSubmitResult = {
  job_offer: JobOffer;
  notifications: JobOfferNotification[];
};

export type JobOfferListResponse = PaginatedResponse<JobOffer>;

export type JobOfferListParams = {
  page?: number;
  page_size?: number;
  status?: JobOfferStatus | "";
  approval_status?: JobOfferApprovalStatus | "";
  search?: string;
};

/**
 * Writable fields. The backend derives the reference number, signer, both
 * status tracks, the timestamps, the CEO decision and the delivery data, so
 * none of those appear here.
 */
export type JobOfferPayload = Partial<{
  candidate_full_name: string;
  candidate_email: string;
  candidate_phone_number: string;
  nationality: string;
  date_of_birth: string;
  id_passport_iqama_number: string;
  /** Required on create; write-only, and read back through `has_cv`. */
  cv_file: File | null;
  /** Required on create: the backend derives the display text from the record. */
  department_id: number;
  position_id: number;
  position_title: string;
  classification: string;
  department: string;
  location: string;
  basic_salary: string | number;
  housing_allowance: string | number;
  transportation_allowance: string | number;
  other_allowance: string | number;
  total_salary_package: string | number;
  vacation: string;
  tickets: string;
  contract_status: string;
  contract_type: string;
  contract_duration: string;
  medical_insurance: string;
  offer_date: string;
  expiry_date: string;
}>;

/** CEO approval body; the recommendation is optional free text for HR. */
export type JobOfferApprovalPayload = {
  recommendation?: string;
};

/** CEO request-changes and rejection body; the reason is mandatory. */
export type JobOfferRevisionPayload = {
  reason: string;
  recommendation?: string;
};

/** The candidate-facing view: no identifiers, no token, no internal metadata. */
export type PublicJobOfferSummary = {
  candidate_full_name: string;
  position_title: string;
  department: string;
  location: string;
  total_salary_package: string;
  offer_date: string;
  expiry_date: string;
  status: JobOfferStatus;
  status_label: string;
  can_respond: boolean;
};

export type JobOfferDecision = "accepted" | "rejected";

export type JobOfferDecisionPayload = {
  token: string;
  decision: JobOfferDecision;
  reason?: string;
};

/** Invitation summary returned after a candidate accepts. */
export type JobOfferInvitationResult = {
  created: boolean;
  reason?: string;
  channel?: string;
  delivery?: LastDeliveryStatus;
};

export type JobOfferDecisionResult = {
  status: JobOfferStatus;
  status_label: string;
  /** Only on an acceptance: the pre-hire profile the backend prepared. */
  employee_profile_id?: number | null;
  invitation?: JobOfferInvitationResult;
  biotime?: JobOfferBioTimeStatus;
};

const MULTIPART = { headers: { "Content-Type": "multipart/form-data" } };

/** Client-side ceiling mirroring the backend 5 MB cap, so a bad file is rejected before upload. */
export const MAX_CV_SIZE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_CV_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
];

/** `accept` attribute for the picker; the backend re-checks extension, MIME and signature. */
export const CV_ACCEPT = ALLOWED_CV_EXTENSIONS.join(",");

function toFormData(payload: JobOfferPayload): FormData {
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (value instanceof File) form.append(key, value);
    else form.append(key, String(value));
  });
  return form;
}

/** True when the payload carries a file and therefore has to go up as multipart. */
function hasFile(payload: JobOfferPayload): boolean {
  return payload.cv_file instanceof File;
}

export async function listJobOffers(params: JobOfferListParams = {}) {
  const { data } = await api.get<ApiResponse<JobOfferListResponse>>(
    "/job-offers/",
    {
      params,
      // A deployment before the Job Offers proxy existed could leave the SPA
      // shell cached under this API URL. Force revalidation so Retry recovers
      // immediately instead of accepting that stale HTML response.
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    },
  );
  return data;
}

/** Always multipart: the backend requires a CV on every new offer. */
export async function createJobOffer(payload: JobOfferPayload) {
  const { data } = await api.post<ApiResponse<JobOffer>>(
    "/job-offers/",
    toFormData(payload),
    MULTIPART,
  );
  return data;
}

export async function getJobOffer(id: number | string) {
  const { data } = await api.get<ApiResponse<JobOffer>>(`/job-offers/${id}/`);
  return data;
}

/**
 * Sends multipart only when a new CV is attached; a plain JSON PATCH otherwise,
 * so editing a text field cannot blank the stored file.
 */
export async function updateJobOffer(
  id: number | string,
  payload: JobOfferPayload,
) {
  if (hasFile(payload)) {
    const { data } = await api.patch<ApiResponse<JobOffer>>(
      `/job-offers/${id}/`,
      toFormData(payload),
      MULTIPART,
    );
    return data;
  }
  const rest: JobOfferPayload = { ...payload };
  delete rest.cv_file;
  const { data } = await api.patch<ApiResponse<JobOffer>>(
    `/job-offers/${id}/`,
    rest,
  );
  return data;
}

/** HR sends the offer to the CEO; also the resubmit path after changes. */
export async function submitJobOffer(id: number | string) {
  const { data } = await api.post<ApiResponse<JobOfferSubmitResult>>(
    `/job-offers/${id}/submit/`,
    {},
  );
  return data;
}

export async function approveJobOffer(
  id: number | string,
  payload: JobOfferApprovalPayload = {},
) {
  const { data } = await api.post<ApiResponse<JobOffer>>(
    `/job-offers/${id}/approve/`,
    { recommendation: payload.recommendation || "" },
  );
  return data;
}

export async function requestJobOfferChanges(
  id: number | string,
  payload: JobOfferRevisionPayload,
) {
  const { data } = await api.post<ApiResponse<JobOffer>>(
    `/job-offers/${id}/request-changes/`,
    { reason: payload.reason, recommendation: payload.recommendation || "" },
  );
  return data;
}

export async function rejectJobOffer(
  id: number | string,
  payload: JobOfferRevisionPayload,
) {
  const { data } = await api.post<ApiResponse<JobOffer>>(
    `/job-offers/${id}/reject/`,
    { reason: payload.reason, recommendation: payload.recommendation || "" },
  );
  return data;
}

/**
 * Fetched as a blob through the same-origin path rather than following
 * `cv_download_url`: that URL is absolute to the backend host, which the
 * browser reaches only through this app proxy and without the bearer token.
 */
export async function downloadJobOfferCv(id: number | string): Promise<Blob> {
  const response = await api.get(`/job-offers/${id}/cv/`, {
    responseType: "blob",
  });
  return response.data;
}

export async function sendJobOffer(id: number | string) {
  const { data } = await api.post<ApiResponse<JobOfferDeliveryResult>>(
    `/job-offers/${id}/send/`,
    {},
  );
  return data;
}

export async function downloadJobOfferPdf(id: number | string): Promise<Blob> {
  const response = await api.get(`/job-offers/${id}/pdf/`, {
    responseType: "blob",
  });
  return response.data;
}

export async function cancelJobOffer(id: number | string) {
  const { data } = await api.post<ApiResponse<JobOffer>>(
    `/job-offers/${id}/cancel/`,
    {},
  );
  return data;
}

/**
 * Public endpoints — no auth. The token comes from the candidate link and is
 * passed straight through; it is never persisted or surfaced in HR screens.
 */
export async function getPublicJobOffer(token: string) {
  const { data } = await api.get<ApiResponse<PublicJobOfferSummary>>(
    "/job-offers/respond/",
    {
      params: { token },
    },
  );
  return data;
}

export async function respondToJobOffer(payload: JobOfferDecisionPayload) {
  const { data } = await api.post<ApiResponse<JobOfferDecisionResult>>(
    "/job-offers/respond/",
    payload,
  );
  return data;
}
