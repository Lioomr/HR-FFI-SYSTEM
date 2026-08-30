import type { StatusTone } from '@/components/ui';
import type { TranslationKey } from '@/i18n';

interface StatusPresentation {
  labelKey: TranslationKey;
  tone: StatusTone;
  /** Redundant non-colour cue so status never depends on colour perception alone. */
  glyph: string;
}

const ATTENDANCE_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  PENDING_MGR: { labelKey: 'attendanceStatus.PENDING_MGR', tone: 'warning', glyph: '⋯' },
  PENDING_HR: { labelKey: 'attendanceStatus.PENDING_HR', tone: 'warning', glyph: '⋯' },
  PENDING_CEO: { labelKey: 'attendanceStatus.PENDING_CEO', tone: 'warning', glyph: '⋯' },
  PENDING: { labelKey: 'attendanceStatus.PENDING', tone: 'warning', glyph: '⋯' },
  PRESENT: { labelKey: 'attendanceStatus.PRESENT', tone: 'success', glyph: '✓' },
  LATE: { labelKey: 'attendanceStatus.LATE', tone: 'warning', glyph: '!' },
  ABSENT: { labelKey: 'attendanceStatus.ABSENT', tone: 'error', glyph: '×' },
  REJECTED: { labelKey: 'attendanceStatus.REJECTED', tone: 'error', glyph: '×' },
});

const LEAVE_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  submitted: { labelKey: 'leaveStatus.submitted', tone: 'info', glyph: '→' },
  pending_delegate: { labelKey: 'leaveStatus.pending_delegate', tone: 'warning', glyph: '⋯' },
  pending_manager: { labelKey: 'leaveStatus.pending_manager', tone: 'warning', glyph: '⋯' },
  pending_hr: { labelKey: 'leaveStatus.pending_hr', tone: 'warning', glyph: '⋯' },
  pending_ceo: { labelKey: 'leaveStatus.pending_ceo', tone: 'warning', glyph: '⋯' },
  pending_hr_completion: {
    labelKey: 'leaveStatus.pending_hr_completion',
    tone: 'warning',
    glyph: '⋯',
  },
  approved: { labelKey: 'leaveStatus.approved', tone: 'success', glyph: '✓' },
  rejected: { labelKey: 'leaveStatus.rejected', tone: 'error', glyph: '×' },
  cancelled: { labelKey: 'leaveStatus.cancelled', tone: 'neutral', glyph: '–' },
});

const ATTENDANCE_CORRECTION_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  draft: { labelKey: 'attendanceCorrectionStatus.draft', tone: 'neutral', glyph: '–' },
  pending_manager: {
    labelKey: 'attendanceCorrectionStatus.pending_manager',
    tone: 'warning',
    glyph: '⋯',
  },
  pending_hr: { labelKey: 'attendanceCorrectionStatus.pending_hr', tone: 'warning', glyph: '⋯' },
  approved: { labelKey: 'attendanceCorrectionStatus.approved', tone: 'success', glyph: '✓' },
  rejected: { labelKey: 'attendanceCorrectionStatus.rejected', tone: 'error', glyph: '×' },
  cancelled: { labelKey: 'attendanceCorrectionStatus.cancelled', tone: 'neutral', glyph: '–' },
});

const HIRING_REQUEST_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  draft: { labelKey: 'hiringStatus.draft', tone: 'neutral', glyph: '–' },
  submitted: { labelKey: 'hiringStatus.submitted', tone: 'warning', glyph: '⋯' },
  approved: { labelKey: 'hiringStatus.approved', tone: 'success', glyph: '✓' },
  rejected: { labelKey: 'hiringStatus.rejected', tone: 'error', glyph: '×' },
  cancelled: { labelKey: 'hiringStatus.cancelled', tone: 'neutral', glyph: '–' },
  converted: { labelKey: 'hiringStatus.converted', tone: 'info', glyph: '→' },
});

const LOAN_REQUEST_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  submitted: { labelKey: 'loanStatus.submitted', tone: 'info', glyph: '→' },
  pending_manager: { labelKey: 'loanStatus.pending_manager', tone: 'warning', glyph: '⋯' },
  pending_hr: { labelKey: 'loanStatus.pending_hr', tone: 'warning', glyph: '⋯' },
  pending_finance: { labelKey: 'loanStatus.pending_finance', tone: 'warning', glyph: '⋯' },
  pending_cfo: { labelKey: 'loanStatus.pending_cfo', tone: 'warning', glyph: '⋯' },
  pending_ceo: { labelKey: 'loanStatus.pending_ceo', tone: 'warning', glyph: '⋯' },
  pending_disbursement: {
    labelKey: 'loanStatus.pending_disbursement',
    tone: 'warning',
    glyph: '⋯',
  },
  approved: { labelKey: 'loanStatus.approved', tone: 'success', glyph: '✓' },
  rejected: { labelKey: 'loanStatus.rejected', tone: 'error', glyph: '×' },
  cancelled: { labelKey: 'loanStatus.cancelled', tone: 'neutral', glyph: '–' },
  deducted: { labelKey: 'loanStatus.deducted', tone: 'neutral', glyph: '✓' },
});

const EMPLOYMENT_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  ACTIVE: { labelKey: 'employmentStatus.ACTIVE', tone: 'success', glyph: '✓' },
  ON_LEAVE: { labelKey: 'employmentStatus.ON_LEAVE', tone: 'info', glyph: 'i' },
  SUSPENDED: { labelKey: 'employmentStatus.SUSPENDED', tone: 'warning', glyph: '!' },
  TERMINATED: { labelKey: 'employmentStatus.TERMINATED', tone: 'error', glyph: '×' },
});

const PAYSLIP_STATUS: Readonly<Record<string, StatusPresentation>> = Object.freeze({
  PAID: { labelKey: 'payslipStatus.PAID', tone: 'success', glyph: '✓' },
  COMPLETED: { labelKey: 'payslipStatus.COMPLETED', tone: 'info', glyph: '✓' },
  DRAFT: { labelKey: 'payslipStatus.DRAFT', tone: 'neutral', glyph: '–' },
  CANCELLED: { labelKey: 'payslipStatus.CANCELLED', tone: 'neutral', glyph: '–' },
});

const DOCUMENT_TYPE: Readonly<Record<string, TranslationKey>> = Object.freeze({
  IQAMA: 'documentType.IQAMA',
  PASSPORT: 'documentType.PASSPORT',
  VISA: 'documentType.VISA',
  SAUDI_ID: 'documentType.SAUDI_ID',
  OTHER: 'documentType.OTHER',
});

/**
 * Unknown server values fall back to a neutral presentation instead of being rendered
 * raw, so an unmapped enum can never leak an internal identifier into the UI.
 */
function presentation(
  table: Readonly<Record<string, StatusPresentation>>,
  value: string | null,
): StatusPresentation | null {
  if (!value) return null;
  return table[value] ?? null;
}

export function attendanceStatusPresentation(value: string | null): StatusPresentation | null {
  return presentation(ATTENDANCE_STATUS, value);
}

export function leaveStatusPresentation(value: string | null): StatusPresentation | null {
  return presentation(LEAVE_STATUS, value);
}

export function attendanceCorrectionStatusPresentation(
  value: string | null,
): StatusPresentation | null {
  return presentation(ATTENDANCE_CORRECTION_STATUS, value);
}

export function hiringRequestStatusPresentation(value: string | null): StatusPresentation | null {
  return presentation(HIRING_REQUEST_STATUS, value);
}

export function loanRequestStatusPresentation(value: string | null): StatusPresentation | null {
  return presentation(LOAN_REQUEST_STATUS, value);
}

export function employmentStatusPresentation(value: string | null): StatusPresentation | null {
  return presentation(EMPLOYMENT_STATUS, value);
}

export function payslipStatusPresentation(value: string | null): StatusPresentation | null {
  return presentation(PAYSLIP_STATUS, value);
}

export function documentTypeKey(value: string | null): TranslationKey | null {
  if (!value) return null;
  return DOCUMENT_TYPE[value] ?? null;
}

export type { StatusPresentation };
