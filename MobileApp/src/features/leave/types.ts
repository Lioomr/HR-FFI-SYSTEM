export interface LeaveBalance {
  leaveTypeId: number | null;
  leaveType: string | null;
  totalDays: number | null;
  usedDays: number | null;
  remainingDays: number | null;
}

export interface LeaveType {
  id: number | string;
  name: string | null;
  code: string | null;
  isActive: boolean;
}

export interface LeaveRequestSummary {
  id: number | string | null;
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

export interface LeaveSnapshot {
  balances: LeaveBalance[];
  requests: LeaveRequestSummary[];
  year: number;
}

export interface LeaveRequestDraft {
  leaveTypeId: number | string | null;
  startDate: string;
  endDate: string;
  reason: string;
}

export type LeaveDraftFieldError =
  'leave.leaveTypeRequired' | 'leave.invalidDate' | 'leave.endBeforeStart';

export interface LeaveDraftValidation {
  leaveTypeId?: LeaveDraftFieldError;
  startDate?: LeaveDraftFieldError;
  endDate?: LeaveDraftFieldError;
}

export type LeaveMutationOutcome =
  | { status: 'success' }
  /** `details` holds only server validation text sanitized by the API client. */
  | { status: 'failed'; messageKey: LeaveFailureKey; details: readonly string[] };

export type LeaveFailureKey =
  | 'state.actionFailed'
  | 'state.offlineBody'
  | 'state.unauthorizedBody'
  | 'state.validationFailed'
  | 'leave.cancelOnlyPending';
