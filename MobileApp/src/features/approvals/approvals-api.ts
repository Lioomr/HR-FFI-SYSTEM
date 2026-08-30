import { isLeaveCeoApprover, isLeaveHrApprover, type Role } from '@/auth/role';
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

import type { ApprovalAction, ApprovalLeaveRequest, ApprovalMutationOutcome } from './types';

/**
 * Verified approver routes. HR reads the shared leave-request collection (its
 * queryset widens to the whole company for HRManager/SystemAdmin); the CEO
 * collection is a separate, server-side pending-only view.
 *
 * Note: every parameter below that carries the caller's approver identity is
 * named `approverRole`, never `role`, so no request body in this module can be
 * mistaken for a client-chosen auth-role selector.
 */
export const HR_LEAVE_REQUESTS_PATH = '/api/leaves/leave-requests/' as const;
export const CEO_LEAVE_REQUESTS_PATH = '/api/leaves/ceo/leave-requests/' as const;

export const APPROVAL_PAGE_SIZE = 25;

/**
 * Verified against `LeaveRequestViewSet.approve`/`.reject` and
 * `CEOLeaveRequestViewSet.approve`/`.reject`. HR's two actions are deliberately
 * asymmetric server-side: it may reject — but not approve — a request still
 * sitting at the manager stage.
 */
const HR_APPROVABLE_STATUSES = Object.freeze(['submitted', 'pending_hr']);
const HR_REJECTABLE_STATUSES = Object.freeze(['submitted', 'pending_hr', 'pending_manager']);
const CEO_ACTIONABLE_STATUSES = Object.freeze(['pending_ceo']);

export function parseApprovalLeaveRequest(value: unknown): ApprovalLeaveRequest {
  const item = record(value);
  const leaveType = record(item.leave_type);
  // `employee` is a nested `{id, email, full_name}` summary; for rows backed only
  // by an employee profile the serializer returns an `id` of `null`.
  const employee = record(item.employee);
  return {
    id: identifierOrNull(item.id),
    employeeId: identifierOrNull(employee.id),
    employeeName: stringOrNull(employee.full_name),
    employeeEmail: stringOrNull(employee.email),
    leaveTypeName: stringOrNull(leaveType.name) ?? stringOrNull(leaveType.code),
    startDate: stringOrNull(item.start_date),
    endDate: stringOrNull(item.end_date),
    status: stringOrNull(item.status),
    days: finiteNumberOrNull(item.days),
    reason: stringOrNull(item.reason),
    createdAt: stringOrNull(item.created_at),
    decisionReason: stringOrNull(item.decision_reason),
    decidedAt: stringOrNull(item.decided_at),
  };
}

/**
 * Pure gate mirroring the backend's per-action status checks, so a button is
 * only ever offered where the server would actually accept the call. The server
 * remains the authority — this only avoids offering a guaranteed 422.
 */
export function canActOnLeaveApproval(
  approverRole: Role,
  status: string | null,
  action: ApprovalAction,
): boolean {
  if (!status) return false;
  if (isLeaveCeoApprover(approverRole)) return CEO_ACTIONABLE_STATUSES.includes(status);
  if (isLeaveHrApprover(approverRole)) {
    return (action === 'approve' ? HR_APPROVABLE_STATUSES : HR_REJECTABLE_STATUSES).includes(
      status,
    );
  }
  return false;
}

/** True when the signed-in session has any leave-approval surface at all. */
export function hasLeaveApprovalAccess(approverRole: Role): boolean {
  return isLeaveHrApprover(approverRole) || isLeaveCeoApprover(approverRole);
}

async function loadList(
  basePath: typeof HR_LEAVE_REQUESTS_PATH | typeof CEO_LEAVE_REQUESTS_PATH,
  client: ApiClient,
): Promise<ApprovalLeaveRequest[]> {
  const path = `${basePath}?page=1&page_size=${APPROVAL_PAGE_SIZE}` as `/${string}`;
  const payload = await client.request<unknown>(path);
  return parsePaginated(payload, parseApprovalLeaveRequest).items;
}

/** HR/SystemAdmin: the whole company, every workflow stage. */
export async function loadHrLeaveApprovals(
  client: ApiClient = apiClient,
): Promise<ApprovalLeaveRequest[]> {
  return loadList(HR_LEAVE_REQUESTS_PATH, client);
}

/** CEO: only what is awaiting them — the backend queryset is pinned to PENDING_CEO. */
export async function loadCeoLeaveApprovals(
  client: ApiClient = apiClient,
): Promise<ApprovalLeaveRequest[]> {
  return loadList(CEO_LEAVE_REQUESTS_PATH, client);
}

/**
 * Single dispatch point so the screen and the detail sheet never branch on the
 * caller's approver identity themselves.
 */
export async function loadLeaveApprovals(
  approverRole: Role,
  client: ApiClient = apiClient,
): Promise<ApprovalLeaveRequest[]> {
  if (isLeaveCeoApprover(approverRole)) return loadCeoLeaveApprovals(client);
  if (isLeaveHrApprover(approverRole)) return loadHrLeaveApprovals(client);
  return [];
}

function mutationFailure(error: unknown): ApprovalMutationOutcome {
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

async function postDecision(
  basePath: typeof HR_LEAVE_REQUESTS_PATH | typeof CEO_LEAVE_REQUESTS_PATH,
  requestId: number | string,
  action: ApprovalAction,
  body: Record<string, string>,
  client: ApiClient,
): Promise<ApprovalMutationOutcome> {
  const path = `${basePath}${encodeURIComponent(String(requestId))}/${action}/` as `/${string}`;
  try {
    await client.request<unknown>(path, { method: 'POST', body });
    return { status: 'success' };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function approveHrLeave(
  requestId: number | string,
  comment = '',
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  return postDecision(HR_LEAVE_REQUESTS_PATH, requestId, 'approve', { comment }, client);
}

export async function rejectHrLeave(
  requestId: number | string,
  comment: string,
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  const trimmed = comment.trim();
  if (!trimmed) {
    return { status: 'failed', messageKey: 'approvals.rejectReasonRequired', details: [] };
  }
  return postDecision(HR_LEAVE_REQUESTS_PATH, requestId, 'reject', { comment: trimmed }, client);
}

/**
 * `waiver_reason` is only consulted by the server for Business Trip requests
 * with open blocking obligations; sending it empty is always safe.
 */
export async function approveCeoLeave(
  requestId: number | string,
  comment = '',
  waiverReason = '',
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  return postDecision(
    CEO_LEAVE_REQUESTS_PATH,
    requestId,
    'approve',
    { comment, waiver_reason: waiverReason },
    client,
  );
}

export async function rejectCeoLeave(
  requestId: number | string,
  comment: string,
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  const trimmed = comment.trim();
  if (!trimmed) {
    return { status: 'failed', messageKey: 'approvals.rejectReasonRequired', details: [] };
  }
  return postDecision(CEO_LEAVE_REQUESTS_PATH, requestId, 'reject', { comment: trimmed }, client);
}

export interface LeaveApprovalDecision {
  action: ApprovalAction;
  comment?: string;
  waiverReason?: string;
}

/** Role-dispatched decision, matching `loadLeaveApprovals` on the read side. */
export async function actOnLeaveApproval(
  approverRole: Role,
  requestId: number | string,
  decision: LeaveApprovalDecision,
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  const comment = decision.comment ?? '';
  if (isLeaveCeoApprover(approverRole)) {
    return decision.action === 'approve'
      ? approveCeoLeave(requestId, comment, decision.waiverReason ?? '', client)
      : rejectCeoLeave(requestId, comment, client);
  }
  if (isLeaveHrApprover(approverRole)) {
    return decision.action === 'approve'
      ? approveHrLeave(requestId, comment, client)
      : rejectHrLeave(requestId, comment, client);
  }
  return { status: 'failed', messageKey: 'state.unauthorizedBody', details: [] };
}
