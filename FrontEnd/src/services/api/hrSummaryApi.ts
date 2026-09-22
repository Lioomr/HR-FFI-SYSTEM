import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

/**
 * Where the workforce is today. Active employees are split by approved leave
 * covering today; pre-hire and suspended employees are not counted.
 */
export interface WorkforceStatus {
  currently_employed: number;
  /** Approved leave marked as travel, any leave type. */
  on_leave_outside: number;
  /** Approved leave without travel, any leave type. */
  on_leave_inside: number;
  archived: number;
}

/** Headcount for one nationality (non-archived employees). */
export interface NationalityCount {
  /** Free-text nationality as recorded; null when blank. */
  nationality: string | null;
  total: number;
  active: number;
  is_saudi: boolean;
}

export interface NationalityBreakdown {
  saudi_active: number;
  active_total: number;
  /** Largest first; the blank group, if any, is last. */
  nationalities: NationalityCount[];
}

export type ExpiringDocumentGroup =
  | "national_id"
  | "iqama"
  | "passport"
  | "work_license"
  | "contract"
  | "health_insurance";

export interface ExpiringDocumentPreview {
  /** EmployeeProfile id */
  employee_id: number;
  full_name: string;
  doc_type: ExpiringDocumentGroup;
  expiry_date: string;
  days_left: number;
}

/** Documents of non-archived employees expiring within `window_days`. */
export interface ExpiringDocumentsSummary {
  window_days: number;
  employee_count: number;
  by_type: Record<ExpiringDocumentGroup, number>;
  /** Soonest first, at most five. */
  soonest: ExpiringDocumentPreview[];
}

/**
 * HR Summary data structure
 */
export interface HRSummary {
  total_employees: number;
  active_employees: number;
  workforce_status: WorkforceStatus;
  nationality_breakdown: NationalityBreakdown;
  expiring_docs: number;
  expiring_documents: ExpiringDocumentsSummary;
  pending_leaves: number;
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
