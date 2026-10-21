import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { ConfigProvider } from "antd";
const fileSystemModule = "node:fs";
const { readFileSync } = (await import(fileSystemModule)) as {
  readFileSync(path: string, encoding: "utf8"): string;
};
const payrollStyles = readFileSync(
  "src/components/payroll/payroll.css",
  "utf8",
);
import PayrollEmployeePage from "./PayrollEmployeePage";
import * as api from "../../../../services/api/payrollApi";
import * as examples from "../../../../services/api/payrollMocks/contractExamples";
import type {
  PayrollRunDto,
  PayrollHistoryEntry,
  PayrollRunItemDto,
  ValidationReport,
} from "../../../../services/api/payrollTypes";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";
import { useAuthStore } from "../../../../auth/authStore";
import { clearPayrollEnumCache } from "../../../../services/api/payrollSettingsApi";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import { moneyToInput } from "../../../../utils/payrollMoney";
import { type PayrollEmployeeSession } from "../../../../components/payroll/payrollNavigation";
vi.mock("../../../../services/api/payrollApi", () => ({
  getRun: vi.fn(),
  getRunItem: vi.fn(),
  getValidationReport: vi.fn(),
  listRunItems: vi.fn(),
  patchRunItem: vi.fn(),
  listItemAdjustments: vi.fn(),
}));
let rows: PayrollRunItemDto[];
let run: PayrollRunDto;
let report: ValidationReport;
const t = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation(useI18nStore.getState().language, key, params);
beforeEach(async () => {
  configure({ asyncUtilTimeout: 8000 });
  vi.clearAllMocks();
  for (const fn of Object.values(api))
    if (vi.isMockFunction(fn)) fn.mockReset();
  setPayrollMocksEnabled(true);
  clearPayrollEnumCache();
  await useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    user: { id: "employee-test", email: "hr@test", role: "HRManager" },
    isAuthenticated: true,
  });
  run = structuredClone(examples.run.data) as unknown as PayrollRunDto;
  run.id = 7;
  run.revision = 1;
  run.status = "DRAFT";
  report = structuredClone(
    examples.validationReport.data,
  ) as unknown as ValidationReport;
  report.revision = 1;
  report.errors = [];
  report.warnings = [];
  const base = structuredClone(
    examples.item.data,
  ) as unknown as PayrollRunItemDto;
  base.run_revision = 1;
  base.manual_inputs.absence_days_override = null;
  rows = [
    { ...base, id: 71, employee_name: "First" },
    { ...structuredClone(base), id: 72, employee_name: "Second" },
    { ...structuredClone(base), id: 73, employee_name: "Third" },
  ];
  vi.mocked(api.getRun).mockImplementation(async () => structuredClone(run));
  vi.mocked(api.getRunItem).mockImplementation(async (_run, id) =>
    structuredClone(rows.find((row) => row.id === Number(id))!),
  );
  vi.mocked(api.getValidationReport).mockImplementation(async () =>
    structuredClone(report),
  );
  // Deliberately span API pages to prove navigation follows the complete index.
  vi.mocked(api.listRunItems).mockImplementation(async (_run, query) => ({
    items: structuredClone(
      query?.page === 2 ? rows.slice(2) : rows.slice(0, 2),
    ),
    page: query?.page ?? 1,
    page_size: 2,
    count: 3,
    total_pages: 2,
  }));
  vi.mocked(api.listItemAdjustments).mockResolvedValue({
    items: [],
    page: 1,
    page_size: 25,
    count: 0,
    total_pages: 1,
  });
  vi.mocked(api.patchRunItem).mockImplementation(async (_run, id, payload) => {
    run.revision++;
    report.revision = run.revision;
    rows = rows.map((row) => ({
      ...row,
      run_revision: run.revision,
      ...(row.id === Number(id)
        ? {
            manual_inputs: { ...row.manual_inputs, ...payload.changes },
            absence:
              payload.changes.absence_days_override !== undefined
                ? {
                    ...row.absence,
                    manual_confirmed:
                      payload.changes.absence_days_override !== null,
                    override_days: payload.changes.absence_days_override,
                  }
                : row.absence,
          }
        : {}),
    }));
    return structuredClone(rows.find((row) => row.id === Number(id))!);
  });
});
afterEach(() => {
  cleanup();
  configure({ asyncUtilTimeout: 1000 });
  vi.restoreAllMocks();
  setPayrollMocksEnabled(undefined);
});
function mount(state?: PayrollEmployeeSession) {
  const router = createMemoryRouter(
    [
      {
        path: "/hr/payroll/:run_id/employees/:item_id",
        element: <PayrollEmployeePage />,
      },
      { path: "/hr/payroll/:run_id", element: <div>List restored</div> },
    ],
    {
      initialEntries: [
        "/hr/payroll/7",
        { pathname: "/hr/payroll/7/employees/71", state },
      ],
      initialIndex: 1,
    },
  );
  render(
    <ConfigProvider direction={useI18nStore.getState().direction}>
      <RouterProvider router={router} />
    </ConfigProvider>,
  );
  return router;
}
async function ready() {
  await screen.findByRole("tab", { name: t("layout.menu.overview") });
}
function tab(key: string) {
  fireEvent.click(screen.getByRole("tab", { name: t(key) }));
}
function edit(key: string, value: string) {
  fireEvent.change(screen.getByLabelText(t(key)), { target: { value } });
}
function save() {
  fireEvent.click(
    screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
  );
}
describe("PayrollEmployeePage", () => {
  it("shows the executive summary marker without required confirmation", async () => {
    rows[0] = {
      ...rows[0],
      executive_exempt: true,
      absence: {
        ...rows[0].absence,
        manual_confirmation_required: true,
        manual_confirmed: false,
      },
    };
    mount();
    expect(
      await screen.findByText("Executive - attendance checks not applicable"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^Absence$/ }));
    expect(screen.queryByText(t("payroll.ui.confirmationRequired"))).toBeNull();
  });
  it("leaves focused Select and Input inner controls without the custom outline", async () => {
    rows[0]!.net_salary = "0.00";
    const style = document.createElement("style");
    style.textContent =
      ".ant-input,.ant-select-input{outline:none;}" +
      payrollStyles.replaceAll("var(--payroll-focus)", "black");
    document.head.append(style);
    try {
      mount();
      await ready();
      const select = screen.getByRole("combobox", {
        name: t("payroll.ui.zeroSalaryReason"),
      });
      select.focus();
      expect(getComputedStyle(select).outline).toBe("none");
      const input = screen.getByRole("textbox", {
        name: t("payroll.line.basic_salary"),
      });
      input.focus();
      expect(getComputedStyle(input).outline).toBe("none");
    } finally {
      style.remove();
    }
  }, 45000);
  it.each(["en", "ar"] as const)(
    "aligns the save bar at the field bottom and keeps the counter within Reason (%s)",
    async (language) => {
      await useI18nStore.getState().setLanguage(language);
      const style = document.createElement("style");
      style.textContent = payrollStyles;
      document.head.append(style);
      try {
        mount();
        await ready();
        const bar = document.querySelector(".payroll-employee-save")!;
        expect(getComputedStyle(bar).alignItems).toBe("flex-end");
        const count = bar.querySelector(".ant-input-data-count")!;
        expect(count.closest(".ant-form-item")?.querySelector("textarea")).toBe(
          screen.getByRole("textbox", { name: t("payroll.ui.reasonLabel") }),
        );
        expect(getComputedStyle(count).bottom).toBe("4px");
      } finally {
        style.remove();
      }
    },
    45000,
  );
  it.each(["contract", "live"])(
    "explains an unchanged zero confirmation with its recorded actor/time and disables no-op Save (%s)",
    async (shape) => {
      rows[0]!.absence.manual_confirmed = true;
      rows[0]!.manual_inputs.absence_days_override = "0.00";
      const history = structuredClone(
        examples.itemAdjustmentsPage.data.items[0]!,
      ) as unknown as PayrollHistoryEntry;
      history.new_value =
        shape === "live"
          ? { overrides: { absence_days_override: "0.00" }, effective: {} }
          : {
              "absence.override_days": "0.00",
              "absence.effective_days": "0.00",
            };
      vi.mocked(api.listItemAdjustments).mockResolvedValue({
        items: [history],
        page: 1,
        page_size: 25,
        count: 1,
        total_pages: 1,
      });
      mount();
      await ready();
      tab("payroll.ui.absenceTitle");
      edit("payroll.ui.absenceOverride", "0.00");
      expect(
        await screen.findByText(
          new RegExp(t("payroll.employee.alreadyConfirmed", { days: "0" })),
        ),
      ).toBeInTheDocument();
      expect(await screen.findByText(/Example HR/)).toHaveTextContent(
        "2026-10-11",
      );
      expect(
        screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
      ).toBeDisabled();
      edit("payroll.ui.absenceOverride", "1");
      expect(
        screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
      ).toBeEnabled();
      edit("payroll.ui.absenceOverride", "0");
      expect(
        screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
      ).toBeDisabled();
      expect(api.patchRunItem).not.toHaveBeenCalled();
    },
    45000,
  );
  it.each(["positive", "zero", "suspended", "existing"])(
    "shows zero-pay reason only for the applicable state (%s)",
    async (state) => {
      rows[0]!.net_salary = state === "zero" ? "0.00" : "6000.00";
      rows[0]!.zero_salary_reason = state === "existing" ? "other" : null;
      rows[0]!.suspended_pay_decision =
        state === "suspended" ? "ZERO_PAY" : null;
      mount();
      await ready();
      if (state === "positive") {
        expect(
          screen.queryByRole("combobox", {
            name: t("payroll.ui.zeroSalaryReason"),
          }),
        ).not.toBeInTheDocument();
      } else {
        expect(
          screen.getByRole("combobox", {
            name: t("payroll.ui.zeroSalaryReason"),
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByText(t("payroll.employee.zeroReasonHelp")),
        ).toBeInTheDocument();
      }
      if (state === "existing")
        expect(
          screen.getByLabelText(t("payroll.ui.zeroSalaryDetail")),
        ).toBeInTheDocument();
    },
    45000,
  );
  it("renders the employee name once in the header as the profile-linked title", async () => {
    mount();
    await ready();
    const heading = screen.getByRole("heading", { name: "First", level: 2 });
    expect(
      within(heading).getByRole("link", { name: "First" }),
    ).toHaveAttribute("href", `/hr/employees/${rows[0]!.employee_profile_id}`);
    expect(
      within(heading.closest(".page-header")!).getAllByText("First"),
    ).toHaveLength(1);
    expect(
      within(heading.closest(".page-header")!).getByText(
        "Sep 1, 2026 – Sep 30, 2026 · 30 calendar days",
      ),
    ).toBeInTheDocument();
  }, 45000);
  it("points Fix actions to editable fields or the existing company setup screen", async () => {
    const employee = {
      item_id: 71,
      employee_profile_id: 101,
      employee_id: "EMP-001",
      employee_name: "First",
    };
    report.errors = [
      {
        code: "attendance_source_unavailable",
        severity: "error",
        message: "Confirm attendance",
        message_key: "payroll.validation.attendance_source_unavailable",
        employee,
        params: {},
      },
    ];
    report.warnings = [
      {
        code: "medical_invoice_missing",
        severity: "warning",
        message: "Invoice is missing",
        message_key: "payroll.validation.medical_invoice_missing",
        employee,
        params: {},
      },
    ];
    mount();
    await ready();
    const fix = await screen.findByRole("button", {
      name: t("payroll.employee.fix"),
    });
    fireEvent.click(fix);
    expect(
      screen.getByRole("tab", { name: t("payroll.ui.absenceTitle") }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("link", { name: t("payroll.employee.fix") }),
    ).toHaveAttribute("href", "/hr/payroll/settings");
  }, 45000);
  it("uses index order across server pages, J/K outside fields, and restores list state", async () => {
    const list = {
      page: 2,
      pageSize: 25,
      search: "",
      attention: false,
      status: "all",
      scroll: 700,
      columns: {
        salary: true,
        additions: false,
        deductions: true,
        provisions: false,
        details: false,
      },
    };
    const router = mount({ list });
    await ready();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("common.next")),
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toContain("/72"),
    );
    await waitFor(() => expect(api.getRunItem).toHaveBeenCalledWith("7", 72));
    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() =>
      expect(router.state.location.pathname).toContain("/73"),
    );
    await waitFor(() => expect(api.getRunItem).toHaveBeenCalledWith("7", 73));
    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() =>
      expect(router.state.location.pathname).toContain("/72"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("hr.employees.backToList") }),
    );
    await screen.findByText("List restored");
    expect(router.state.location.state.payrollList).toEqual(list);
  }, 45000);
  it("follows the current filter and freezes its order after confirmation", async () => {
    rows[1]!.absence.manual_confirmed = true;
    rows[0]!.absence.manual_confirmation_required = true;
    rows[2]!.absence.manual_confirmation_required = true;
    const router = mount({
      list: {
        page: 1,
        pageSize: 25,
        search: "",
        attention: false,
        status: "confirmation",
        scroll: 0,
      },
    });
    await ready();
    tab("payroll.ui.absenceTitle");
    edit("payroll.ui.absenceOverride", "0");
    edit("payroll.ui.reasonLabel", "Reviewed");
    save();
    await waitFor(() => expect(api.patchRunItem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listRunItems).toHaveBeenCalledTimes(4));
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("common.next")),
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toContain("/73"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("payroll.employee.previous")),
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toContain("/71"),
    );
  }, 45000);
  it("guards Back, Previous/Next, programmatic browser navigation and beforeunload", async () => {
    const router = mount();
    await ready();
    tab("payroll.ui.absenceTitle");
    edit("payroll.ui.absenceOverride", "2");
    const days = screen.getByLabelText(t("payroll.ui.absenceOverride"));
    fireEvent.keyDown(days, { key: "j" });
    expect(router.state.location.pathname).toContain("/71");
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("common.next")),
      }),
    );
    await screen.findByRole("dialog");
    expect(router.state.location.pathname).toContain("/71");
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    fireEvent.click(
      screen.getByRole("button", { name: t("hr.employees.backToList") }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    act(() => {
      void router.navigate(-1);
    });
    await screen.findByRole("dialog");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("payroll.ui.discardChanges"),
      }),
    );
    await screen.findByText("List restored");
    expect(api.patchRunItem).not.toHaveBeenCalled();
  }, 45000);
  it("saves sparse values with required reason and carries the returned revision", async () => {
    mount();
    await ready();
    tab("payroll.ui.absenceTitle");
    edit("payroll.ui.absenceOverride", "0");
    save();
    await screen.findByText(t("payroll.ui.reasonRequired"));
    expect(api.patchRunItem).not.toHaveBeenCalled();
    edit("payroll.ui.reasonLabel", "Attendance reviewed");
    save();
    await waitFor(() =>
      expect(api.patchRunItem).toHaveBeenCalledWith("7", 71, {
        expected_revision: 1,
        changes: { absence_days_override: "0.00" },
        reason: "Attendance reviewed",
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(t("payroll.ui.reasonLabel"))).toHaveValue(
        "",
      ),
    );
    tab("payroll.employee.additions");
    edit("payroll.line.bonus", "250.50");
    edit("payroll.ui.reasonLabel", "Bonus approved");
    save();
    await waitFor(() =>
      expect(api.patchRunItem).toHaveBeenNthCalledWith(2, "7", 71, {
        expected_revision: 2,
        changes: { bonus: "250.50" },
        reason: "Bonus approved",
      }),
    );
  }, 45000);
  it("stops on 409, reloads current values, blocks saves until explicit review, and never retries", async () => {
    vi.mocked(api.patchRunItem).mockRejectedValueOnce({
      response: { status: 409, data: examples.error409Stale },
    });
    mount();
    await ready();
    tab("payroll.ui.absenceTitle");
    edit("payroll.ui.absenceOverride", "3");
    edit("payroll.ui.reasonLabel", "Reviewed");
    save();
    await screen.findByRole("button", {
      name: t("payroll.ux.retryAfterReview"),
    });
    await waitFor(() => expect(api.getRunItem).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(t("payroll.ui.absenceOverride"))).toHaveValue(
      "",
    );
    expect(
      screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
    ).toBeDisabled();
    expect(api.patchRunItem).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: t("payroll.ux.retryAfterReview") }),
    );
    expect(api.patchRunItem).toHaveBeenCalledTimes(1);
  }, 45000);
  it("does not send a salary adjustment for no-op monthly prefills", async () => {
    mount();
    await ready();
    const salary = screen.getByLabelText(t("payroll.line.basic_salary"));
    expect(salary).toHaveValue(
      moneyToInput(rows[0]!.monthly_salary_components!.basic_salary),
    );
    fireEvent.change(salary, {
      target: { value: rows[0]!.monthly_salary_components!.basic_salary },
    });
    edit("payroll.ui.reasonLabel", "No change");
    save();
    expect(
      screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
    ).toBeDisabled();
    expect(
      screen.queryByText(t("payroll.ui.noChanges")),
    ).not.toBeInTheDocument();
    expect(api.patchRunItem).not.toHaveBeenCalled();
  }, 45000);
  it("renders null company provisions as Unknown and mirrors the editor in Arabic", async () => {
    await useI18nStore.getState().setLanguage("ar");
    rows[0]!.provisions[0]!.amount = null;
    mount();
    await ready();
    tab("payroll.ux.columns.provisions");
    expect(
      await screen.findByText(t("payroll.ui.unknown")),
    ).toBeInTheDocument();
    expect(document.querySelector(".ant-tabs-rtl")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: t("hr.employees.backToList") }),
    ).toBeInTheDocument();
  }, 45000);
});

it("preserves unsaved employee inputs while refetching item, validation and history in another language", async () => {
  rows[0].absence.manual_confirmed = true;
  rows[0].manual_inputs.absence_days_override = "0.00";
  mount();
  await ready();
  tab("payroll.ui.absenceTitle");
  edit("payroll.ui.absenceOverride", "2");
  edit("payroll.ui.reasonLabel", "Recorded draft reason");
  const reads = vi.mocked(api.getRunItem).mock.calls.length;
  const validationReads = vi.mocked(api.getValidationReport).mock.calls.length;
  const historyReads = vi.mocked(api.listItemAdjustments).mock.calls.length;
  await act(async () => {
    await useI18nStore.getState().setLanguage("ar");
  });
  await waitFor(() =>
    expect(vi.mocked(api.getRunItem).mock.calls.length).toBeGreaterThan(reads),
  );
  await waitFor(() =>
    expect(
      vi.mocked(api.getValidationReport).mock.calls.length,
    ).toBeGreaterThan(validationReads),
  );
  await waitFor(() =>
    expect(
      vi.mocked(api.listItemAdjustments).mock.calls.length,
    ).toBeGreaterThan(historyReads),
  );
  expect(screen.getByLabelText(t("payroll.ui.absenceOverride"))).toHaveValue(
    "2",
  );
  expect(screen.getByLabelText(t("payroll.ui.reasonLabel"))).toHaveValue(
    "Recorded draft reason",
  );
  expect(
    screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
  ).toBeEnabled();
  expect(api.patchRunItem).not.toHaveBeenCalled();
});

it("links the provisions view to this employee's existing accommodation assignments", async () => {
  mount();
  await ready();
  tab("payroll.ux.columns.provisions");
  expect(
    screen.getByRole("link", { name: t("payroll.ui.assignmentsTitle") }),
  ).toHaveAttribute(
    "href",
    `/hr/payroll/accommodation?employee_profile_id=${rows[0].employee_profile_id}`,
  );
});

it("retains a reason entered before pay inputs during a language refetch", async () => {
  mount();
  await ready();
  edit("payroll.ui.reasonLabel", "Draft reason before quantities");
  expect(
    screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
  ).toBeDisabled();
  await act(async () => {
    await useI18nStore.getState().setLanguage("ar");
  });
  await waitFor(() =>
    expect(screen.getByLabelText(t("payroll.ui.reasonLabel"))).toHaveValue(
      "Draft reason before quantities",
    ),
  );
  expect(
    screen.getByRole("button", { name: t("payroll.ui.saveItem") }),
  ).toBeDisabled();
});
