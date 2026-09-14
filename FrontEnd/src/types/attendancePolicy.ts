/**
 * Attendance policy read models: today summary, HR recalculation, and late
 * violation history. Mirrors `Backend/attendance/serializers.py`
 * (`AttendanceDailyResultSerializer`, `AttendanceLateViolationSerializer`).
 *
 * Decimals travel as strings ("5.00"); `penalty_percent` is a fraction with
 * four decimals ("0.0500" is 5%). Keep them as strings and format for display
 * only. Times are ISO-8601 with offsets, or null.
 */

export type AttendanceStatusInput = "PRESENT" | "LATE";

export const GRACE_REASONS = [
  "attendance_exempt",
  "late_permission",
  "no_check_in",
  "on_time",
  "monthly_grace",
  "outside_grace",
  "post_grace_tolerance",
  "post_grace_late",
] as const;

export type GraceReason = (typeof GRACE_REASONS)[number];

export const VIOLATION_LIFECYCLES = [
  "active",
  "void",
  "applied",
  "manual_review",
] as const;

export type ViolationLifecycle = (typeof VIOLATION_LIFECYCLES)[number];

export const ATTENDANCE_DEDUCTION_STATUSES = [
  "pending",
  "claimed",
  "applied",
  "manual_review",
  "void",
] as const;

export type AttendanceDeductionStatus =
  (typeof ATTENDANCE_DEDUCTION_STATUSES)[number];

export interface AttendanceLateViolation {
  id: number;
  employee_profile_id: number;
  employee_code: string;
  employee_name: string;
  employee_name_en: string | null;
  employee_name_ar: string | null;
  date: string; // YYYY-MM-DD
  /** Lifetime occurrence; 1 is a zero-amount warning. */
  occurrence_number: number;
  daily_rate: string;
  penalty_percent: string;
  penalty_amount: string;
  lifecycle: ViolationLifecycle;
  /** Grace reason that made the day late. */
  reason: GraceReason | string;
  /** Grace reason that invalidated a void or manual_review violation, else "". */
  void_reason: GraceReason | string;
  /** Status of the violation's payroll deduction; null when none exists. */
  payroll_status: AttendanceDeductionStatus | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceShift {
  start_at: string | null;
  end_at: string | null;
  scheduled_minutes: number;
}

export interface AttendanceDailyResult {
  date: string; // YYYY-MM-DD
  shift: AttendanceShift;
  first_check_in_at: string | null;
  final_check_out_at: string | null;
  physical_work_minutes: number;
  unpaid_break_minutes: number;
  approved_permission_minutes: number;
  accounted_attendance_minutes: number;
  missing_minutes: number;
  status_input: AttendanceStatusInput;
  is_attendance_exempt: boolean;
  /** `reason` is null only for a result calculated before policy enforcement. */
  grace: { consumed: boolean; reason: GraceReason | null };
  violation: AttendanceLateViolation | null;
}

/**
 * Server-side filters for `GET /api/attendance/violations/`. Multi-value
 * filters are sent comma-separated. The server validates every value and
 * answers 422 per field, so callers pass through what the user chose.
 */
export interface AttendanceViolationFilters {
  page?: number;
  page_size?: number;
  lifecycle?: readonly string[];
  payroll_status?: readonly string[];
  employee_profile_id?: number | string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

/** Inclusive range; `date_to` minus `date_from` must be 0 to 31 days. */
export type AttendanceRecalculationRequest =
  | { employee_profile_id: number; date: string }
  | { employee_profile_id: number; date_from: string; date_to: string };

export interface AttendanceRecalculationResponse {
  results: AttendanceDailyResult[];
}

/**
 * Notice severity. Occurrence 1 is an informational warning with no payroll
 * deduction; 2 is a formal caution, 3 a serious warning, and 4 or later a
 * critical final warning.
 */
export const NOTICE_LEVELS = [1, 2, 3, 4] as const;

export type NoticeLevel = (typeof NOTICE_LEVELS)[number];

/**
 * `AttendanceLateNotice.DeliveryStatus` on the backend. Any other value is
 * shown as the server sent it.
 */
export const NOTICE_DELIVERY_STATUSES = [
  "scheduled",
  "sent",
  "failed",
  "skipped",
] as const;

export type NoticeDeliveryStatus = (typeof NOTICE_DELIVERY_STATUSES)[number];

/**
 * A late-attendance notice from `GET /api/attendance/notices/`. The backend
 * issues and delivers notices on its own; the frontend only lists them and
 * downloads the private PDF.
 */
export interface AttendanceLateNotice {
  id: number;
  violation_id: number;
  employee_profile_id: number;
  employee_name: string;
  employee_code: string;
  violation_date: string; // YYYY-MM-DD
  occurrence_number: number;
  notice_level: NoticeLevel | number;
  reference_number: string;
  issued_at: string;
  delivery_status: NoticeDeliveryStatus | string | null;
  /** English-only server text; the UI words delivery from `delivery_status`. */
  delivery_message: string | null;
  /** `null` when no PDF is stored; the download action is hidden then. */
  filename: string | null;
}

/**
 * HR filters for `GET /api/attendance/notices/`, mirroring the violation list.
 * Multi-value filters are sent comma-separated; the server validates them.
 */
export interface AttendanceNoticeFilters {
  page?: number;
  page_size?: number;
  notice_level?: readonly string[];
  employee_profile_id?: number | string;
  date_from?: string;
  date_to?: string;
  search?: string;
}
