import { describe, expect, it } from "vitest";
import {
  groupValidationIssues,
  validationPresentation,
  issueFixTarget,
} from "./validationGroups";
import { attendanceIssue } from "../../test/payrollFixtures";

describe("groupValidationIssues", () => {
  it("groups many attendance_source_unavailable warnings into one group", () => {
    const warnings = Array.from({ length: 30 }, (_, i) =>
      attendanceIssue(i + 1),
    );
    const groups = groupValidationIssues({ errors: [], warnings });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      code: "attendance_source_unavailable",
      severity: "warning",
      manualConfirmation: false,
      employeeCount: 30,
    });
    expect(groups[0].issues).toHaveLength(30);
  });

  it("keeps the manual-confirmation error separate and first", () => {
    const groups = groupValidationIssues({
      errors: [attendanceIssue(1, true), attendanceIssue(2, true)],
      warnings: [attendanceIssue(1), attendanceIssue(2), attendanceIssue(3)],
    });
    expect(
      groups.map((group) => [
        group.severity,
        group.manualConfirmation,
        group.employeeCount,
      ]),
    ).toEqual([
      ["error", true, 2],
      ["warning", false, 3],
    ]);
  });

  it("does not count run-level issues as employees", () => {
    const groups = groupValidationIssues({
      errors: [],
      warnings: [
        {
          code: "medical_invoice_missing",
          severity: "warning",
          message: "Medical invoice is missing; company cost is incomplete.",
          message_key: "payroll.validation.medical_invoice_missing",
          employee: null,
          params: {},
        },
      ],
    });
    expect(groups[0].employeeCount).toBe(0);
    expect(groups[0].issues).toHaveLength(1);
  });
});

import { item as itemExample } from "../../services/api/payrollMocks/contractExamples";
import type {
  PayrollRunItemDto,
  ValidationReport,
} from "../../services/api/payrollTypes";
function indexed(confirmed: boolean, id = 1001): PayrollRunItemDto {
  const base = structuredClone(
    itemExample.data,
  ) as unknown as PayrollRunItemDto;
  return {
    ...base,
    id,
    run_revision: 1,
    absence: {
      ...base.absence,
      source_available: false,
      manual_confirmation_required: !confirmed,
      manual_confirmed: confirmed,
    },
  };
}

function validation(): ValidationReport {
  return {
    run_id: 7,
    revision: 1,
    can_finalize: false,
    errors: [attendanceIssue(1, true)],
    warnings: [attendanceIssue(1), attendanceIssue(2)],
    counts: { errors: 1, warnings: 2 },
    employees_checked: 2,
    excluded_employees_checked: 0,
    reconciliation: {
      total_net: "0.00",
      items_net: "0.00",
      payslips_net: "0.00",
      item_count: 2,
      payslip_count: 2,
      matches: true,
    },
  };
}
describe("UX3 validation presentation", () => {
  it("excludes executives from progress and preserves their API warning severity", () => {
    const report = validation();
    const executive = { ...indexed(true), executive_exempt: true };
    const view = validationPresentation(report, [
      executive,
      indexed(false, 1002),
    ]);
    expect(view.progress).toEqual({ total: 1, confirmed: 0 });
    expect(view.warnings).toBe(report.counts.warnings);
    expect(view.blocking).toBe(report.counts.errors);
    expect(view.informational).toBe(0);
    expect(validationPresentation(report, [executive]).progress).toEqual({
      total: 0,
      confirmed: 0,
    });
  });
  it("downgrades only the confirmed warning, preserves a real blocker and the API", () => {
    const report = validation();
    const before = JSON.stringify(report);
    const items = [indexed(true), indexed(false, 1002)];
    const view = validationPresentation(report, items);
    expect(view).toMatchObject({
      warnings: 1,
      blocking: 1,
      informational: 1,
      progress: { confirmed: 1, total: 2 },
    });
    expect(
      groupValidationIssues(report, view.items).map((g) => g.severity),
    ).toEqual(["error", "warning", "info"]);
    expect(report.can_finalize).toBe(false);
    expect(JSON.stringify(report)).toBe(before);
  });
  it.each([null, [{ ...indexed(true), run_revision: 2 }]])(
    "keeps API severity and progress unavailable without matching complete evidence",
    (items) => {
      const report = validation();
      const view = validationPresentation(report, items);
      expect(view.warnings).toBe(2);
      expect(view.progress).toBeNull();
      expect(
        groupValidationIssues(report, view.items).some(
          (g) => g.severity === "info",
        ),
      ).toBe(false);
    },
  );
  it("orders codes and employee ids independently of group counts", () => {
    const report = validation();
    report.errors = [];
    report.warnings = [
      attendanceIssue(2),
      { ...attendanceIssue(1), code: "z_last" },
      attendanceIssue(1),
    ];
    let groups = groupValidationIssues(report);
    expect(groups.map((g) => g.code)).toEqual([
      "attendance_source_unavailable",
      "z_last",
    ]);
    expect(
      groups[0].issues.map((issue) => issue.employee?.employee_id),
    ).toEqual(["EMP-1", "EMP-2"]);
    report.warnings.push(
      { ...attendanceIssue(3), code: "z_last" },
      { ...attendanceIssue(4), code: "z_last" },
    );
    groups = groupValidationIssues(report);
    expect(groups.map((g) => g.code)).toEqual([
      "attendance_source_unavailable",
      "z_last",
    ]);
  });
  it("uses existing routes, correct fields and authorized excluded profiles", () => {
    expect(issueFixTarget(7, attendanceIssue(1), true)).toBe(
      "/hr/payroll/7/employees/1001?tab=absence&field=absence_days_override",
    );
    const excluded = {
      ...attendanceIssue(1),
      code: "archived_without_date",
      employee: { ...attendanceIssue(1).employee!, item_id: null },
    };
    expect(issueFixTarget(7, excluded, true)).toBe("/hr/employees/1");
    expect(issueFixTarget(7, excluded, false)).toBeNull();
    expect(
      issueFixTarget(
        7,
        {
          ...attendanceIssue(1),
          code: "medical_invoice_missing",
          employee: null,
        },
        true,
      ),
    ).toBe("/hr/payroll/settings?field=annual_medical_invoice");
  });
});
