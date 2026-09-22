import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type PendingRequestType =
  | "LEAVE"
  | "LOAN"
  | "ATTENDANCE"
  | "ASSET"
  | "EMPLOYEE_DELETION"
  | "CONTRACT_DECISION"
  | "CONTRACT_RATING"
  | "ANNUAL_LEAVE_PAYMENT";

export interface PendingRequestItem {
  id: number;
  workflow_id: number;
  request_type: PendingRequestType;
  request_type_label: string;
  name: string;
  action: string;
  details?: string;
  time: string;
  avatar: string;
  review_path: string;
  company_name?: string | null;
  current_approver_role: string;
}

export interface PendingRequestsParams {
  page?: number;
  page_size?: number;
  request_type?: PendingRequestType;
  search?: string;
}

export type PendingRequestsPage = PaginatedResponse<PendingRequestItem> & {
  /** Pending items per type, after search but ignoring the type filter. */
  counts_by_type?: Partial<Record<PendingRequestType, number>>;
  /** All pending items after search, ignoring the type filter. */
  total_count?: number;
};

export function getPendingRequests(
  params?: PendingRequestsParams,
): Promise<ApiResponse<PendingRequestsPage>> {
  return api.get("/api/core/pending-requests/", { params }).then((r) => r.data);
}
