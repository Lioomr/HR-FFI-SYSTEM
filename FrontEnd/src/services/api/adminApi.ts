import { api } from "./apiClient";
import type { AdminSummary, ApiResponse } from "./apiTypes";

export async function getAdminSummary() {
  const { data } = await api.get<ApiResponse<AdminSummary>>("/admin/summary");
  return data;
}
