import MoneyText from "./MoneyText";
import { postedManualLine, MONEY_FIELDS } from "./itemEditForm";
import type {
  PayrollRunItemDto,
  ZeroSalaryReason,
} from "../../services/api/payrollTypes";
import { isNonNegativeDecimal } from "../../utils/payrollMoney";

export const SOURCE_LABEL_KEYS = {
  employee_salary: "payroll.ui.groupSalary",
  attendance_absence: "payroll.line.absence",
  unpaid_leave: "payroll.ui.unpaidLeaveDays",
  manual_adjustment: "payroll.adjustment.manual_adjustment",
  loan: "payroll.line.loan",
  attendance_penalty: "payroll.line.attendance_penalty",
  penalty: "payroll.ui.penalties",
  carry_forward: "payroll.ui.carriedIn",
  company_settings: "payroll.ui.settingsTitle",
  rent_allocation: "payroll.line.accommodation_cost",
  legacy: "payroll.ui.legacyRun",
};

export const ZERO_REASONS: ZeroSalaryReason[] = [
  "full_leave",
  "full_absence",
  "unpaid_leave",
  "not_joined",
  "suspended",
  "other",
];

const POSTED_LINE_TYPES = {
  bonus: "BONUS",
  incentive: "INCENTIVE",
  other_addition: "OTHER_ADDITION",
} as const;

export const FIELD_LABEL_KEYS: Record<string, string> = {
  overtime_normal_hours: "payroll.ui.overtimeNormalHours",
  weekly_rest_work_days: "payroll.ui.weeklyRestWorkDays",
  official_holiday_work_days: "payroll.ui.officialHolidayWorkDays",
  bonus: "payroll.line.bonus",
  incentive: "payroll.line.incentive",
  other_addition: "payroll.line.other_addition",
  other_deduction: "payroll.line.other_deduction",
};

/** Read-only quantity (day/hour string) or a dash. */
export const qty = (value: string | null | undefined) => (
  <span dir="ltr">{value ?? "—"}</span>
);

export function changeSize(changes: object | null) {
  return changes
    ? Object.values(changes).reduce<number>(
        (count, value) =>
          count +
          (value && typeof value === "object" ? Object.keys(value).length : 1),
        0,
      )
    : 0;
}

export const makeDecimalRule = (t: (key: string) => string) => ({
  validator: (_: unknown, value?: string) =>
    !value || !value.trim() || isNonNegativeDecimal(value)
      ? Promise.resolve()
      : Promise.reject(new Error(t("payroll.ui.invalidAmount"))),
});

/**
 * Read-only evidence beside an entered amount: the posted (rounded) line and,
 * for other deduction, what was actually collected.
 */
export function renderPostedEvidence(
  item: PayrollRunItemDto | null,
  field: (typeof MONEY_FIELDS)[number],
  t: (key: string) => string,
) {
  if (!item) return undefined;
  const line =
    field === "other_deduction"
      ? postedManualLine(item.deductions, "OTHER_DEDUCTION")
      : postedManualLine(item.additions, POSTED_LINE_TYPES[field]);
  if (!line) return undefined;
  const collected =
    field === "other_deduction"
      ? (line.collected_amount ?? line.amount)
      : line.amount;
  return (
    <span>
      {t("payroll.ui.postedAmount")}: <MoneyText amount={collected} size={11} />
    </span>
  );
}
