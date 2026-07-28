import {
  ApiError,
  apiClient,
  booleanOrNull,
  finiteNumberOrNull,
  identifierOrNull,
  integerOrNull,
  parseArray,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import { resourceFrom, type Resource } from '../shared';

import type {
  LeaveBalance,
  LeaveDraftValidation,
  LeaveMutationOutcome,
  LeaveRequestDraft,
  LeaveRequestSummary,
  LeaveType,
} from './types';

/** Verified Gate 1 routes for employee self-service leave. */
export const LEAVE_BALANCE_PATH = '/api/leaves/employee/leave-balance/' as const;
export const LEAVE_REQUESTS_PATH = '/api/leaves/employee/leave-requests/' as const;
export const LEAVE_TYPES_PATH = '/api/leaves/leave-types/' as const;
export const LEAVE_SUBMIT_PATH = '/api/leaves/leave-requests/' as const;

export const LEAVE_REQUEST_PAGE_SIZE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function parseLeaveBalance(value: unknown): LeaveBalance {
  const item = record(value);
  return {
    leaveTypeId: integerOrNull(item.leave_type_id),
    leaveType: stringOrNull(item.leave_type),
    totalDays: finiteNumberOrNull(item.total_days),
    usedDays: finiteNumberOrNull(item.used_days),
    remainingDays: finiteNumberOrNull(item.remaining_days),
  };
}

export function parseLeaveType(value: unknown): LeaveType {
  const item = record(value);
  const id = identifierOrNull(item.id);
  if (id === null) throw new ApiError('invalid_response');
  return {
    id,
    name: stringOrNull(item.name),
    code: stringOrNull(item.code),
    isActive: booleanOrNull(item.is_active) ?? true,
  };
}

export function parseLeaveRequest(value: unknown): LeaveRequestSummary {
  const item = record(value);
  const leaveType = record(item.leave_type);
  return {
    id: identifierOrNull(item.id),
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

export function currentYear(now: Date = new Date()): number {
  return now.getFullYear();
}

/**
 * Balance, own requests, and selectable leave types load independently so a single
 * failing section (for example a role without balance access) never blanks the tab.
 */
export async function loadLeaveOverview(
  year = currentYear(),
  client: ApiClient = apiClient,
): Promise<{
  balances: Resource<LeaveBalance[]>;
  requests: Resource<LeaveRequestSummary[]>;
  leaveTypes: Resource<LeaveType[]>;
  year: number;
}> {
  const balancePath = `${LEAVE_BALANCE_PATH}?year=${year}` as `/${string}`;
  const requestsPath =
    `${LEAVE_REQUESTS_PATH}?page=1&page_size=${LEAVE_REQUEST_PAGE_SIZE}` as `/${string}`;

  const [balances, requests, leaveTypes] = await Promise.allSettled([
    client.request<unknown>(balancePath),
    client.request<unknown>(requestsPath),
    client.request<unknown>(LEAVE_TYPES_PATH),
  ]);

  return {
    balances: resourceFrom(balances, (value) => parseArray(value, parseLeaveBalance)),
    requests: resourceFrom(requests, (value) => parsePaginated(value, parseLeaveRequest).items),
    leaveTypes: resourceFrom(leaveTypes, (value) =>
      parseArray(value, parseLeaveType).filter((type) => type.isActive),
    ),
    year,
  };
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** Client-side pre-checks only. The server remains the authority for leave policy. */
export function validateLeaveDraft(draft: LeaveRequestDraft): LeaveDraftValidation {
  const errors: LeaveDraftValidation = {};
  if (draft.leaveTypeId === null || draft.leaveTypeId === '') {
    errors.leaveTypeId = 'leave.leaveTypeRequired';
  }
  if (!isIsoDate(draft.startDate)) errors.startDate = 'leave.invalidDate';
  if (!isIsoDate(draft.endDate)) errors.endDate = 'leave.invalidDate';
  if (!errors.startDate && !errors.endDate && draft.endDate < draft.startDate) {
    errors.endDate = 'leave.endBeforeStart';
  }
  return errors;
}

function mutationFailure(error: unknown, fallbackKey: 'state.actionFailed'): LeaveMutationOutcome {
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
  return { status: 'failed', messageKey: fallbackKey, details: [] };
}

/**
 * The server fixes ownership to the caller; the client sends no employee identifier.
 * The field name is `leave_type`, matching the verified create serializer.
 */
export async function submitLeaveRequest(
  draft: LeaveRequestDraft,
  client: ApiClient = apiClient,
): Promise<LeaveMutationOutcome> {
  try {
    await client.request<unknown>(LEAVE_SUBMIT_PATH, {
      method: 'POST',
      body: {
        leave_type: draft.leaveTypeId,
        start_date: draft.startDate,
        end_date: draft.endDate,
        reason: draft.reason.trim(),
      },
    });
    return { status: 'success' };
  } catch (error) {
    return mutationFailure(error, 'state.actionFailed');
  }
}

export async function cancelLeaveRequest(
  requestId: number | string,
  client: ApiClient = apiClient,
): Promise<LeaveMutationOutcome> {
  const path =
    `${LEAVE_SUBMIT_PATH}${encodeURIComponent(String(requestId))}/cancel/` as `/${string}`;
  try {
    await client.request<unknown>(path, { method: 'POST' });
    return { status: 'success' };
  } catch (error) {
    const outcome = mutationFailure(error, 'state.actionFailed');
    if (outcome.status === 'failed' && outcome.messageKey === 'state.validationFailed') {
      return { ...outcome, messageKey: 'leave.cancelOnlyPending' };
    }
    return outcome;
  }
}
