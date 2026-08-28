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

export interface DelegationUser {
  id: number | string | null;
  email: string | null;
  fullName: string | null;
}

export interface DelegationRule {
  id: number | string | null;
  fromUser: DelegationUser;
  toUser: DelegationUser;
  startAt: string | null;
  endAt: string | null;
  reason: string | null;
  isActive: boolean;
}

export interface DelegationCandidate {
  id: number | string | null;
  employeeId: string | null;
  fullName: string | null;
  fullNameEn: string | null;
  fullNameAr: string | null;
  canDelegate: boolean;
}

export interface DelegationDraft {
  toUserId: number | string | null;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface AttendanceCorrectionApproval {
  id: number | string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  date: string | null;
  currentCheckInAt: string | null;
  currentCheckOutAt: string | null;
  currentStatus: string | null;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  requestedStatus: string | null;
  reason: string | null;
  status: string | null;
  createdAt: string | null;
}

/** CEO-approver-facing, safe subset of a hiring request response. */
export interface HiringRequestApproval {
  id: number | string | null;
  referenceNumber: string | null;
  candidateFullName: string | null;
  candidateEmail: string | null;
  candidatePhoneNumber: string | null;
  nationality: string | null;
  proposedSalary: number | null;
  status: string | null;
  requestedByName: string | null;
  submittedAt: string | null;
  ceoDecisionByName: string | null;
  ceoDecisionAt: string | null;
  ceoDecisionNote: string | null;
  createdAt: string | null;
}
