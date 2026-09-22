import type { Dayjs } from "dayjs";
import {
  NOTICE_DELIVERY_STATUSES,
  NOTICE_LEVELS,
  type AttendanceDeductionStatus,
  type AttendanceLateNotice,
  type AttendanceLateViolation,
  type AttendanceNoticeFilters,
  type AttendanceViolationFilters,
  type GraceReason,
  type NoticeDeliveryStatus,
  type NoticeLevel,
  type ViolationLifecycle,
} from "../types/attendancePolicy";
import { getHttpErrorMessage, getHttpStatus } from "../services/api/httpErrors";

/** `date_to` minus `date_from` may be 0 to 31 days (inclusive range). */
export const MAX_RECALCULATION_SPAN_DAYS = 31;

/**
 * Client pre-check for HR recalculation; the server re-validates. Returns a
 * translation key describing the problem, or null for a valid range.
 */
export function recalculationRangeError(
  from?: Dayjs | null,
  to?: Dayjs | null,
): string | null {
  if (!from || !to) return "attendancePolicy.recalc.rangeRequired";
  if (to.isBefore(from, "day")) return "attendancePolicy.recalc.rangeReversed";
  if (
    to.startOf("day").diff(from.startOf("day"), "day") >
    MAX_RECALCULATION_SPAN_DAYS
  ) {
    return "attendancePolicy.recalc.rangeTooLong";
  }
  return null;
}

export const VIOLATION_PAGE_SIZE = 25;

/** URL query keys owned by the HR violation history. */
export const VIOLATION_FILTER_PARAMS = [
  "lifecycle",
  "payroll_status",
  "employee_profile_id",
  "date_from",
  "date_to",
  "search",
  "page",
  "page_size",
] as const;

function splitList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads violation filters from the URL without second-guessing them: the
 * server validates every value and answers 422 per field.
 */
export function readViolationFilters(
  params: URLSearchParams,
): AttendanceViolationFilters {
  return {
    page: positiveInt(params.get("page"), 1),
    page_size: positiveInt(params.get("page_size"), VIOLATION_PAGE_SIZE),
    lifecycle: splitList(params.get("lifecycle")),
    payroll_status: splitList(params.get("payroll_status")),
    employee_profile_id: params.get("employee_profile_id") ?? undefined,
    date_from: params.get("date_from") ?? undefined,
    date_to: params.get("date_to") ?? undefined,
    search: params.get("search") ?? undefined,
  };
}

/** First message per field from a 422 `{errors: [{field, message}]}` body. */
export function fieldErrorsFromResponse(
  error: unknown,
): Record<string, string> {
  const errors = (error as { response?: { data?: { errors?: unknown } } })
    ?.response?.data?.errors;
  const result: Record<string, string> = {};
  if (!Array.isArray(errors)) return result;
  for (const item of errors) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { field?: unknown }).field === "string" &&
      typeof (item as { message?: unknown }).message === "string"
    ) {
      const { field, message } = item as { field: string; message: string };
      if (!(field in result)) result[field] = message;
    }
  }
  return result;
}

type Translate = (
  key: string,
  params?: Record<string, string | number>,
  fallback?: string,
) => string;

const GRACE_REASON_KEYS: Record<GraceReason, string> = {
  attendance_exempt: "attendancePolicy.graceReason.attendanceExempt",
  non_working_day: "attendancePolicy.graceReason.nonWorkingDay",
  late_permission: "attendancePolicy.graceReason.latePermission",
  no_check_in: "attendancePolicy.graceReason.noCheckIn",
  on_time: "attendancePolicy.graceReason.onTime",
  monthly_grace: "attendancePolicy.graceReason.monthlyGrace",
  outside_grace: "attendancePolicy.graceReason.outsideGrace",
  post_grace_tolerance: "attendancePolicy.graceReason.postGraceTolerance",
  post_grace_late: "attendancePolicy.graceReason.postGraceLate",
};

const LIFECYCLE_KEYS: Record<ViolationLifecycle, string> = {
  active: "active",
  void: "void",
  applied: "applied",
  manual_review: "manualReview",
};

const DEDUCTION_STATUS_KEYS: Record<AttendanceDeductionStatus, string> = {
  pending: "pending",
  claimed: "claimed",
  applied: "applied",
  manual_review: "manualReview",
  void: "void",
};

export const LIFECYCLE_COLORS: Record<ViolationLifecycle, string> = {
  active: "orange",
  void: "default",
  applied: "red",
  manual_review: "purple",
};

export const DEDUCTION_STATUS_COLORS: Record<
  AttendanceDeductionStatus,
  string
> = {
  pending: "gold",
  claimed: "blue",
  applied: "red",
  manual_review: "purple",
  void: "default",
};

/** Chip colors: green excuses the day, orange marks it late. */
export const GRACE_REASON_COLORS: Record<GraceReason, string> = {
  attendance_exempt: "blue",
  non_working_day: "blue",
  late_permission: "cyan",
  no_check_in: "default",
  on_time: "green",
  monthly_grace: "gold",
  outside_grace: "orange",
  post_grace_tolerance: "lime",
  post_grace_late: "orange",
};

export function graceReasonLabel(
  t: Translate,
  reason: string | null | undefined,
): string {
  if (!reason) return t("attendancePolicy.graceReason.unknown");
  const key = GRACE_REASON_KEYS[reason as GraceReason];
  return key ? t(key) : reason;
}

export function lifecycleLabel(t: Translate, lifecycle: string): string {
  const key = LIFECYCLE_KEYS[lifecycle as ViolationLifecycle];
  return key ? t(`attendancePolicy.lifecycle.${key}`) : lifecycle;
}

/** What the lifecycle means to the employee, e.g. "Deducted in payroll". */
export function lifecycleHint(t: Translate, lifecycle: string): string {
  const key = LIFECYCLE_KEYS[lifecycle as ViolationLifecycle];
  return key ? t(`attendancePolicy.lifecycleHint.${key}`) : "";
}

export function payrollStatusLabel(
  t: Translate,
  status: string | null | undefined,
): string {
  if (!status) return t("attendancePolicy.payrollStatus.none");
  const key = DEDUCTION_STATUS_KEYS[status as AttendanceDeductionStatus];
  return key ? t(`attendancePolicy.payrollStatus.${key}`) : status;
}

/** Arabic name when the UI is Arabic and one exists, otherwise the default name. */
export function violationEmployeeName(
  violation: Pick<
    AttendanceLateViolation,
    "employee_name" | "employee_name_ar"
  >,
  language: string,
): string {
  if (language === "ar" && violation.employee_name_ar?.trim()) {
    return violation.employee_name_ar;
  }
  return violation.employee_name;
}

const DECIMAL_RE = /^(-?)(\d*)(?:\.(\d*))?$/;

/** True for "0", "0.00", ".0" and similar zero decimal strings. */
export function isZeroDecimal(value: string | null | undefined): boolean {
  if (value == null) return true;
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) return false;
  return /^0*$/.test(match[2] ?? "") && /^0*$/.test(match[3] ?? "");
}

/**
 * Groups thousands in a decimal string and keeps the server's fraction digits,
 * without converting to a float: "1234.50" → "1,234.50", "7.50" → "7.50".
 */
export function formatDecimalString(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "0.00";
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) return value;
  const [, sign, whole = "", fraction] = match;
  const grouped = (whole.replace(/^0+(?=\d)/, "") || "0").replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${sign}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/**
 * Formats a fraction string as a percentage by moving the decimal point, so no
 * binary floating point touches the value: "0.0500" → "5%", "0.0525" → "5.25%".
 */
export function formatFractionAsPercent(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "-";
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) return value;
  const [, sign, whole = "", fraction = ""] = match;
  const digits = whole + fraction.padEnd(2, "0");
  const integerPart = digits
    .slice(0, whole.length + 2)
    .replace(/^0+(?=\d)/, "");
  const fractionPart = digits.slice(whole.length + 2).replace(/0+$/, "");
  return `${sign}${integerPart || "0"}${fractionPart ? `.${fractionPart}` : ""}%`;
}

/** Occurrence 1 is always a zero-amount warning. */
export function isWarningOnlyViolation(
  violation: Pick<
    AttendanceLateViolation,
    "occurrence_number" | "penalty_amount"
  >,
): boolean {
  return (
    violation.occurrence_number <= 1 || isZeroDecimal(violation.penalty_amount)
  );
}

/** The violation fields that decide what its lifecycle means. */
export type ViolationHintSource = {
  lifecycle: string;
  payroll_status: string | null;
  occurrence_number: number;
  penalty_amount: string;
};

/**
 * What a violation's lifecycle means for that violation. A first-occurrence
 * warning stays `active` with no payroll deduction (`payroll_status: null`), so
 * the generic "awaiting payroll" meaning would be wrong for it. Every other
 * state keeps the lifecycle's own wording.
 */
export function violationLifecycleHint(
  t: Translate,
  violation: ViolationHintSource,
): string {
  if (
    violation.lifecycle === "active" &&
    violation.payroll_status == null &&
    isWarningOnlyViolation(violation)
  ) {
    return t("attendancePolicy.lifecycleHint.warningOnly");
  }
  return lifecycleHint(t, violation.lifecycle);
}

/** "8 h 30 min" or "45 min". */
export function formatMinutes(
  t: Translate,
  minutes: number | null | undefined,
) {
  const total = Math.max(0, Math.round(minutes ?? 0));
  if (total < 60) return t("attendancePolicy.minutes", { minutes: total });
  return t("attendancePolicy.hoursMinutes", {
    hours: Math.floor(total / 60),
    minutes: total % 60,
  });
}

/**
 * The backend reuses 403 for two different situations and gives no error code.
 * The BioTime-mapping gate is recognisable only by its message, which the
 * backend never translates; every other 403 is a company-context failure.
 */
const UNMAPPED_MESSAGE_FRAGMENT = "BioTime mapping";

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data;
  return typeof data?.message === "string" ? data.message : "";
}

export function isAttendanceUnmappedError(error: unknown): boolean {
  return (
    getHttpStatus(error) === 403 &&
    errorMessage(error).includes(UNMAPPED_MESSAGE_FRAGMENT)
  );
}

export type AttendanceAccessProblem =
  | "unmapped"
  | "company"
  | "notFound"
  | "other";

/** Branches on the HTTP status; the message only splits the two 403 cases. */
export function classifyAttendanceAccessError(
  error: unknown,
): AttendanceAccessProblem {
  const status = getHttpStatus(error);
  if (status === 404) return "notFound";
  if (status === 403) {
    return isAttendanceUnmappedError(error) ? "unmapped" : "company";
  }
  return "other";
}

export const NOTICE_PAGE_SIZE = 25;

/** URL query keys owned by the HR notice history. */
export const NOTICE_FILTER_PARAMS = [
  "notice_level",
  "employee_profile_id",
  "date_from",
  "date_to",
  "search",
  "page",
  "page_size",
] as const;

/** Reads notice filters from the URL; the server validates every value. */
export function readNoticeFilters(
  params: URLSearchParams,
): AttendanceNoticeFilters {
  return {
    page: positiveInt(params.get("page"), 1),
    page_size: positiveInt(params.get("page_size"), NOTICE_PAGE_SIZE),
    notice_level: splitList(params.get("notice_level")),
    employee_profile_id: params.get("employee_profile_id") ?? undefined,
    date_from: params.get("date_from") ?? undefined,
    date_to: params.get("date_to") ?? undefined,
    search: params.get("search") ?? undefined,
  };
}

export const NOTICE_LEVEL_COLORS: Record<NoticeLevel, string> = {
  1: "blue",
  2: "gold",
  3: "volcano",
  4: "red",
};

function isNoticeLevel(level: number): level is NoticeLevel {
  return (NOTICE_LEVELS as readonly number[]).includes(level);
}

export function noticeLevelLabel(t: Translate, level: number): string {
  return isNoticeLevel(level)
    ? t(`attendancePolicy.notices.level.${level}`)
    : t("attendancePolicy.notices.level.other", { level });
}

/**
 * The level's policy result, worded as on the approved v2 notice. Level 1 is a
 * warning only with no payroll deduction; it never reads as pending payroll.
 */
export function noticeLevelMeaning(t: Translate, level: number): string {
  return isNoticeLevel(level)
    ? t(`attendancePolicy.notices.policy.${level}`)
    : "";
}

export const NOTICE_DELIVERY_COLORS: Record<NoticeDeliveryStatus, string> = {
  scheduled: "blue",
  sent: "green",
  failed: "red",
  skipped: "default",
};

function isNoticeDeliveryStatus(
  status: string,
): status is NoticeDeliveryStatus {
  return (NOTICE_DELIVERY_STATUSES as readonly string[]).includes(status);
}

/** Localized label from `delivery_status`; an unexpected value reads as unknown. */
export function noticeDeliveryLabel(
  t: Translate,
  status: string | null | undefined,
): string {
  if (!status) return t("attendancePolicy.notices.delivery.none");
  return isNoticeDeliveryStatus(status)
    ? t(`attendancePolicy.notices.delivery.${status}`)
    : t("attendancePolicy.notices.delivery.unknown");
}

/**
 * What the delivery status means, in the UI language. It stands in for the
 * server's `delivery_message`, which is English-only and never shown.
 */
export function noticeDeliveryHint(
  t: Translate,
  status: string | null | undefined,
): string {
  return status && isNoticeDeliveryStatus(status)
    ? t(`attendancePolicy.notices.deliveryHint.${status}`)
    : "";
}

/** The backend sends `filename: null` when no PDF is stored for the notice. */
export function hasNoticeDocument(
  notice: Pick<AttendanceLateNotice, "filename">,
): boolean {
  return Boolean(notice.filename?.trim());
}

/** The server's filename without any path, or one built from the reference. */
export function noticeFilename(
  notice: Pick<AttendanceLateNotice, "id" | "filename" | "reference_number">,
): string {
  const base = (notice.filename ?? "").split(/[\\/]/).pop()?.trim();
  if (base) return base;
  const reference = notice.reference_number?.trim() || String(notice.id);
  return `late_attendance_notice_${reference}.pdf`;
}

export type NoticeListProblem =
  | { kind: "forbidden" }
  | { kind: "notFound" }
  | { kind: "error"; message: string };

/** Branches on the HTTP status only. */
export function noticeListProblem(error: unknown): NoticeListProblem {
  const status = getHttpStatus(error);
  if (status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "notFound" };
  return { kind: "error", message: getHttpErrorMessage(error) };
}

/**
 * A failed blob download carries a Blob body, not a readable message, so the
 * translation key is chosen from the HTTP status alone.
 */
export function noticeDownloadErrorKey(error: unknown): string {
  const status = getHttpStatus(error);
  if (status === 404) return "attendancePolicy.notices.downloadNotFound";
  if (status === 403) return "attendancePolicy.notices.downloadForbidden";
  return "attendancePolicy.notices.downloadFailed";
}
