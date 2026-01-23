import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

/**
 * HR Summary data structure
 */
export interface HRSummary {
  total_employees: number;
  active_employees: number;
}

/**
 * Get HR summary metrics
 */
export async function getHrSummary(): Promise<ApiResponse<HRSummary>> {
  const { data } = await api.get<ApiResponse<HRSummary>>("/hr/summary");
  return data;
}
