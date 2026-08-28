import dayjs from "dayjs";
import type { Dayjs } from "dayjs";

export const EMPLOYEE_LEAVE_BACKDATE_DAYS = 7;

export function isEmployeeLeaveDateDisabled(
  current: Dayjs | null,
  today: Dayjs = dayjs(),
): boolean {
  if (!current) return false;
  const earliestStartDate = today
    .startOf("day")
    .subtract(EMPLOYEE_LEAVE_BACKDATE_DAYS, "day");
  return current.startOf("day").isBefore(earliestStartDate);
}

type LeaveValidationError = { field?: string; message: string };

export function getLeaveValidationErrors(
  error: unknown,
): LeaveValidationError[] {
  const err = error as
    | { apiData?: unknown; response?: { data?: unknown } }
    | undefined;
  const data = (err?.apiData || err?.response?.data) as
    | { errors?: unknown }
    | undefined;
  if (!Array.isArray(data?.errors)) return [];

  return data.errors.flatMap((entry): LeaveValidationError[] => {
    if (typeof entry === "string") {
      const match = entry.match(/^([^:]+):\s*(.+)$/);
      return [{ field: match?.[1], message: match?.[2] || entry }];
    }
    if (entry && typeof entry === "object" && "message" in entry) {
      const item = entry as { field?: unknown; message?: unknown };
      if (typeof item.message === "string") {
        return [
          {
            field: typeof item.field === "string" ? item.field : undefined,
            message: item.message,
          },
        ];
      }
    }
    return [];
  });
}

// ── Annual Leave balance rules ───────────────────────────────────────────────
// The backend is the only authority on balances
// (`Backend/leaves/utils.py::calculate_leave_balance`). Nothing here recomputes
// a balance; these helpers only read the figures it already returned and apply
// the same request rule the API enforces
// (`validate_leave_request_policy`: requested <= floor(remaining) - pending).

export const ANNUAL_LEAVE_CODES = ["ANNUAL", "ANNUAL_LEAVE"];

export function isAnnualLeaveCode(code?: string | null): boolean {
  return ANNUAL_LEAVE_CODES.includes((code || "").toUpperCase());
}

/** Balance shape shared by `leaveApi` and `apiTypes`; DRF sends decimals as strings. */
export type LeaveBalanceLike = {
  leave_code?: string;
  total_days?: number | string;
  used_days?: number | string;
  remaining_days?: number | string;
  pending_days?: number | string;
  requestable_days?: number | string;
  fractional_days?: number | string;
};

export type LeaveBalanceFigures = {
  total: number;
  used: number;
  remaining: number;
  /** Whole days held by requests that are submitted but not yet decided. */
  pending: number;
  /** The maximum the employee may request; 0 when the backend omitted it. */
  requestable: number;
  /** Sub-day remainder, informational only. */
  fractional: number;
  /** False for an older payload without the accrual fields. */
  hasRequestableDays: boolean;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readLeaveBalanceFigures(
  balance?: LeaveBalanceLike | null,
): LeaveBalanceFigures {
  return {
    total: toNumber(balance?.total_days),
    used: toNumber(balance?.used_days),
    remaining: toNumber(balance?.remaining_days),
    pending: toNumber(balance?.pending_days),
    requestable: toNumber(balance?.requestable_days),
    fractional: toNumber(balance?.fractional_days),
    hasRequestableDays:
      balance?.requestable_days !== undefined &&
      balance?.requestable_days !== null,
  };
}

export type AnnualLeaveDaysIssue =
  | { code: "decimal_days" }
  | { code: "exceeds_requestable"; requestable: number; pending: number };

/**
 * Applies the Annual Leave request rule to an already-fetched balance.
 *
 * `requestable_days` is the limit — not `total_days` and not `remaining_days`,
 * both of which still include days reserved by pending requests and the
 * sub-day remainder that can never be taken as leave.
 */
export function validateAnnualLeaveDays(
  requestedDays: number,
  balance?: LeaveBalanceLike | null,
): AnnualLeaveDaysIssue | null {
  if (!Number.isFinite(requestedDays) || requestedDays <= 0) return null;
  if (!Number.isInteger(requestedDays)) return { code: "decimal_days" };

  const figures = readLeaveBalanceFigures(balance);
  if (!figures.hasRequestableDays) return null;
  if (requestedDays > figures.requestable) {
    return {
      code: "exceeds_requestable",
      requestable: figures.requestable,
      pending: figures.pending,
    };
  }
  return null;
}

type TranslateFn = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => string;

export function annualLeaveDaysIssueMessage(
  issue: AnnualLeaveDaysIssue,
  t: TranslateFn,
): string {
  if (issue.code === "decimal_days") {
    return t("leave.annual.wholeDaysOnly");
  }
  return t("leave.annual.exceedsRequestable", {
    requestable: String(issue.requestable),
    pending: String(issue.pending),
  });
}
