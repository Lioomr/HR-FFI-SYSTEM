import type {
  PayrollSettings,
  PayrollSettingsPatch,
  ProvisionProration,
  SalaryBaseField,
  SalaryBaseSelector,
  SalaryBaseType,
} from "../../../../services/api/payrollTypes";
import {
  moneyToInput,
  percentToRate,
  rateToPercent,
  toMoneyString,
} from "../../../../utils/payrollMoney";

/**
 * Form model for the payroll settings screen. Rates are edited as percentages
 * and money as plain digits; conversion to the contract's decimal strings is
 * done here with string operations only.
 */

export const SALARY_BASE_FIELDS: SalaryBaseField[] = [
  "absence_base",
  "gosi_base",
  "leave_base",
  "eos_base",
  "overtime_base",
];

/**
 * Medical cost has three distinct states that must never be conflated:
 * a known invoice, an unknown invoice (cost incomplete) and no insurance (0).
 */
export type MedicalMode = "amount" | "unknown" | "none";

export interface BaseFormValue {
  type: SalaryBaseType;
  fixed_amount?: string;
}

export interface SettingsFormValues {
  absence_base: BaseFormValue;
  gosi_base: BaseFormValue;
  leave_base: BaseFormValue;
  eos_base: BaseFormValue;
  overtime_base: BaseFormValue;
  foreign_gosi_percent: string;
  saudi_gosi_percent: string;
  medical_mode: MedicalMode;
  annual_medical_invoice?: string;
  monthly_foreign_id_cost: string;
  annual_air_ticket: string;
  provision_proration: ProvisionProration;
  require_manual_absence_confirmation: boolean;
}

/** Server rate field -> form field, so 422 field errors land on the right input. */
export const SETTINGS_FIELD_MAP: Record<string, string> = {
  foreign_gosi_rate: "foreign_gosi_percent",
  saudi_gosi_rate: "saudi_gosi_percent",
};

export function medicalModeOf(settings: PayrollSettings): MedicalMode {
  if (settings.no_medical_insurance) return "none";
  return settings.annual_medical_invoice === null ? "unknown" : "amount";
}

export function toFormValues(settings: PayrollSettings): SettingsFormValues {
  const base = (selector: SalaryBaseSelector): BaseFormValue => ({
    type: selector.type,
    fixed_amount: moneyToInput(selector.fixed_amount),
  });
  return {
    absence_base: base(settings.absence_base),
    gosi_base: base(settings.gosi_base),
    leave_base: base(settings.leave_base),
    eos_base: base(settings.eos_base),
    overtime_base: base(settings.overtime_base),
    foreign_gosi_percent: rateToPercent(settings.foreign_gosi_rate),
    saudi_gosi_percent: rateToPercent(settings.saudi_gosi_rate),
    medical_mode: medicalModeOf(settings),
    annual_medical_invoice: moneyToInput(settings.annual_medical_invoice),
    monthly_foreign_id_cost: moneyToInput(settings.monthly_foreign_id_cost),
    annual_air_ticket: moneyToInput(settings.annual_air_ticket),
    provision_proration: settings.provision_proration,
    require_manual_absence_confirmation:
      settings.require_manual_absence_confirmation,
  };
}

function toSelector(value: BaseFormValue): SalaryBaseSelector {
  return value.type === "FIXED_AMOUNT"
    ? {
        type: value.type,
        fixed_amount: toMoneyString(value.fixed_amount ?? ""),
      }
    : { type: value.type, fixed_amount: null };
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Sparse PATCH body: only the fields whose wire value differs from the loaded
 * settings. Returns null when nothing changed. `reason` and
 * `expected_revision` are added by the caller.
 */
export function buildSettingsChanges(
  settings: PayrollSettings,
  values: SettingsFormValues,
): Omit<PayrollSettingsPatch, "reason" | "expected_revision"> | null {
  const changes: Omit<PayrollSettingsPatch, "reason" | "expected_revision"> =
    {};

  for (const field of SALARY_BASE_FIELDS) {
    const selector = toSelector(values[field]);
    if (!sameJson(selector, settings[field])) changes[field] = selector;
  }

  const foreignRate = percentToRate(values.foreign_gosi_percent);
  if (foreignRate !== settings.foreign_gosi_rate) {
    changes.foreign_gosi_rate = foreignRate;
  }
  const saudiRate = percentToRate(values.saudi_gosi_percent);
  if (saudiRate !== settings.saudi_gosi_rate) {
    changes.saudi_gosi_rate = saudiRate;
  }

  // Medical: the flag decides the calculation; the invoice is kept as is
  // when switching to "no insurance" so its history is not lost.
  const noInsurance = values.medical_mode === "none";
  if (noInsurance !== settings.no_medical_insurance) {
    changes.no_medical_insurance = noInsurance;
  }
  if (
    values.medical_mode === "unknown" &&
    settings.annual_medical_invoice !== null
  ) {
    changes.annual_medical_invoice = null;
  }
  if (values.medical_mode === "amount") {
    const invoice = toMoneyString(values.annual_medical_invoice ?? "");
    if (invoice !== settings.annual_medical_invoice) {
      changes.annual_medical_invoice = invoice;
    }
  }

  const idCost = toMoneyString(values.monthly_foreign_id_cost);
  if (idCost !== settings.monthly_foreign_id_cost) {
    changes.monthly_foreign_id_cost = idCost;
  }
  const airTicket = toMoneyString(values.annual_air_ticket);
  if (airTicket !== settings.annual_air_ticket) {
    changes.annual_air_ticket = airTicket;
  }
  if (values.provision_proration !== settings.provision_proration) {
    changes.provision_proration = values.provision_proration;
  }
  if (
    values.require_manual_absence_confirmation !==
    settings.require_manual_absence_confirmation
  ) {
    changes.require_manual_absence_confirmation =
      values.require_manual_absence_confirmation;
  }

  return Object.keys(changes).length ? changes : null;
}
