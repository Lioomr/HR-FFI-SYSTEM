import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type RequestObligationStatus = "open" | "resolved" | "waived";
export type RequestObligationType = "asset_return" | "pending_approvals";

export interface RequestObligationSummary {
  total: number;
  open: number;
  resolved: number;
  waived: number;
  blocking_open: number;
  can_final_approve: boolean;
}

export interface RequestObligation {
  id: number;
  type: RequestObligationType;
  type_display: string;
  status: RequestObligationStatus;
  status_display: string;
  severity: "blocking" | "warning";
  title: string;
  description?: string;
  metadata: Record<string, unknown>;
  target?: {
    id: number;
    entity: string;
    label: string;
    name?: string;
  } | null;
  resolved_at?: string | null;
  resolution_note?: string;
  waived_at?: string | null;
  waiver_reason?: string;
}

export interface RequestObligationsResponse {
  items: RequestObligation[];
  summary: RequestObligationSummary;
}

export async function getRequestObligations(params: {
  parent_type: "leave_request";
  parent_id: number | string;
}): Promise<ApiResponse<RequestObligationsResponse>> {
  const { data } = await api.get<ApiResponse<RequestObligationsResponse>>("/api/core/request-obligations/", {
    params,
  });
  return data;
}

export async function waiveRequestObligation(
  id: number | string,
  reason: string
): Promise<ApiResponse<RequestObligation>> {
  const { data } = await api.post<ApiResponse<RequestObligation>>(`/api/core/request-obligations/${id}/waive/`, {
    waiver_reason: reason,
  });
  return data;
}
