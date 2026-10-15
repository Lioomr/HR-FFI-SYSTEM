import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ValidationPanel from "./ValidationPanel";
import { attendanceIssue } from "../../test/payrollFixtures";
import { setPayrollMocksEnabled } from "../../services/api/payrollTransport";
import { clearPayrollEnumCache } from "../../services/api/payrollSettingsApi";
import { useAuthStore, type Role } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";
import { resolveTranslation } from "../../i18n/translate";
import type { ValidationReport } from "../../services/api/payrollTypes";

const en = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation("en", key, params);

function report(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    run_id: 7,
    revision: 1,
    can_finalize: true,
    errors: [],
    warnings: [],
    counts: { errors: 0, warnings: 0 },
    employees_checked: 30,
    excluded_employees_checked: 0,
    reconciliation: {
      total_net: "1.00",
      items_net: "1.00",
      payslips_net: "1.00",
      item_count: 1,
      payslip_count: 1,
      matches: true,
    },
    ...overrides,
  };
}

function renderPanel(value: ValidationReport, role: Role = "HRManager") {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role },
  });
  const onOpenItem = vi.fn();
  render(
    <MemoryRouter>
      <ValidationPanel report={value} onOpenItem={onOpenItem} />
    </MemoryRouter>,
  );
  return onOpenItem;
}

beforeEach(() => {
  setPayrollMocksEnabled(true);
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  setPayrollMocksEnabled(undefined);
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe("ValidationPanel", () => {
  it("hides gating and progress for a legacy run even before finalization", () => {
    render(
      <MemoryRouter>
        <ValidationPanel
          report={report({ can_finalize: false })}
          legacy
          onOpenItem={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(en("payroll.ui.cannotFinalize"))).toBeNull();
    expect(screen.queryByText(en("payroll.ux3.finalizeState"))).toBeNull();
    expect(document.querySelector(".payroll-confirmation-progress")).toBeNull();
  });
  it("retains finalized historical issues as information without confirmation gating", () => {
    renderPanel(
      report({
        finalize_state: "finalized",
        infos: [
          {
            ...attendanceIssue(1),
            severity: "info",
            params: { manual_confirmation_required: true },
          },
        ],
      }),
    );
    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector(".payroll-confirmation-progress")).toBeNull();
    expect(
      screen.queryByText(/need confirmed absence days before finalizing/),
    ).toBeNull();
    expect(screen.queryByText(/Confirmed manually/)).toBeNull();
    expect(screen.getByText("Informational")).toBeInTheDocument();
  });
  it("renders 30 uncovered employees as ONE grouped card, not 30 rows", async () => {
    const warnings = Array.from({ length: 30 }, (_, i) =>
      attendanceIssue(i + 1),
    );
    const onOpenItem = renderPanel(
      report({ warnings, counts: { errors: 0, warnings: 30 } }),
    );
    const title = en("payroll.ui.attendanceSourceGroup", { count: 30 });
    expect(screen.getAllByText(title)).toHaveLength(1);
    expect(document.querySelectorAll(".ant-collapse-item")).toHaveLength(1);

    // Expand: the employees are in one paginated table inside the card.
    fireEvent.click(screen.getByText(title));
    const firstName = await screen.findByRole("button", { name: "Employee 1" });
    fireEvent.click(firstName);
    expect(onOpenItem).toHaveBeenCalledWith(1001);
  });

  it("shows the manual-confirmation error as its own blocking group", () => {
    renderPanel(
      report({
        can_finalize: false,
        errors: [attendanceIssue(1, true)],
        warnings: [attendanceIssue(1)],
        counts: { errors: 1, warnings: 1 },
      }),
    );
    expect(
      screen.getByText(en("payroll.ui.attendanceManualGroup", { count: 1 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.attendanceSourceGroup", { count: 1 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.cannotFinalize")),
    ).toBeInTheDocument();
  });

  it("states clearly when the run can be finalized", () => {
    renderPanel(report());
    expect(screen.getByText(en("payroll.ui.canFinalize"))).toBeInTheDocument();
    expect(screen.getByText(en("payroll.ui.reconciled"))).toBeInTheDocument();
  });

  it("links an excluded employee to the HR profile, but not for CFO", () => {
    const excluded = {
      ...attendanceIssue(5),
      code: "archived_without_date",
      severity: "error" as const,
      message: "Archived employee has no archive date.",
      employee: {
        employee_profile_id: 5,
        employee_id: "EMP-5",
        employee_name: "Archived Person",
        item_id: null,
      },
    };
    renderPanel(
      report({
        can_finalize: false,
        errors: [excluded],
        counts: { errors: 1, warnings: 0 },
      }),
    );
    fireEvent.click(document.querySelector(".ant-collapse-header")!);
    const link = screen.getByRole("link", { name: "Archived Person" });
    expect(link).toHaveAttribute("href", "/hr/employees/5");
  });

  it("shows an excluded employee as plain text for CFO", () => {
    const excluded = {
      ...attendanceIssue(5),
      code: "archived_without_date",
      severity: "error" as const,
      employee: {
        employee_profile_id: 5,
        employee_id: "EMP-5",
        employee_name: "Archived Person",
        item_id: null,
      },
    };
    renderPanel(
      report({
        can_finalize: false,
        errors: [excluded],
        counts: { errors: 1, warnings: 0 },
      }),
      "CFO",
    );
    fireEvent.click(document.querySelector(".ant-collapse-header")!);
    const panel = document.querySelector(".ant-collapse") as HTMLElement;
    expect(within(panel).getByText("Archived Person")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Archived Person" })).toBeNull();
  });
});

it("renders natural coverage detail and hides unknown parameter values until expanded", async () => {
  const issue = attendanceIssue(1);
  issue.params = {
    uncovered_dates: ["2026-09-01"],
    manual_confirmation_required: true,
    unknown_parameter: { source_id: "recorded-source" },
  };
  renderPanel(
    report({ warnings: [issue], counts: { errors: 0, warnings: 1 } }),
  );
  fireEvent.click(document.querySelector(".ant-collapse-header")!);
  expect(await screen.findByText("1 days not covered")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(
    "manual_confirmation_required:",
  );
  expect(document.body.textContent).not.toContain("uncovered_dates:");
  expect(document.body.textContent).not.toContain("unknown_parameter");
  expect(screen.getByText("2026-09-01").closest("bdi")).toHaveAttribute(
    "dir",
    "ltr",
  );
  expect(
    document.querySelectorAll("details:not([open])").length,
  ).toBeGreaterThan(0);
});
