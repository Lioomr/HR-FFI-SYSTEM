import { api } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "./apiTypes";
import type { WorkflowSnapshot } from "../../types/workflow";

export type ContractDecisionType = "RENEW" | "RENEW_WITH_CHANGES" | "TERMINATE";

/**
 * Every member of `employees.models.ContractDecision.Status`. The backend can
 * return any of these from a 200 response — including from an approve call —
 * so a client must never infer the outcome from the HTTP status alone.
 */
export type ContractDecisionStatus =
  | "PENDING_HR"
  | "PENDING_CEO"
  | "APPROVED"
  | "AUTO_APPROVED"
  | "REJECTED"
  | "AUTO_RENEWED"
  | "AUTO_RENEWAL_FAILED"
  | "MANUAL_RESOLUTION_REQUIRED";

/**
 * The six components the backend sums into `total_salary`
 * (see `plans/API Route Status Matrix.md`, "Salary total policy").
 */
export const CONTRACT_SALARY_COMPONENTS = [
  "basic_salary",
  "transportation_allowance",
  "accommodation_allowance",
  "telephone_allowance",
  "petrol_allowance",
  "other_allowance",
] as const;

export type ContractSalaryComponent =
  (typeof CONTRACT_SALARY_COMPONENTS)[number];

/**
 * Amounts travel as decimal strings. `total_salary` is derived server-side:
 * omit it on submission and display the value the backend returns. Sending a
 * non-null total that disagrees with the components is a 422.
 */
export type ContractSalaryTerms = Partial<
  Record<ContractSalaryComponent | "total_salary", string | null>
>;

export interface ContractNotificationDelivery {
  channel: string;
  status: string;
}

export interface ContractDecisionNotification {
  id: number;
  event_key: string;
  milestone: string | null;
  created_at: string;
  deliveries: ContractNotificationDelivery[];
}

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
  original_terms: ContractSalaryTerms;
  proposed_terms: ContractSalaryTerms;
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
  notification_status: ContractDecisionNotification[];
  /**
   * Carries every retained HR submission and CEO action, including the repeats
   * that follow a manual-resolution resubmission. Entry `metadata` signatures
   * are opaque per the backend contract — render them, never parse them.
   */
  workflow?: WorkflowSnapshot;
}

export interface ContractDecisionSubmitPayload {
  decision_type: ContractDecisionType;
  proposed_contract_date?: string | null;
  proposed_contract_expiry?: string | null;
  proposed_terms?: ContractSalaryTerms;
  hr_comment?: string;
}

export async function listContractDecisions(
  params: {
    status?: ContractDecisionStatus;
    employee_id?: string;
    page?: number;
    page_size?: number;
  } = {},
): Promise<ApiResponse<PaginatedResponse<ContractDecision>>> {
  const { data } = await api.get<
    ApiResponse<PaginatedResponse<ContractDecision>>
  >("/api/employees/contract-decisions/", { params });
  return data;
}

export async function getContractDecision(
  id: number | string,
): Promise<ApiResponse<ContractDecision>> {
  const { data } = await api.get<ApiResponse<ContractDecision>>(
    `/api/employees/contract-decisions/${id}/`,
  );
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
