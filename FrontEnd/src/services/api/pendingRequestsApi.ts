import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type PendingRequestType = "LEAVE" | "LOAN" | "ATTENDANCE" | "ASSET" | "EMPLOYEE_DELETION";

export interface PendingRequestItem {
  id: number;
  workflow_id: number;
  request_type: PendingRequestType;
  request_type_label: string;
  name: string;
  action: string;
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

export function getPendingRequests(
  params?: PendingRequestsParams
): Promise<ApiResponse<PaginatedResponse<PendingRequestItem>>> {
  return api.get("/api/core/pending-requests/", { params }).then((r) => r.data);
}
