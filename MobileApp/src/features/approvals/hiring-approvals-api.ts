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

import type { ApprovalAction, ApprovalMutationOutcome, HiringRequestApproval } from './types';

/** Root-mounted Django routes verified in `Backend/job_offers/urls.py`. */
export const HIRING_REQUESTS_PATH = '/hiring-requests/' as const;
const PAGE_SIZE = 25;

export function hasHiringApprovalAccess(approverRole: Role): boolean {
  // The server additionally accepts active department-1 and delegated CEO approvers.
  // The mobile login payload has no corresponding capability flag, so only role values
  // that are always accepted are offered this UI; the server remains authoritative.
  return approverRole === 'CEO' || approverRole === 'SystemAdmin';
}

export function parseHiringRequestApproval(value: unknown): HiringRequestApproval {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    referenceNumber: stringOrNull(item.reference_number),
    candidateFullName: stringOrNull(item.candidate_full_name),
    candidateEmail: stringOrNull(item.candidate_email),
    candidatePhoneNumber: stringOrNull(item.candidate_phone_number),
    nationality: stringOrNull(item.nationality),
    proposedSalary: finiteNumberOrNull(item.proposed_salary),
    status: stringOrNull(item.status),
    requestedByName: stringOrNull(item.requested_by_name),
    submittedAt: stringOrNull(item.submitted_at),
    ceoDecisionByName: stringOrNull(item.ceo_decision_by_name),
    ceoDecisionAt: stringOrNull(item.ceo_decision_at),
    ceoDecisionNote: stringOrNull(item.ceo_decision_note),
    createdAt: stringOrNull(item.created_at),
  };
}

/** Both server actions accept only `submitted`; unlike leave, there is no asymmetry. */
export function canActOnHiringApproval(
  approverRole: Role,
  status: string | null,
  _action: ApprovalAction,
): boolean {
  return hasHiringApprovalAccess(approverRole) && status === 'submitted';
}

export async function loadHiringApprovals(
  approverRole: Role,
  client: ApiClient = apiClient,
): Promise<HiringRequestApproval[]> {
  if (!hasHiringApprovalAccess(approverRole)) return [];
  const path = `${HIRING_REQUESTS_PATH}?page=1&page_size=${PAGE_SIZE}` as `/${string}`;
  return parsePaginated(await client.request<unknown>(path), parseHiringRequestApproval).items;
}

function outcomeFromError(error: unknown): ApprovalMutationOutcome {
  if (error instanceof ApiError) {
    if (error.code === 'session_expired') throw error;
    if (error.code === 'validation_failed') {
      return { status: 'failed', messageKey: 'state.validationFailed', details: error.details };
    }
    if (error.code === 'forbidden' || error.code === 'not_found') {
      return { status: 'failed', messageKey: 'state.unauthorizedBody', details: [] };
    }
    if (error.code === 'network_unavailable') {
      return { status: 'failed', messageKey: 'state.offlineBody', details: [] };
    }
  }
  return { status: 'failed', messageKey: 'state.actionFailed', details: [] };
}

export async function actOnHiringApproval(
  approverRole: Role,
  requestId: number | string,
  action: ApprovalAction,
  note = '',
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  if (!hasHiringApprovalAccess(approverRole)) {
    return { status: 'failed', messageKey: 'state.unauthorizedBody', details: [] };
  }
  const path =
    `${HIRING_REQUESTS_PATH}${encodeURIComponent(String(requestId))}/${action}/` as `/${string}`;
  try {
    await client.request<unknown>(path, { method: 'POST', body: { note: note.trim() } });
    return { status: 'success' };
  } catch (error) {
    return outcomeFromError(error);
  }
}
