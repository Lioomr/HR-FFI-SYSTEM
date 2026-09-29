import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type PenaltyStatus =
  | "pending_hr_mark"
  | "issued"
  | "disputed"
  | "upheld"
  | "waived"
  | "applied";
export type PenaltyPayrollStatus =
  | "pending_review"
  | "approved"
  | "held"
  | "claimed"
  | "applied"
  | "void";
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
  occurrence_number: number;
  count_period: string;
  action: PenaltyAction;
  amount: string | null;
  extra_wage_amount?: string | null;
  total_deduction_amount?: string | null;
  status: PenaltyStatus;
  source: string;
  attendance_result_id?: number | null;
  attendance_record_id?: number | null;
  description: string;
  description_en: string;
  description_ar: string;
  note: string;
  employee_response?: PenaltyResponse | null;
  dispute_reason?: string | null;
  resolution?: {
    decision: "waive" | "uphold" | "disrupted" | "not_disrupted" | "excused";
    reason?: string;
    note?: string;
    resolved_at?: string;
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
  page?: number;
  page_size?: number;
};

const base = "/api/penalties/";

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
    disruption: "disrupted" | "not_disrupted" | "excused";
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
    decision: "uphold" | "waive";
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
