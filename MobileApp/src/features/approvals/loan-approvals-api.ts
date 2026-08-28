import { type Role } from '@/auth/role';
import {
  ApiError,
  apiClient,
  finiteNumberOrNull,
  identifierOrNull,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import type { ApprovalAction, ApprovalMutationOutcome, LoanRequestApproval } from './types';

export const HR_LOAN_REQUESTS_PATH = '/api/loans/hr/loan-requests/' as const;
export const CFO_LOAN_REQUESTS_PATH = '/api/loans/cfo/loan-requests/' as const;
export const CEO_LOAN_REQUESTS_PATH = '/api/loans/ceo/loan-requests/' as const;
const PAGE_SIZE = 25;

export type LoanApprovalAction = ApprovalAction | 'refer-to-ceo';

export function hasLoanApprovalAccess(approverRole: Role): boolean {
  return ['HRManager', 'CFO', 'CEO', 'SystemAdmin'].includes(approverRole);
}

export function parseLoanRequestApproval(value: unknown): LoanRequestApproval {
  const item = record(value);
  const employee = record(item.employee);
  return {
    id: identifierOrNull(item.id),
    employeeName: stringOrNull(employee.full_name),
    employeeEmail: stringOrNull(employee.email),
    requestedAmount: finiteNumberOrNull(item.requested_amount),
    approvedAmount: finiteNumberOrNull(item.approved_amount),
    loanType: stringOrNull(item.loan_type),
    installmentMonths: finiteNumberOrNull(item.installment_months),
    reason: stringOrNull(item.reason),
    status: stringOrNull(item.status),
    createdAt: stringOrNull(item.created_at),
    hrDecisionNote: stringOrNull(item.finance_decision_note),
    cfoDecisionNote: stringOrNull(item.cfo_decision_note),
    ceoDecisionNote: stringOrNull(item.ceo_decision_note),
  };
}

function pathFor(approverRole: Role) {
  if (approverRole === 'CFO') return CFO_LOAN_REQUESTS_PATH;
  if (approverRole === 'CEO') return CEO_LOAN_REQUESTS_PATH;
  return HR_LOAN_REQUESTS_PATH;
}

export function canActOnLoanApproval(
  approverRole: Role,
  status: string | null,
  _action: LoanApprovalAction,
): boolean {
  if (!status || !hasLoanApprovalAccess(approverRole)) return false;
  if (approverRole === 'CFO') return status === 'pending_cfo';
  if (approverRole === 'CEO') return status === 'pending_ceo';
  return status === 'pending_hr' || status === 'pending_finance';
}

export function canReferLoanToCeo(approverRole: Role, status: string | null): boolean {
  return approverRole === 'CFO' && status === 'pending_cfo';
}

export async function loadLoanApprovals(
  approverRole: Role,
  client: ApiClient = apiClient,
): Promise<LoanRequestApproval[]> {
  if (!hasLoanApprovalAccess(approverRole)) return [];
  const path = `${pathFor(approverRole)}?page=1&page_size=${PAGE_SIZE}` as `/${string}`;
  return parsePaginated(await client.request<unknown>(path), parseLoanRequestApproval).items;
}

function outcomeFromError(error: unknown): ApprovalMutationOutcome {
  if (error instanceof ApiError) {
    if (error.code === 'session_expired') throw error;
    if (error.code === 'validation_failed')
      return { status: 'failed', messageKey: 'state.validationFailed', details: error.details };
    if (error.code === 'forbidden' || error.code === 'not_found')
      return { status: 'failed', messageKey: 'state.unauthorizedBody', details: [] };
    if (error.code === 'network_unavailable')
      return { status: 'failed', messageKey: 'state.offlineBody', details: [] };
  }
  return { status: 'failed', messageKey: 'state.actionFailed', details: [] };
}

export async function actOnLoanApproval(
  approverRole: Role,
  requestId: number | string,
  action: LoanApprovalAction,
  comment = '',
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  if (!hasLoanApprovalAccess(approverRole))
    return { status: 'failed', messageKey: 'state.unauthorizedBody', details: [] };
  const required =
    action === 'refer-to-ceo' ||
    ((approverRole === 'CFO' || approverRole === 'CEO') && action === 'reject');
  const trimmed = comment.trim();
  if (required && !trimmed)
    return { status: 'failed', messageKey: 'approvals.rejectReasonRequired', details: [] };
  const path =
    `${pathFor(approverRole)}${encodeURIComponent(String(requestId))}/${action}/` as `/${string}`;
  try {
    await client.request<unknown>(path, { method: 'POST', body: { comment: trimmed } });
    return { status: 'success' };
  } catch (error) {
    return outcomeFromError(error);
  }
}
