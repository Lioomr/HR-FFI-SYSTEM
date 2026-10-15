import type {
  AdditionLineType,
  MonthlySalaryKey,
  PayrollItemChanges,
  PayrollMoneyLine,
  PayrollRunItemDto,
  SuspendedPayDecision,
  ValidationIssue,
  ZeroSalaryReason,
} from "../../services/api/payrollTypes";
import { moneyToInput, toMoneyString } from "../../utils/payrollMoney";

/**
 * Form model of the item edit drawer (contract 7.4). Builds the SPARSE
 * `changes` object: only fields the user actually changed are sent, so a
 * prefilled value that was left alone can never overwrite server data.
 *
 * The salary editor prefills from item.monthly_salary_components (v0.5.2):
 * PATCH takes MONTHLY amounts, while the item's salary scalars/lines are PAID
 * (prorated) amounts and must never be used as the prefill.
 */

export interface ItemFormValues {
  /** "" = no override (the observed absence applies). */
  absence_days_override: string;
  overtime_normal_hours: string;
  weekly_rest_work_days: string;
  official_holiday_work_days: string;
  bonus: string;
  incentive: string;
  other_addition: string;
  other_deduction: string;
  override_overtime_eligibility: boolean;
  zero_salary_reason: ZeroSalaryReason | null;
  zero_salary_reason_detail: string;
  suspended_pay_decision: SuspendedPayDecision | null;
  /** Monthly salary inputs; empty strings when the item has none (legacy). */
  salary: Record<MonthlySalaryKey, string>;
}

export const SALARY_KEYS: MonthlySalaryKey[] = [
  "basic_salary",
  "accommodation_allowance",
  "transportation_allowance",
  "telephone_allowance",
  "petrol_allowance",
  "other_allowance",
];

type MoneyField = "bonus" | "incentive" | "other_addition" | "other_deduction";
type QuantityField =
  | "overtime_normal_hours"
  | "weekly_rest_work_days"
  | "official_holiday_work_days";

export const MONEY_FIELDS: MoneyField[] = [
  "bonus",
  "incentive",
  "other_addition",
  "other_deduction",
];
export const QUANTITY_FIELDS: QuantityField[] = [
  "overtime_normal_hours",
  "weekly_rest_work_days",
  "official_holiday_work_days",
];

/**
 * The posted (rounded) manual line of a type, shown as read-only evidence next
 * to the entered value. Carried-in amounts are excluded.
 */
export function postedManualLine(
  lines: PayrollMoneyLine[],
  type: AdditionLineType | "OTHER_DEDUCTION",
): PayrollMoneyLine | undefined {
  const candidates = lines.filter(
    (line) => line.type === type && !line.carried_in,
  );
  return (
    candidates.find((line) => line.source_kind === "manual_adjustment") ??
    candidates[0]
  );
}

export function itemToFormValues(item: PayrollRunItemDto): ItemFormValues {
  // v0.5.3: prefill from the ENTERED values, never from rounded/collected lines.
  const inputs = item.manual_inputs;
  return {
    absence_days_override: moneyToInput(inputs.absence_days_override),
    overtime_normal_hours: moneyToInput(inputs.overtime_normal_hours),
    weekly_rest_work_days: moneyToInput(inputs.weekly_rest_work_days),
    official_holiday_work_days: moneyToInput(inputs.official_holiday_work_days),
    bonus: moneyToInput(inputs.bonus),
    incentive: moneyToInput(inputs.incentive),
    other_addition: moneyToInput(inputs.other_addition),
    other_deduction: moneyToInput(inputs.other_deduction),
    override_overtime_eligibility: inputs.override_overtime_eligibility,
    zero_salary_reason: item.zero_salary_reason,
    zero_salary_reason_detail: item.zero_salary_reason_detail ?? "",
    suspended_pay_decision: item.suspended_pay_decision,
    salary: Object.fromEntries(
      SALARY_KEYS.map((key) => [
        key,
        moneyToInput(item.monthly_salary_components?.[key] ?? null),
      ]),
    ) as Record<MonthlySalaryKey, string>,
  };
}

/** "" and "0" both mean zero for an amount/quantity; compared as wire strings. */
const wire = (value: string | undefined | null) =>
  toMoneyString(!value || value.trim() === "" ? "0" : value.trim());

export function buildItemChanges(
  item: PayrollRunItemDto,
  values: ItemFormValues,
): PayrollItemChanges | null {
  const initial = itemToFormValues(item);
  const changes: PayrollItemChanges = {};

  // Absence override: blank clears it (null); "0" is an explicit 0-day confirmation.
  const overrideNow = (values.absence_days_override ?? "").trim();
  const overrideBefore = initial.absence_days_override.trim();
  if (overrideNow === "" && overrideBefore !== "") {
    changes.absence_days_override = null;
  } else if (
    overrideNow !== "" &&
    (overrideBefore === "" || wire(overrideNow) !== wire(overrideBefore))
  ) {
    changes.absence_days_override = toMoneyString(overrideNow);
  }

  for (const field of QUANTITY_FIELDS) {
    if (wire(values[field]) !== wire(initial[field])) {
      changes[field] = wire(values[field]);
    }
  }
  for (const field of MONEY_FIELDS) {
    if (wire(values[field]) !== wire(initial[field])) {
      changes[field] = wire(values[field]);
    }
  }

  if (
    values.override_overtime_eligibility !==
    initial.override_overtime_eligibility
  ) {
    changes.override_overtime_eligibility =
      values.override_overtime_eligibility;
  }

  const reason = values.zero_salary_reason ?? null;
  if (reason !== initial.zero_salary_reason) {
    changes.zero_salary_reason = reason;
  }
  const detail = (values.zero_salary_reason_detail ?? "").trim();
  if (reason === "other") {
    if (detail !== (initial.zero_salary_reason_detail ?? "").trim()) {
      changes.zero_salary_reason_detail = detail || null;
    }
  } else if (
    initial.zero_salary_reason_detail &&
    changes.zero_salary_reason !== undefined
  ) {
    // Leaving "other" drops its detail.
    changes.zero_salary_reason_detail = null;
  }

  if (
    values.suspended_pay_decision &&
    values.suspended_pay_decision !== initial.suspended_pay_decision
  ) {
    changes.suspended_pay_decision = values.suspended_pay_decision;
  }

  // Run-only monthly salary: only the keys the user changed (never paid amounts).
  if (item.monthly_salary_components) {
    const salaryChanges: Partial<Record<MonthlySalaryKey, string>> = {};
    for (const key of SALARY_KEYS) {
      const now = values.salary?.[key] ?? initial.salary[key];
      if (wire(now) !== wire(initial.salary[key]))
        salaryChanges[key] = wire(now);
    }
    if (Object.keys(salaryChanges).length) {
      changes.salary_components = salaryChanges;
    }
  }

  return Object.keys(changes).length ? changes : null;
}

/** Server field `changes.bonus` -> form field `bonus`. */
export const ITEM_FIELD_MAP: Record<string, string> = Object.fromEntries(
  [
    "absence_days_override",
    ...QUANTITY_FIELDS,
    ...MONEY_FIELDS,
    "override_overtime_eligibility",
    "zero_salary_reason",
    "zero_salary_reason_detail",
    "suspended_pay_decision",
  ]
    .map((field) => [`changes.${field}`, field])
    .concat(
      SALARY_KEYS.map((key) => [
        `changes.salary_components.${key}`,
        `salary.${key}`,
      ]),
    ),
);

/** Show the suspended-pay choice only for suspended employees. */
export function needsSuspendedDecision(
  item: PayrollRunItemDto,
  reportIssues: ValidationIssue[] = [],
): boolean {
  // Live API (F4): blocking errors such as suspended_pay_decision_required are
  // only in the validation report, not in item.warnings, and the item has no
  // employment status, so the report's issues for this item are consulted too.
  return (
    item.suspended_pay_decision !== null ||
    [...item.warnings, ...reportIssues].some(
      (issue) => issue.code === "suspended_pay_decision_required",
    )
  );
}
