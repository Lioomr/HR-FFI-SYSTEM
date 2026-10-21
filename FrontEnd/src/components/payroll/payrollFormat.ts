import { useAuthStore } from "../../auth/authStore";

/** "September 2026" / "سبتمبر 2026" for a payroll year/month. */
export function formatPayrollPeriod(
  year: number,
  month: number,
  language: string,
): string {
  return new Intl.DateTimeFormat(
    language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-US",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(new Date(Date.UTC(year, month - 1, 1)));
}

function parsePayrollDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

/** Canonical API dates, with month bounds for migrated legacy runs. */
export function payrollPeriodDateBounds(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  year: number,
  month: number,
): { periodStart: string; periodEnd: string } {
  if (parsePayrollDate(periodStart) && parsePayrollDate(periodEnd)) {
    return { periodStart: periodStart!, periodEnd: periodEnd! };
  }
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStart: first,
    periodEnd: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Localized, timezone-safe display of the inclusive date window on a run. */
export function formatPayrollDateWindow(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  language: string,
): string {
  const start = parsePayrollDate(periodStart);
  const end = parsePayrollDate(periodEnd);
  if (!start || !end) return "—";

  const formatter = new Intl.DateTimeFormat(
    language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-US",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  );
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

/** Exact payslip date window, with month fallback for pre-range legacy slips. */
export function formatEmployeePayslipPeriod(
  year: number,
  month: number,
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  language: string,
): string {
  const window = formatPayrollDateWindow(periodStart, periodEnd, language);
  return window === "—" ? formatPayrollPeriod(year, month, language) : window;
}

/** Number of real calendar days in an inclusive server-supplied run window. */
export function payrollWindowDayCount(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): number | null {
  const start = parsePayrollDate(periodStart);
  const end = parsePayrollDate(periodEnd);
  if (!start || !end || end < start) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function formatPayrollWindowSummary(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
  calendarDays: number | null | undefined,
  language: string,
  translate: (key: string, params?: Record<string, unknown>) => string,
  legacyYear?: number,
  legacyMonth?: number,
): string {
  let start = periodStart;
  let end = periodEnd;
  if (
    (!parsePayrollDate(start) || !parsePayrollDate(end)) &&
    legacyYear &&
    legacyMonth
  ) {
    const finalDay = new Date(
      Date.UTC(legacyYear, legacyMonth, 0),
    ).getUTCDate();
    start = `${legacyYear}-${String(legacyMonth).padStart(2, "0")}-01`;
    end = `${legacyYear}-${String(legacyMonth).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}`;
  }

  return translate("payroll.ui.calendarWindow", {
    range: formatPayrollDateWindow(start, end, language),
    days: payrollWindowDayCount(start, end) ?? Math.max(calendarDays ?? 0, 0),
  });
}

/**
 * HR and Admin can open employee profiles and manage accommodation; CFO has
 * payroll access but no HR employee pages (route guard), so names are plain
 * text for CFO. UX only: the backend enforces every permission.
 */
export function useCanManagePayrollHrData(): boolean {
  const role = useAuthStore((state) => state.user?.role);
  return role === "HRManager" || role === "SystemAdmin";
}

/** Contract CQ7: "Bank Transfer" uses payroll.payment_mode.bank_transfer; other values show as sent. */
export function paymentModeLabel(
  mode: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!mode) return "—";
  return mode === "Bank Transfer"
    ? t("payroll.payment_mode.bank_transfer")
    : mode;
}
