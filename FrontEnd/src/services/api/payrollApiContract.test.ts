import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ api: { request: vi.fn() } }));

import { api } from "./apiClient";
import { setPayrollMocksEnabled } from "./payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "./payrollMocks/handler";
import * as examples from "./payrollMocks/contractExamples";
import {
  clearPayrollEnumCache,
  getEmployeePayrollConfig,
  getPayrollEnums,
  getPayrollSettings,
  getPayrollSettingsHistory,
  getSalaryBases,
  updateEmployeePayrollConfig,
  updatePayrollSettings,
} from "./payrollSettingsApi";
import { cancelRun, createRun, getRun, listPayrollRuns } from "./payrollApi";
import {
  getMyPayslipDetail,
  toEmployeePayslipDetail,
} from "./employeePayslipsApi";
import { parsePayrollError } from "./payrollErrors";

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
});

afterEach(() => {
  setPayrollMocksEnabled(undefined);
});

describe("payroll mocks serve the contract examples", () => {
  it("returns settings S verbatim and never calls the live client", async () => {
    await expect(getPayrollSettings()).resolves.toEqual(examples.settings.data);
    expect(api.request).not.toHaveBeenCalled();
  });

  it("returns the fixed salary-base list and enum directory", async () => {
    const bases = await getSalaryBases();
    expect(bases.map((option) => option.value)).toEqual([
      "BASIC",
      "BASIC_HOUSING",
      "BASIC_HOUSING_TRANSPORT",
      "GROSS",
      "FIXED_AMOUNT",
    ]);
    const enums = await getPayrollEnums();
    expect(enums.validation_codes).toHaveLength(44);
  });

  it("caches the enum directory per language", async () => {
    const first = getPayrollEnums();
    expect(getPayrollEnums()).toBe(first);
  });
});

describe("settings writes follow the contract rules", () => {
  it("requires a reason (422 reason_required on field reason)", async () => {
    const error = await updatePayrollSettings({
      expected_revision: 2,
      reason: "  ",
      provision_proration: "PRORATED_BY_DAYS",
    }).catch((err) => err);
    const parsed = parsePayrollError(error);
    expect(parsed.httpStatus).toBe(422);
    expect(parsed.codes).toEqual(["reason_required"]);
    expect(parsed.fieldErrors[0].name).toEqual(["reason"]);
  });

  it("rejects a stale settings revision with 409 stale_revision", async () => {
    const error = await updatePayrollSettings({
      expected_revision: 1,
      reason: "Policy update",
      provision_proration: "PRORATED_BY_DAYS",
    }).catch((err) => err);
    expect(parsePayrollError(error).isStaleRevision).toBe(true);
  });

  it("applies a sparse change, bumps the revision and records history", async () => {
    const saved = await updatePayrollSettings({
      expected_revision: 2,
      reason: "Annual invoice and draft policies selected",
      provision_proration: "PRORATED_BY_DAYS",
    });
    expect(saved.settings_revision).toBe(3);
    expect(saved.provision_proration).toBe("PRORATED_BY_DAYS");
    const history = await getPayrollSettingsHistory();
    expect(history.items[0]).toMatchObject({
      type: "SETTINGS_CHANGE",
      changed_fields: ["provision_proration"],
      original_value: { provision_proration: "FULL_MONTH" },
      new_value: { provision_proration: "PRORATED_BY_DAYS" },
      reason: "Annual invoice and draft policies selected",
      settings_revision: 3,
    });
  });

  it("treats a no-op PATCH as unchanged (same revision, no history)", async () => {
    const saved = await updatePayrollSettings({
      expected_revision: 2,
      reason: "No change",
      provision_proration: "FULL_MONTH",
    });
    expect(saved.settings_revision).toBe(2);
    expect((await getPayrollSettingsHistory()).count).toBe(0);
  });

  it("rejects numeric rates (decimal strings only)", async () => {
    const error = await updatePayrollSettings({
      expected_revision: 2,
      reason: "x",
      foreign_gosi_rate: "2",
    }).catch((err) => err);
    expect(parsePayrollError(error).codes).toEqual(["invalid_decimal"]);
  });
});

describe("employee GOSI config", () => {
  it("reads and updates the flag with its own revision", async () => {
    const config = await getEmployeePayrollConfig(101);
    expect(config).toEqual(examples.employeeConfig.data);
    const saved = await updateEmployeePayrollConfig(101, {
      expected_revision: 0,
      deduct_gosi_from_employee: true,
      reason: "Employee GOSI bearing arrangement confirmed",
    });
    expect(saved).toEqual(examples.employeeConfigPatched.data);
  });
});

describe("runs", () => {
  it("answers a duplicate period with the legacy string-array 409", async () => {
    const error = await createRun({
      period_start: "2026-09-01",
      period_end: "2026-09-30",
    }).catch((err) => err);
    const parsed = parsePayrollError(error);
    expect(parsed.httpStatus).toBe(409);
    expect(parsed.formMessages).toEqual([
      "Payroll run already exists for this period.",
    ]);
  });

  it("allows re-creating a cancelled period", async () => {
    await cancelRun(7, { expected_revision: 1, reason: "Wrong month" });
    expect((await getRun(7)).status).toBe("CANCELLED");
    const created = await createRun({
      period_start: "2026-09-01",
      period_end: "2026-09-30",
    });
    expect(created.status).toBe("DRAFT");
    const page = await listPayrollRuns({ year: 2026, month: 9 });
    expect(page.items.map((run) => run.status).sort()).toEqual([
      "CANCELLED",
      "DRAFT",
    ]);
  });

  it("accepts a cross-month inclusive period and rejects more than 30 days", async () => {
    const created = await createRun({
      period_start: "2026-10-15",
      period_end: "2026-11-13",
    });
    expect(created).toMatchObject({
      year: 2026,
      month: 11,
      calendar_days: 30,
      period_start: "2026-10-15",
      period_end: "2026-11-13",
    });

    const error = await createRun({
      period_start: "2026-10-15",
      period_end: "2026-11-14",
    }).catch((err) => err);
    expect(parsePayrollError(error)).toMatchObject({
      httpStatus: 422,
      codes: ["invalid_date_range"],
    });

    const reverseError = await createRun({
      period_start: "2026-11-13",
      period_end: "2026-10-15",
    }).catch((err) => err);
    expect(parsePayrollError(reverseError)).toMatchObject({
      httpStatus: 422,
      codes: ["invalid_date_range"],
    });

    const yearError = await createRun({
      period_start: "1899-12-20",
      period_end: "1900-01-01",
    }).catch((err) => err);
    expect(parsePayrollError(yearError)).toMatchObject({
      httpStatus: 422,
      codes: ["invalid_date_range"],
    });
  });
});

describe("employee payslip whitelist", () => {
  const forbidden = [
    "provisions",
    "medical_provision",
    "total_company_cost",
    "cost_incomplete",
    "carry_forward",
    "settings_snapshot",
    "source_id",
    "source_kind",
    "requested_amount",
  ];

  it("drops provision and HR keys even when the payload carries them", async () => {
    const detail = payrollMockState().payslipDetails.get(201)!;
    Object.assign(detail, {
      provisions: [{ type: "MEDICAL", amount: "100.00" }],
      medical_provision: "100.00",
      total_company_cost: "12235.00",
      cost_incomplete: true,
      carry_forward: { uncollected: "5.00" },
      settings_snapshot: {},
    });
    detail.deductions.push({
      type: "GOSI_COMPANY" as never,
      label: "Company GOSI",
      label_key: "payroll.line.gosi_company",
      amount: "180.00",
      quantity: null,
      source_period: null,
      ...{ source_id: "55", source_kind: "loan", requested_amount: "1" },
    });

    const parsed = await getMyPayslipDetail(201);
    const serialized = JSON.stringify(parsed);
    for (const key of forbidden) {
      expect(serialized, key).not.toContain(`"${key}"`);
    }
    expect(parsed.deductions.map((line) => line.type)).toEqual(["ABSENCE"]);
    expect(parsed.net_salary).toBe("10267.00");
  });

  it("keeps the legacy PREVIOUS_TOTAL_DEDUCTIONS line", () => {
    const parsed = toEmployeePayslipDetail({
      ...examples.employeePayslip.data,
      legacy_calculation: true,
      deductions: [
        {
          type: "PREVIOUS_TOTAL_DEDUCTIONS",
          label: "Previous total deductions",
          label_key: "payroll.line.previous_total_deductions",
          amount: "512.75",
          quantity: null,
          source_period: null,
        },
      ],
    });
    expect(parsed.legacy_calculation).toBe(true);
    expect(parsed.deductions[0]).toMatchObject({
      type: "PREVIOUS_TOTAL_DEDUCTIONS",
      amount: "512.75",
    });
  });
});
