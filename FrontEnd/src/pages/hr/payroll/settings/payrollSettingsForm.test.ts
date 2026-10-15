import { describe, expect, it } from "vitest";
import { settings as settingsExample } from "../../../../services/api/payrollMocks/contractExamples";
import type { PayrollSettings } from "../../../../services/api/payrollTypes";
import {
  buildSettingsChanges,
  medicalModeOf,
  toFormValues,
} from "./payrollSettingsForm";

const settings = settingsExample.data as unknown as PayrollSettings;

describe("payroll settings form model", () => {
  it("shows rates as percentages and money as plain digits", () => {
    const values = toFormValues(settings);
    expect(values.foreign_gosi_percent).toBe("2");
    expect(values.saudi_gosi_percent).toBe("9.75");
    expect(values.monthly_foreign_id_cost).toBe("862.50");
    expect(values.annual_air_ticket).toBe("1500");
    expect(values.medical_mode).toBe("amount");
  });

  it("builds no PATCH when nothing changed", () => {
    expect(buildSettingsChanges(settings, toFormValues(settings))).toBeNull();
  });

  it("sends only changed fields, rates as six-place decimal strings", () => {
    const values = {
      ...toFormValues(settings),
      foreign_gosi_percent: "2.5",
      provision_proration: "PRORATED_BY_DAYS" as const,
    };
    expect(buildSettingsChanges(settings, values)).toEqual({
      foreign_gosi_rate: "0.025000",
      provision_proration: "PRORATED_BY_DAYS",
    });
  });

  it("sends a FIXED_AMOUNT selector with its amount, other types with null", () => {
    const values = toFormValues(settings);
    values.overtime_base = { type: "FIXED_AMOUNT", fixed_amount: "4000" };
    values.absence_base = { type: "BASIC", fixed_amount: "123" };
    expect(buildSettingsChanges(settings, values)).toEqual({
      overtime_base: { type: "FIXED_AMOUNT", fixed_amount: "4000.00" },
      absence_base: { type: "BASIC", fixed_amount: null },
    });
  });

  it("distinguishes an unknown invoice from no medical insurance", () => {
    const unknown = {
      ...toFormValues(settings),
      medical_mode: "unknown" as const,
    };
    expect(buildSettingsChanges(settings, unknown)).toEqual({
      annual_medical_invoice: null,
    });

    const none = { ...toFormValues(settings), medical_mode: "none" as const };
    // The flag controls the calculation; the stored invoice is left untouched.
    expect(buildSettingsChanges(settings, none)).toEqual({
      no_medical_insurance: true,
    });
  });

  it("reads the medical mode from the flag first, then the invoice", () => {
    expect(medicalModeOf(settings)).toBe("amount");
    expect(medicalModeOf({ ...settings, annual_medical_invoice: null })).toBe(
      "unknown",
    );
    expect(medicalModeOf({ ...settings, no_medical_insurance: true })).toBe(
      "none",
    );
  });
});
