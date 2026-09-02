import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";

export type ContractDecisionType = "RENEW" | "RENEW_WITH_CHANGES" | "TERMINATE";
export type ContractDecisionStatus =
  | "PENDING_HR"
  | "PENDING_CEO"
  | "APPROVED"
  | "AUTO_APPROVED"
  | "REJECTED"
  | "AUTO_RENEWED"
  | "AUTO_RENEWAL_FAILED"
  | "MANUAL_RESOLUTION_REQUIRED";

export interface ContractDecision {
  id: number;
  company: number;
  employee: {
    id: number;
    employee_id: string;
    full_name: string;
    company_id: number;
  };
  decision_type: ContractDecisionType | "";
  decision_type_label: string;
  status: ContractDecisionStatus;
  status_label: string;
  original_contract_date: string | null;
  original_contract_expiry: string;
  proposed_contract_date: string | null;
  proposed_contract_expiry: string | null;
  original_terms: Record<string, string | null>;
  proposed_terms: Record<string, string | null>;
  hr_comment: string;
  ceo_comment: string;
  failure_reason: string;
  submitted_at: string | null;
  ceo_deadline: string | null;
  ceo_decided_at: string | null;
  ceo_reminder_count: number;
  finalized_at: string | null;
  finalized_by_system: boolean;
  automatic_renewal: boolean;
  automatic_renewal_reason: string;
  final_notification_sent_at: string | null;
  final_notification_attempts: number;
  last_final_notification_attempt_at: string | null;
  notification_status: Array<{
    id: number;
    event_key: string;
    milestone: string | null;
    created_at: string;
    deliveries: Array<{ channel: string; status: string }>;
  }>;
  workflow?: {
    status: string;
    current_stage: string;
    current_approver_role: string;
    can_approve: boolean;
    can_reject: boolean;
    history: Array<Record<string, unknown>>;
  };
}

export interface ContractDecisionSubmitPayload {
  decision_type: ContractDecisionType;
  proposed_contract_date?: string | null;
  proposed_contract_expiry?: string | null;
  proposed_terms?: Record<string, string | null>;
  hr_comment?: string;
}

export async function listContractDecisions(params: {
  status?: ContractDecisionStatus;
  employee_id?: string;
  page?: number;
  page_size?: number;
} = {}): Promise<ApiResponse<PaginatedResponse<ContractDecision>>> {
  const { data } = await api.get<ApiResponse<PaginatedResponse<ContractDecision>>>(
    "/api/employees/contract-decisions/",
    { params },
  );
  return data;
}

export async function getContractDecision(id: number | string): Promise<ApiResponse<ContractDecision>> {
  const { data } = await api.get<ApiResponse<ContractDecision>>(`/api/employees/contract-decisions/${id}/`);
  return data;
}

export async function submitContractDecision(
  employeeId: number | string,
  payload: ContractDecisionSubmitPayload,
): Promise<ApiResponse<ContractDecision>> {
  const { data } = await api.post<ApiResponse<ContractDecision>>(
    `/api/employees/${employeeId}/contract-decisions/`,
    payload,
  );
  return data;
}

export async function approveContractDecision(
  id: number | string,
  comment = "",
): Promise<ApiResponse<ContractDecision>> {
  const { data } = await api.post<ApiResponse<ContractDecision>>(
    `/api/employees/contract-decisions/${id}/approve/`,
    { comment },
  );
  return data;
}

export async function rejectContractDecision(
  id: number | string,
  comment = "",
): Promise<ApiResponse<ContractDecision>> {
  const { data } = await api.post<ApiResponse<ContractDecision>>(
    `/api/employees/contract-decisions/${id}/reject/`,
    { comment },
  );
  return data;
}
