/**
 * Approver-facing shape of a leave request. It extends the employee-facing
 * `LeaveRequestSummary` with the requester identity, which the self-service
 * views deliberately never needed (they only ever show the caller's own rows).
 */
export interface ApprovalLeaveRequest {
  id: number | string | null;
  /** From the serializer's nested `employee` object; `null` for profile-only rows. */
  employeeId: number | string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  leaveTypeName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  days: number | null;
  reason: string | null;
  createdAt: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
}

export type ApprovalAction = 'approve' | 'reject';

export type ApprovalFailureKey =
  | 'state.actionFailed'
  | 'state.offlineBody'
  | 'state.unauthorizedBody'
  | 'state.validationFailed'
  | 'approvals.notActionable'
  | 'approvals.rejectReasonRequired';

export type ApprovalMutationOutcome =
  | { status: 'success' }
  /** `details` holds only server validation text sanitized by the API client. */
  | { status: 'failed'; messageKey: ApprovalFailureKey; details: readonly string[] };
