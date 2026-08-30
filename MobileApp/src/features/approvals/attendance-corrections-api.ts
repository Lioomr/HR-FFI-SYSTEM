import { type Role } from '@/auth/role';
import {
  ApiError,
  apiClient,
  identifierOrNull,
  parsePaginated,
  record,
  stringOrNull,
  type ApiClient,
} from '@/services/api';

import type {
  ApprovalAction,
  ApprovalMutationOutcome,
  AttendanceCorrectionApproval,
} from './types';

export const ATTENDANCE_CORRECTIONS_PATH = '/api/attendance-correction-requests/' as const;
const PAGE_SIZE = 25;

export function hasAttendanceCorrectionApprovalAccess(approverRole: Role): boolean {
  return (
    approverRole === 'Manager' || approverRole === 'HRManager' || approverRole === 'SystemAdmin'
  );
}

export function parseAttendanceCorrectionApproval(value: unknown): AttendanceCorrectionApproval {
  const item = record(value);
  return {
    id: identifierOrNull(item.id),
    employeeName: stringOrNull(item.employee_name),
    employeeEmail: stringOrNull(item.employee_email),
    date: stringOrNull(item.date),
    currentCheckInAt: stringOrNull(item.current_check_in_at),
    currentCheckOutAt: stringOrNull(item.current_check_out_at),
    currentStatus: stringOrNull(item.current_status),
    requestedCheckInAt: stringOrNull(item.requested_check_in_at),
    requestedCheckOutAt: stringOrNull(item.requested_check_out_at),
    requestedStatus: stringOrNull(item.requested_status),
    reason: stringOrNull(item.reason),
    status: stringOrNull(item.status),
    createdAt: stringOrNull(item.created_at),
  };
}

function statusFor(approverRole: Role): string | null {
  if (approverRole === 'Manager') return 'pending_manager';
  if (approverRole === 'HRManager') return 'pending_hr';
  return null;
}

export function canActOnAttendanceCorrection(
  approverRole: Role,
  status: string | null,
  action: ApprovalAction,
): boolean {
  if (!status) return false;
  if (approverRole === 'SystemAdmin')
    return status === 'pending_manager' || status === 'pending_hr';
  if (approverRole === 'Manager') return status === 'pending_manager';
  if (approverRole === 'HRManager') return status === 'pending_hr';
  return false;
}

export async function loadAttendanceCorrectionApprovals(
  approverRole: Role,
  client: ApiClient = apiClient,
): Promise<AttendanceCorrectionApproval[]> {
  if (!hasAttendanceCorrectionApprovalAccess(approverRole)) return [];
  const status = statusFor(approverRole);
  const query = status ? `&status=${status}` : '';
  const path =
    `${ATTENDANCE_CORRECTIONS_PATH}?page=1&page_size=${PAGE_SIZE}${query}` as `/${string}`;
  const rows = parsePaginated(
    await client.request<unknown>(path),
    parseAttendanceCorrectionApproval,
  ).items;
  return rows.filter((row) => canActOnAttendanceCorrection(approverRole, row.status, 'approve'));
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

export async function actOnAttendanceCorrection(
  approverRole: Role,
  correctionId: number | string,
  action: ApprovalAction,
  notes = '',
  client: ApiClient = apiClient,
): Promise<ApprovalMutationOutcome> {
  if (!hasAttendanceCorrectionApprovalAccess(approverRole)) {
    return { status: 'failed', messageKey: 'state.unauthorizedBody', details: [] };
  }
  const trimmed = notes.trim();
  if (action === 'reject' && !trimmed) {
    return { status: 'failed', messageKey: 'approvals.rejectReasonRequired', details: [] };
  }
  const path =
    `${ATTENDANCE_CORRECTIONS_PATH}${encodeURIComponent(String(correctionId))}/${action}/` as `/${string}`;
  try {
    await client.request<unknown>(path, { method: 'POST', body: { notes: trimmed } });
    return { status: 'success' };
  } catch (error) {
    return outcomeFromError(error);
  }
}
