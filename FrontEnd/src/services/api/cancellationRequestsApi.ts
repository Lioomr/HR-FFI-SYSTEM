import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * Employee requests to HR to cancel an already APPROVED request. The server
 * decides eligibility (workflow.can_request_cancellation); these helpers only
 * call the contract endpoints.
 */
export type CancellationKind =
  | "leave"
  | "permission"
  | "annual_leave_payment"
  | "asset_return"
  | "asset_damage"
  | "loan";

export type CancellationStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "withdrawn";

export const CANCELLATION_KINDS: CancellationKind[] = [
  "leave",
  "permission",
  "annual_leave_payment",
  "asset_return",
  "asset_damage",
  "loan",
];

/** Detail base path of each target request (no trailing slash, no id). */
export const CANCELLATION_DETAIL_BASE: Record<CancellationKind, string> = {
  leave: "/api/leaves/leave-requests",
  permission: "/api/permission-requests",
  annual_leave_payment: "/api/leaves/annual-leave-payments",
  asset_return: "/api/assets/return-requests",
  asset_damage: "/api/assets/damage-reports",
  loan: "/api/loans/loan-requests",
};

export const CANCELLATION_REASON_MIN = 5;
export const CANCELLATION_REASON_MAX = 1000;

export async function requestCancellation<T>(
  kind: CancellationKind,
  id: number | string,
  reason: string,
): Promise<ApiResponse<T>> {
  const { data } = await api.post<ApiResponse<T>>(
    `${CANCELLATION_DETAIL_BASE[kind]}/${id}/request-cancellation/`,
    { reason },
  );
  return data;
}

export async function withdrawCancellationRequest<T>(
  kind: CancellationKind,
  id: number | string,
): Promise<ApiResponse<T>> {
  const { data } = await api.post<ApiResponse<T>>(
    `${CANCELLATION_DETAIL_BASE[kind]}/${id}/withdraw-cancellation-request/`,
  );
  return data;
}

export interface CancellationRequestItem {
  id: number;
  kind: CancellationKind;
  request_id: number;
  reference_no: string | null;
  employee_name: string;
  request_title: string;
  request_status: string;
  reason: string;
  status: CancellationStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string;
  detail_path: string;
  /** False for the HR member's own requests. */
  can_decide?: boolean;
}

export interface CancellationRequestsPage {
  items: CancellationRequestItem[];
  page: number;
  page_size: number;
  count: number;
  total_pages: number;
}

export interface CancellationRequestsParams {
  status?: CancellationStatus | "all";
  kind?: CancellationKind;
  page?: number;
  page_size?: number;
}

export async function listCancellationRequests(
  params?: CancellationRequestsParams,
): Promise<ApiResponse<CancellationRequestsPage>> {
  const { data } = await api.get<ApiResponse<CancellationRequestsPage>>(
    "/api/core/cancellation-requests/",
    { params },
  );
  return data;
}

export async function confirmCancellationRequest(
  id: number,
  comment?: string,
): Promise<ApiResponse<CancellationRequestItem>> {
  const { data } = await api.post<ApiResponse<CancellationRequestItem>>(
    `/api/core/cancellation-requests/${id}/confirm/`,
    comment ? { comment } : {},
  );
  return data;
}

export async function declineCancellationRequest(
  id: number,
  comment: string,
): Promise<ApiResponse<CancellationRequestItem>> {
  const { data } = await api.post<ApiResponse<CancellationRequestItem>>(
    `/api/core/cancellation-requests/${id}/decline/`,
    { comment },
  );
  return data;
}
