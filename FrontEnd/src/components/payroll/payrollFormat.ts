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
