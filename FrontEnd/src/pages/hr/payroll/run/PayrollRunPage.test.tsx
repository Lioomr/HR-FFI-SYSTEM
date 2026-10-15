import { legacyRunPresentation } from "../../../../services/api/payrollMocks/contractExamples";
import type {
  PayrollRunDto,
  PayrollRunSummaryDto,
  ValidationReport,
} from "../../../../services/api/payrollTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Modal } from "antd";

import * as api from "../../../../services/api/payrollApi";
import PayrollRunPage from "./PayrollRunPage";
import PayrollEmployeePage from "./PayrollEmployeePage";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../../../services/api/payrollSettingsApi";
import { useAuthStore } from "../../../../auth/authStore";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";

const FIND = { timeout: 8000 };
const en = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation("en", key, params);

function renderRun(path = "/hr/payroll/7") {
  const router = createMemoryRouter(
    [
      { path: "/hr/payroll/:run_id", element: <PayrollRunPage /> },
      {
        path: "/hr/payroll/:run_id/employees/:item_id",
        element: <PayrollEmployeePage />,
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

async function ready() {
  await screen.findByText(
    en("payroll.ui.revisionTag", { revision: 1 }),
    {},
    FIND,
  );
}

function allowFinalize() {
  const report = payrollMockState().validation.get(7)!;
  report.can_finalize = true;
  report.errors = [];
  report.counts = { errors: 0, warnings: report.warnings.length };
}

async function submitReason(
  dialog: HTMLElement,
  okName: string,
  reason: string,
) {
  fireEvent.change(
    within(dialog).getByLabelText(en("payroll.ui.reasonLabel")),
    {
      target: { value: reason },
    },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: okName }));
}

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

afterEach(() => {
  Modal.destroyAll();
  setPayrollMocksEnabled(undefined);
  useAuthStore.setState({ isAuthenticated: false, user: null });
  useI18nStore.getState().setLanguage("en");
});

describe("PayrollRunPage", () => {
  it.each(["COMPLETED", "PAID"] as const)(
    "renders the production-shaped legacy %s run without finalization gates",
    async (status) => {
      const fixture = structuredClone(legacyRunPresentation);
      const run = { ...fixture.run, status } as unknown as PayrollRunDto;
      const state = payrollMockState();
      state.runs.push(run);
      state.summaries.set(
        run.id,
        fixture.summary as unknown as PayrollRunSummaryDto,
      );
      state.validation.set(
        run.id,
        fixture.validation as unknown as ValidationReport,
      );
      state.items.set(run.id, []);
      renderRun("/hr/payroll/8");
      await screen.findAllByText("62,439", {}, FIND);
      expect(screen.getAllByText("57,239").length).toBeGreaterThan(0);
      expect(
        screen.getAllByText("Not available - previous system").length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(en("payroll.ui.legacyRunHelp")),
      ).toBeInTheDocument();
      expect(screen.getByText("Finalized")).toBeInTheDocument();
      expect(screen.queryByText(en("payroll.ui.cannotFinalize"))).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^lock Finalize$|^Finalize$/ }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("tab", { name: /Validation/ }));
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(
        document.querySelector(".payroll-confirmation-progress"),
      ).toBeNull();
      expect(screen.queryByText(en("payroll.ui.canFinalize"))).toBeNull();
      expect(screen.getAllByText("Finalized")).toHaveLength(2);
      fireEvent.click(
        screen.getByRole("button", { name: en("payroll.ui.showBreakdown") }),
      );
      expect(
        screen.getAllByText("Not available - previous system").length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it("shows Gross, Net and Total Company Cost exactly as the summary sends them", async () => {
    renderRun();
    await ready();
    expect(screen.getAllByText("110,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("102,670").length).toBeGreaterThan(0);
    expect(screen.getAllByText("122,350").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByRole("button", {
        name: new RegExp(en("payroll.ui.showBreakdown")),
      })[0],
    );
    expect(
      await screen.findByText(en("payroll.ui.roundingDifferenceNote")),
    ).toBeInTheDocument();
  });

  it("disables Finalize while the validation report cannot finalize", async () => {
    renderRun();
    await ready();
    const finalize = screen.getByRole("button", {
      name: new RegExp(en("payroll.ui.finalize")),
    });
    expect(finalize).toBeDisabled();
  });

  it("finalizes with the run revision and a reason when can_finalize is true", async () => {
    allowFinalize();
    renderRun();
    await ready();
    const finalize = screen.getByRole("button", {
      name: new RegExp(en("payroll.ui.finalize")),
    });
    await waitFor(() => expect(finalize).not.toBeDisabled());
    fireEvent.click(finalize);
    const dialog = await screen.findByRole("dialog", {}, FIND);
    await submitReason(
      dialog,
      en("payroll.ui.finalize"),
      "HR reconciliation complete",
    );
    await waitFor(() =>
      expect(payrollMockState().runs[0].status).toBe("COMPLETED"),
    );
    expect(
      await screen.findByRole(
        "button",
        { name: new RegExp(en("payroll.ui.generatePayslips")) },
        FIND,
      ),
    ).toBeInTheDocument();
  });

  it("requires a reason to cancel", async () => {
    renderRun();
    await ready();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(en("payroll.ux.moreActions")),
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: en("payroll.ui.cancelRun") }),
    );
    const dialog = await screen.findByRole("dialog", {}, FIND);
    fireEvent.click(
      within(dialog).getByRole("button", { name: en("payroll.ui.cancelRun") }),
    );
    expect(
      await within(dialog).findByText(
        en("payroll.ui.reasonRequired"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(payrollMockState().runs[0].status).toBe("DRAFT");
  });

  it("stops on stale_revision, reloads and does not retry the recalculation", async () => {
    renderRun();
    await ready();
    // Someone else changes the run first.
    payrollMockState().runs[0].revision = 4;

    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(`${en("payroll.ui.recalculate")}$`),
      }),
    );
    const dialog = await screen.findByRole("dialog", {}, FIND);
    await submitReason(
      dialog,
      en("payroll.ui.recalculate"),
      "Attendance corrected",
    );

    expect(
      await screen.findByText(
        "Payroll data changed; reload and retry.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        en("payroll.ui.revisionTag", { revision: 4 }),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    // The stale request was not re-sent: the revision did not advance past 4.
    expect(payrollMockState().runs[0].revision).toBe(4);
  });

  it("shows cost_incomplete with its reason", async () => {
    const state = payrollMockState();
    const summary = state.summaries.get(7)!;
    summary.cost_incomplete = true;
    summary.unknown_provision_counts.ACCOMMODATION_COST = 2;
    renderRun();
    await ready();
    expect(
      screen.getByText(
        new RegExp(en("payroll.ui.accommodationUnknownCount", { count: 2 })),
      ),
    ).toBeInTheDocument();
  });

  it("renders a null provision as Unknown in the grid, never 0", async () => {
    const item = payrollMockState().items.get(7)![0];
    item.accommodation_cost = null;
    item.cost_incomplete = true;
    renderRun();
    await ready();
    await screen.findByText("Example Employee", {}, FIND);
    fireEvent.click(
      screen.getByRole("switch", { name: en("payroll.ui.showProvisions") }),
    );
    const row = (await screen.findAllByRole("row")).find((candidate) =>
      within(candidate).queryByText("Example Employee"),
    )!;
    expect(within(row).getByText(en("payroll.ui.unknown"))).toBeInTheDocument();
    expect(
      within(row).getByLabelText(en("payroll.field.cost_incomplete")),
    ).toBeInTheDocument();
  });

  it("redirects the legacy item deep link into the full employee page", async () => {
    renderRun("/hr/payroll/7?item=71");
    await screen.findByRole("tab", { name: en("layout.menu.overview") }, FIND);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("tab", { name: en("payroll.ui.absenceTitle") }),
    );
    expect(
      await screen.findByText(en("payroll.ui.observedAbsentDays"), {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getByText("EMP-001")).toBeInTheDocument();
  });
  it("renders the grid in Arabic", async () => {
    await useI18nStore.getState().setLanguage("ar");
    renderRun();
    expect(
      await screen.findAllByText(
        resolveTranslation("ar", "payroll.ux.columns.salary"),
        {},
        FIND,
      ),
    ).not.toHaveLength(0);
  });

  it("shows the suspended-pay choice and the item's blocking error from the report", async () => {
    const report = payrollMockState().validation.get(7)!;
    report.revision = payrollMockState().runs[0].revision;
    report.errors = [
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
    ];
    renderRun("/hr/payroll/7?item=71");
    await screen.findByRole("tab", { name: en("layout.menu.overview") }, FIND);
    expect(
      await screen.findByLabelText(
        en("payroll.ui.suspendedPayDecision"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose full pay or zero pay with suspended reason for this run.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the generate-payslips confirmation and publishes the run", async () => {
    payrollMockState().runs[0].status = "COMPLETED";
    renderRun();
    await ready();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(en("payroll.ui.generatePayslips")),
      }),
    );
    const dialog = await screen.findByRole("dialog", {}, FIND);
    expect(
      within(dialog).getAllByText(en("payroll.ui.generateTitle")).length,
    ).toBeGreaterThan(0);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: en("payroll.ui.generatePayslips"),
      }),
    );
    await waitFor(() => expect(payrollMockState().runs[0].status).toBe("PAID"));
  });
});

it("refetches validation on language switch and uses one LTR capped badge with exact counts", async () => {
  const get = vi.spyOn(api, "getValidationReport");
  const report = payrollMockState().validation.get(7)!;
  report.warnings = Array.from({ length: 101 }, () => ({
    ...report.warnings[0],
    code: "medical_invoice_missing",
    severity: "warning",
    message: "Recorded warning",
    message_key: "payroll.validation.medical_invoice_missing",
    employee: null,
    params: {},
    field: undefined,
  }));
  report.counts.warnings = 101;
  renderRun();
  await ready();
  const reads = get.mock.calls.length;
  await act(async () => {
    await useI18nStore.getState().setLanguage("ar");
  });
  await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(reads));
  const tab = screen.getByRole("tab", { name: /101/ });
  expect(tab.querySelectorAll(".ant-badge")).toHaveLength(1);
  expect(tab.textContent).toContain("99+");
  expect(tab.querySelector("bdi")).toHaveAttribute("dir", "ltr");
  get.mockRestore();
});
