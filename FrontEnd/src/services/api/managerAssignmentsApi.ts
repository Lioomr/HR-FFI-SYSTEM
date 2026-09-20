import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type OrganizationScope = {
  id: number;
  code: string;
  name: string;
  companies: Array<{ id: number; code: string; name: string }>;
  is_active: boolean;
};

export type CrossCompanyManagerAssignmentRequest = {
  employee_id: number;
  manager_profile_id: number;
  scope_id: number;
  start_at: string;
  end_at: string;
  capabilities: string[];
  reason?: string;
};

export async function listOrganizationScopes() {
  const { data } = await api.get<ApiResponse<{ items: OrganizationScope[] }>>(
    "/api/core/organization-scopes/",
  );
  return data;
}

export async function createCrossCompanyManagerAssignment(
  payload: CrossCompanyManagerAssignmentRequest,
) {
  const { data } = await api.post<ApiResponse<unknown>>(
    "/api/core/cross-company-manager-assignments/",
    payload,
  );
  return data;
}
