import { describe, expect, it } from "vitest";
import { item as itemExample } from "../../services/api/payrollMocks/contractExamples";
import type {
  PayrollMoneyLine,
  PayrollRunItemDto,
} from "../../services/api/payrollTypes";
import {
  buildItemChanges,
  itemToFormValues,
  needsSuspendedDecision,
} from "./itemEditForm";

const baseItem = () =>
  JSON.parse(JSON.stringify(itemExample.data)) as unknown as PayrollRunItemDto;

const otherDeduction = (
  requested: string,
  collected: string,
): PayrollMoneyLine => ({
  id: 900,
  type: "OTHER_DEDUCTION",
  label: "Other Deduction",
  label_key: "payroll.line.other_deduction",
  amount: collected,
  quantity: null,
  source_kind: "manual_adjustment",
  source_id: null,
  source_period: { year: 2026, month: 9 },
  requested_amount: requested,
  collected_amount: collected,
  uncollected_amount: "0.00",
  carried_in: false,
});

describe("item edit form", () => {
  it("sends nothing when nothing changed", () => {
    const item = baseItem();
    expect(buildItemChanges(item, itemToFormValues(item))).toBeNull();
  });

  it("sends only the changed fields as decimal strings", () => {
    const item = baseItem();
    const values = {
      ...itemToFormValues(item),
      overtime_normal_hours: "4",
      bonus: "250",
    };
    expect(buildItemChanges(item, values)).toEqual({
      overtime_normal_hours: "4.00",
      bonus: "250.00",
    });
  });

  it("distinguishes clearing the absence override from an explicit 0", () => {
    const item = baseItem();
    expect(
      buildItemChanges(item, {
        ...itemToFormValues(item),
        absence_days_override: "0",
      }),
    ).toEqual({ absence_days_override: "0.00" });

    item.manual_inputs.absence_days_override = "1.00";
    const values = itemToFormValues(item);
    expect(values.absence_days_override).toBe("1");
    expect(
      buildItemChanges(item, { ...values, absence_days_override: "" }),
    ).toEqual({ absence_days_override: null });
  });

  it("prefills from manual_inputs: entered 250.50 bonus, not the posted 251", () => {
    const item = baseItem();
    item.manual_inputs.bonus = "250.50";
    item.bonus = "251.00";
    item.additions.push({
      ...otherDeduction("251.00", "251.00"),
      type: "BONUS",
      label: "Bonus",
      label_key: "payroll.line.bonus",
    });
    const values = itemToFormValues(item);
    expect(values.bonus).toBe("250.50");
    // Untouched prefill sends nothing.
    expect(buildItemChanges(item, values)).toBeNull();
  });

  it("prefills other deduction from the entered value, not the capped collection", () => {
    const item = baseItem();
    item.manual_inputs.other_deduction = "500.00";
    item.deductions.push(otherDeduction("500.00", "120.00"));
    expect(itemToFormValues(item).other_deduction).toBe("500");
  });

  it("requires nothing extra for a zero-pay reason but sends its detail for other", () => {
    const item = baseItem();
    expect(
      buildItemChanges(item, {
        ...itemToFormValues(item),
        zero_salary_reason: "other",
        zero_salary_reason_detail: "Employee has not started paid work",
      }),
    ).toEqual({
      zero_salary_reason: "other",
      zero_salary_reason_detail: "Employee has not started paid work",
    });
  });

  it("offers the suspended decision only when it applies", () => {
    const item = baseItem();
    expect(needsSuspendedDecision(item)).toBe(false);
    item.warnings.push({
      code: "suspended_pay_decision_required",
      severity: "error",
      message:
        "Choose full pay or zero pay with suspended reason for this run.",
      message_key: "payroll.validation.suspended_pay_decision_required",
      employee: null,
      params: {},
    });
    expect(needsSuspendedDecision(item)).toBe(true);
  });

  it("prefills the salary editor from MONTHLY inputs, never the paid amounts", () => {
    const item = baseItem();
    // A mid-month joiner: paid scalars are half of the monthly inputs.
    item.basic_salary = "3000.00";
    item.monthly_salary_components = {
      basic_salary: "6000.00",
      accommodation_allowance: "3000.00",
      transportation_allowance: "1500.00",
      telephone_allowance: "0.00",
      petrol_allowance: "0.00",
      other_allowance: "500.00",
    };
    const values = itemToFormValues(item);
    expect(values.salary.basic_salary).toBe("6000");
    expect(buildItemChanges(item, values)).toBeNull();
    expect(
      buildItemChanges(item, {
        ...values,
        salary: { ...values.salary, basic_salary: "6100" },
      }),
    ).toEqual({ salary_components: { basic_salary: "6100.00" } });
  });

  it("never sends salary changes for a legacy item without monthly inputs", () => {
    const item = baseItem();
    item.monthly_salary_components = null;
    const values = itemToFormValues(item);
    expect(
      buildItemChanges(item, {
        ...values,
        salary: { ...values.salary, basic_salary: "1" },
      }),
    ).toBeNull();
  });

  it("offers the suspended decision when only the validation report flags it (live API)", () => {
    const item = baseItem();
    expect(needsSuspendedDecision(item, [])).toBe(false);
    expect(
      needsSuspendedDecision(item, [
        {
          code: "suspended_pay_decision_required",
          severity: "error",
          message:
            "Choose full pay or zero pay with suspended reason for this run.",
          message_key: "payroll.validation.suspended_pay_decision_required",
          employee: {
            employee_profile_id: 101,
            employee_id: "EMP-001",
            employee_name: "Example Employee",
            item_id: 71,
          },
          params: {},
        },
      ]),
    ).toBe(true);
  });
});
