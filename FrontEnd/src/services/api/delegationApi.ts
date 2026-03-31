import { api } from "./apiClient";
import type { ApiResponse } from "./apiTypes";

export type DelegationUser = {
  id: number;
  email: string;
  full_name: string;
};

export type DelegationRuleDto = {
  id: number;
  from_user: DelegationUser;
  to_user: DelegationUser;
  start_at: string;
  end_at: string | null;
  reason: string;
  is_active: boolean;
  created_by?: DelegationUser | null;
  created_at: string;
  updated_at: string;
};

export type DelegationRuleListResponse = {
  items: DelegationRuleDto[];
};

export type CreateDelegationRuleRequest = {
  from_user_id: number;
  to_user_id: number;
  start_at: string;
  end_at?: string | null;
  reason?: string;
  is_active?: boolean;
};

export type UpdateDelegationRuleRequest = Partial<CreateDelegationRuleRequest> & {
  is_active?: boolean;
};

export async function listDelegationRules() {
  const { data } = await api.get<ApiResponse<DelegationRuleListResponse>>("/api/core/workflow/delegations/");
  return data;
}

export async function createDelegationRule(payload: CreateDelegationRuleRequest) {
  const { data } = await api.post<ApiResponse<DelegationRuleDto>>("/api/core/workflow/delegations/", payload);
  return data;
}

export async function updateDelegationRule(ruleId: number, payload: UpdateDelegationRuleRequest) {
  const { data } = await api.patch<ApiResponse<DelegationRuleDto>>(`/api/core/workflow/delegations/${ruleId}/`, payload);
  return data;
}

export async function deleteDelegationRule(ruleId: number) {
  const { data } = await api.delete<ApiResponse<Record<string, never>>>(`/api/core/workflow/delegations/${ruleId}/`);
  return data;
}
