import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * HR Summary data structure
 */
export interface HRSummary {
  total_employees: number;
  active_employees: number;
  expiring_docs: number;
  pending_leaves: number;
  pending_approvals: Array<{
    id: number;
    name: string;
    request_type: "LEAVE" | "ATTENDANCE";
    action: string;
    time: string;
    avatar: string;
    review_path: string;
  }>;
  recent_activity: Array<{
    key: string;
    employee: string;
    action: string;
    date: string;
    status: string;
    statusColor: string;
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
