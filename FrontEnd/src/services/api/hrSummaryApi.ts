import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import type { PendingRequestItem } from "./pendingRequestsApi";

/**
 * Pending approval rows on the HR summary are produced by the same workflow
 * builder as the pending inbox, plus a free-text reason.
 */
export interface HrPendingApprovalItem extends PendingRequestItem {
  details?: string;
}

/**
 * HR Summary data structure
 */
export interface HRSummary {
  total_employees: number;
  active_employees: number;
  expiring_docs: number;
  pending_leaves: number;
  pending_approvals: HrPendingApprovalItem[];
  recent_activity: Array<{
    key: string;
    employee: string;
    action: string;
    date: string;
    status: string;
    statusColor: string;
    company_name?: string | null;
  }>;
  latest_payroll: {
    latest_total_net: number | null;
    latest_period: string | null;
    trend_percentage: number | null;
  };
}

/**
 * Get HR summary metrics
 */
export async function getHrSummary(): Promise<ApiResponse<HRSummary>> {
  const { data } = await api.get<ApiResponse<HRSummary>>("/api/hr/summary/");
  return data;
}

export interface HrRecentActivityItem {
  key: string;
  employee: string;
  action: string;
  date: string;
  status: string;
  statusColor: string;
  company_name?: string | null;
}

export interface HrRecentActivityParams {
  page?: number;
  page_size?: number;
  action?: string;
  search?: string;
  from?: string;
  to?: string;
}

export async function getHrRecentActivity(
  params?: HrRecentActivityParams,
): Promise<ApiResponse<PaginatedResponse<HrRecentActivityItem>>> {
  const { data } = await api.get<
    ApiResponse<PaginatedResponse<HrRecentActivityItem>>
  >("/api/hr/recent-activity/", { params });
  return data;
}
