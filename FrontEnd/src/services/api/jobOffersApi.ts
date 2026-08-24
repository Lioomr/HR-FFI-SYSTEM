import { api } from "./apiClient";
import type {
  ApiResponse,
  LastDeliveryStatus,
  PaginatedResponse,
} from "./apiTypes";
import type { HiringRequestStatus } from "./hiringRequestsApi";

/** Lifecycle states the backend reports for a job offer. */
export type JobOfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

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
 * A job offer as returned by the HR (authenticated) endpoints.
 *
 * The single-use response token itself is never exposed here — the backend only
 * reports whether one exists via `has_response_token`. The token lives in the
 * candidate's delivery message and in the public URL, nowhere in HR screens.
 */
export type JobOffer = {
  id: number;
  company_id: number;
  company_name?: string;
  employee_profile_id?: number | null;
  account_invite_id?: number | null;
  /** Null on offers created before hiring requests existed; those stay fully usable. */
  hiring_request_id?: number | null;
  hiring_request_reference?: string | null;
  hiring_request_status?: HiringRequestStatus | null;

  candidate_full_name: string;
  candidate_email: string;
  candidate_phone_number: string;
  nationality: string;
  id_passport_iqama_number: string;

  /** Set on hiring-request offers; null on legacy ones written as free text. */
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

export type JobOfferListResponse = PaginatedResponse<JobOffer>;

export type JobOfferListParams = {
  page?: number;
  page_size?: number;
  status?: JobOfferStatus | "";
  search?: string;
};

/** Writable fields; the backend also derives the reference, signer, status, timestamps and delivery data. */
export type JobOfferPayload = Partial<{
  /** Required when creating: the backend only converts an approved request. */
  hiring_request_id: number;
  employee_profile_id: number | null;
  candidate_full_name: string;
  candidate_email: string;
  candidate_phone_number: string;
  nationality: string;
  id_passport_iqama_number: string;
  /** Required for hiring-request offers; the backend derives the display text. */
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

export async function createJobOffer(payload: JobOfferPayload) {
  const { data } = await api.post<ApiResponse<JobOffer>>(
    "/job-offers/",
    payload,
  );
  return data;
}

export async function getJobOffer(id: number | string) {
  const { data } = await api.get<ApiResponse<JobOffer>>(`/job-offers/${id}/`);
  return data;
}

export async function updateJobOffer(
  id: number | string,
  payload: JobOfferPayload,
) {
  const { data } = await api.patch<ApiResponse<JobOffer>>(
    `/job-offers/${id}/`,
    payload,
  );
  return data;
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
 * Public endpoints — no auth. The token comes from the candidate's link and is
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
