import { downloadBlob } from "../../utils/download";
import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type PenaltyStatus =
  | "pending_hr_mark"
  | "issued"
  | "disputed"
  | "waived"
  | "applied";
export type PenaltyPayrollStatus =
  | "pending_review"
  | "approved"
  | "held"
  | "claimed"
  | "applied"
  | "void";
export type PenaltyMarkDecision =
  | "disrupted"
  | "not_disrupted"
  | "confirmed"
  | "excused";
export type PenaltyAction = "warning" | "deduction" | string;
export type PenaltyCatalogLevel = {
  occurrence: number;
  action: PenaltyAction;
  amount_basis: string | null;
  amount_value: string | null;
};
export type PenaltyCatalogItem = {
  code: string;
  category: string;
  title_en: string;
  title_ar: string;
  description_en: string;
  description_ar: string;
  count_period: string;
  levels: PenaltyCatalogLevel[];
  automatic: boolean;
  source_page?: number;
  source_row?: number;
  extra_wage_deduction?: string;
  /** Automatic warnings that precede the printed levels (company policy). */
  auto_warning_extra_levels?: number;
};
export type PenaltyAutomation = "" | "warning_pending" | "warning_issued";
export type PenaltyWarningNotice = {
  id: number;
  reference_number: string;
  delivery_status: string;
  issued_at: string;
  download_path: string;
};
export type PenaltyResponse = {
  decision: string;
  reason?: string | null;
  submitted_at: string;
};
export type PenaltyRecord = {
  id: number;
  company_id: number;
  employee_profile_id: number;
  employee_name_en: string;
  employee_name_ar: string;
  catalog_code: string;
  category: string;
  occurred_on: string;
  /** Null for employees viewing an automatic warning: the count is never shown. */
  occurrence_number: number | null;
  count_period: string;
  action: PenaltyAction;
  amount: string | null;
  extra_wage_amount?: string | null;
  total_deduction_amount?: string | null;
  status: PenaltyStatus;
  source: string;
  automation?: PenaltyAutomation;
  warning_notice?: PenaltyWarningNotice | null;
  attendance_result_id?: number | null;
  attendance_record_id?: number | null;
  description: string;
  description_en: string;
  description_ar: string;
  note: string;
  employee_response?: PenaltyResponse | null;
  dispute_reason?: string | null;
  resolution?: {
    decision:
      | "waive"
      | "uphold"
      | "manual_review"
      | "reopened"
      | "recurrence_rerated"
      | "auto_warning"
      | PenaltyMarkDecision;
    proposed_evidence?: {
      catalog_code?: string;
      occurred_on?: string;
      evidence?: Record<string, unknown>;
      expected_occurrence?: number;
      absence_dates?: string[];
      released_wage_dates?: string[];
      proposed_wage_absence_dates?: string[];
    };
    reason?: string;
    note?: string;
    resolved_at?: string;
    reopened_at?: string;
  } | null;
  payroll_status?: PenaltyPayrollStatus | null;
  source_page?: number;
  source_row?: number;
  created_at: string;
  updated_at: string;
};

export type PenaltyFilters = {
  mine?: boolean;
  employee_profile_id?: number;
  status?: PenaltyStatus;
  category?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  /** HR: also list automatic warnings, which are hidden from the HR queue by default. */
  include_automated?: boolean;
  page?: number;
  page_size?: number;
};

const base = "/api/penalties/";

/**
 * The warning letter is private: fetched through apiClient (token and active
 * company) and saved from the blob, never linked from storage.
 */
export async function downloadPenaltyWarningNotice(
  record: Pick<PenaltyRecord, "id"> & {
    warning_notice: Pick<PenaltyWarningNotice, "reference_number">;
  },
): Promise<void> {
  const response = await api.get<Blob>(`${base}${record.id}/warning-notice/`, {
    responseType: "blob",
  });
  downloadBlob(
    response.data,
    `penalty_warning_notice_${record.warning_notice.reference_number}.pdf`,
  );
}

export async function getPenaltyCatalog(): Promise<
  ApiResponse<PenaltyCatalogItem[]>
> {
  const { data } = await api.get<ApiResponse<PenaltyCatalogItem[]>>(
    `${base}catalog/`,
  );
  return data;
}

export async function listPenalties(
  params?: PenaltyFilters,
): Promise<ApiResponse<PaginatedResponse<PenaltyRecord>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<PenaltyRecord>>>(
    base,
    { params },
  );
  return data;
}

export async function getPenalty(
  id: number | string,
): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.get<ApiResponse<PenaltyRecord>>(`${base}${id}/`);
  return data;
}

export async function createPenalty(payload: {
  employee_profile_id: number;
  catalog_code: string;
  occurred_on: string;
  note: string;
}): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.post<ApiResponse<PenaltyRecord>>(base, payload);
  return data;
}

export async function markPenaltyDisruption(
  id: number,
  payload: {
    disruption: PenaltyMarkDecision;
    note: string;
  },
): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.post<ApiResponse<PenaltyRecord>>(
    `${base}${id}/mark-disruption/`,
    payload,
  );
  return data;
}

export async function resolvePenalty(
  id: number,
  payload: {
    decision: "uphold" | "waive" | "reopen" | "rerate";
    note: string;
  },
): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.post<ApiResponse<PenaltyRecord>>(
    `${base}${id}/resolve/`,
    payload,
  );
  return data;
}

export async function reviewPenaltyPayroll(
  id: number,
  payload: {
    decision: "approve" | "hold";
    note: string;
  },
): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.post<ApiResponse<PenaltyRecord>>(
    `${base}${id}/payroll-review/`,
    payload,
  );
  return data;
}

export async function acknowledgePenalty(
  id: number,
): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.post<ApiResponse<PenaltyRecord>>(
    `${base}${id}/acknowledge/`,
    {},
  );
  return data;
}

export async function disputePenalty(
  id: number,
  reason: string,
): Promise<ApiResponse<PenaltyRecord>> {
  const { data } = await api.post<ApiResponse<PenaltyRecord>>(
    `${base}${id}/dispute/`,
    { reason },
  );
  return data;
}
