import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PayrollItemsGrid from "./PayrollItemsGrid";
import PayrollTheme from "./PayrollTheme";
import type { PayrollListState } from "./payrollNavigation";
import { listRunItems, patchRunItem } from "../../services/api/payrollApi";
import * as examples from "../../services/api/payrollMocks/contractExamples";
import type {
  PayrollRunItemDto,
  PayrollRunSummaryDto,
  ValidationReport,
} from "../../services/api/payrollTypes";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";
import { resolveTranslation } from "../../i18n/translate";
vi.mock("../../services/api/payrollApi", () => ({
  listRunItems: vi.fn(),
  patchRunItem: vi.fn(),
}));
let rows: PayrollRunItemDto[];
let report: ValidationReport;
const text = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation(useI18nStore.getState().language, key, params);
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(listRunItems).mockReset();
  vi.mocked(patchRunItem).mockReset();
  localStorage.clear();
  await useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    user: { id: "grid-user", email: "hr@test", role: "HRManager" },
    isAuthenticated: true,
  });
  const first = structuredClone(
    examples.item.data,
  ) as unknown as PayrollRunItemDto;
  first.run_revision = 1;
  first.absence.manual_confirmation_required = true;
  first.absence.manual_confirmed = false;
  first.manual_inputs.absence_days_override = null;
  rows = [
    { ...first, id: 71, employee_name: "First" },
    { ...structuredClone(first), id: 72, employee_name: "Second" },
  ];
  report = structuredClone(
    examples.validationReport.data,
  ) as unknown as ValidationReport;
  report.revision = 1;
  report.errors = [];
  report.warnings = [];
  vi.mocked(listRunItems).mockImplementation(async () => ({
    items: structuredClone(rows),
    count: rows.length,
    page: 1,
    page_size: 1000,
    total_pages: 1,
  }));
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await useI18nStore.getState().setLanguage("en");
});
function mount(
  onChanged = vi.fn().mockResolvedValue(undefined),
  initialState?: PayrollListState,
) {
  return render(
    <MemoryRouter>
      <ConfigProvider direction={useI18nStore.getState().direction}>
        <PayrollTheme>
          <PayrollItemsGrid
            runId={7}
            revision={1}
            runStatus="DRAFT"
            summary={examples.summary.data as unknown as PayrollRunSummaryDto}
            report={report}
            refreshKey={0}
            initialState={initialState}
            onChanged={onChanged}
            onOpenItem={vi.fn()}
          />
        </PayrollTheme>
      </ConfigProvider>
    </MemoryRouter>,
  );
}
const input = (name: string) =>
  screen.getByRole("textbox", {
    name: text("payroll.ux.absenceFor", { name }),
  });
async function enter(name = "First", days = "0") {
  await screen.findByText("First");
  fireEvent.change(input(name), { target: { value: days } });
  fireEvent.mouseDown(
    screen.getByRole("combobox", {
      name: text("payroll.ux.reasonFor", { name }),
    }),
  );
  fireEvent.click(await screen.findByText(text("payroll.ux.reason.reviewed")));
}
describe("payroll confirmation grid", () => {
  it("marks executives without an absence confirmation input", async () => {
    rows[0] = { ...rows[0], executive_exempt: true };
    mount();
    expect(
      await screen.findByText("Executive - attendance checks not applicable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Absence days for First" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Absence days for Second" }),
    ).toBeInTheDocument();
  });
  it("restores page, filters, columns and scroll even when preference storage fails", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    const scroll = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    mount(undefined, {
      page: 2,
      pageSize: 1,
      search: "",
      hasWarnings: undefined,
      attention: false,
      status: "all",
      scroll: 640,
      columns: {
        salary: false,
        additions: true,
        deductions: true,
        provisions: false,
        details: false,
      },
    });
    await screen.findByText("Second");
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", {
        name: text("payroll.field.gross_salary"),
      }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(scroll).toHaveBeenCalledWith(0, 640));
  });
  it("saves one sparse zero confirmation, refreshes the index, advances only after success and carries revision", async () => {
    let finish!: (value: PayrollRunItemDto) => void;
    vi.mocked(patchRunItem).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const changed = vi.fn().mockResolvedValue(undefined);
    mount(changed);
    await enter();
    input("First").focus();
    fireEvent.keyDown(input("First"), { key: "Enter", code: "Enter" });
    expect(patchRunItem).toHaveBeenCalledWith(7, 71, {
      expected_revision: 1,
      changes: { absence_days_override: "0.00" },
      reason: text("payroll.ux.reason.reviewed"),
    });
    expect(input("Second")).not.toHaveFocus();
    rows = rows.map((row) => ({
      ...row,
      run_revision: 2,
      ...(row.id === 71
        ? {
            absence: { ...row.absence, manual_confirmed: true },
            manual_inputs: {
              ...row.manual_inputs,
              absence_days_override: "0.00",
            },
          }
        : {}),
    }));
    report.revision = 2;
    await act(async () => finish(rows[0]!));
    await waitFor(() => expect(input("Second")).toHaveFocus());
    expect(changed).toHaveBeenCalledTimes(1);
    expect(listRunItems).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("textbox", {
        name: text("payroll.ux.absenceFor", { name: "First" }),
      }),
    ).not.toBeInTheDocument();
    vi.mocked(patchRunItem).mockResolvedValueOnce({
      ...rows[1]!,
      run_revision: 3,
    });
    await enter("Second", "1");
    fireEvent.keyDown(input("Second"), { key: "Enter", code: "Enter" });
    await waitFor(() =>
      expect(patchRunItem).toHaveBeenNthCalledWith(2, 7, 72, {
        expected_revision: 2,
        changes: { absence_days_override: "1.00" },
        reason: text("payroll.ux.reason.reviewed"),
      }),
    );
  });
  it("requires an explicit reason and never treats blank as zero", async () => {
    mount();
    await screen.findByText("First");
    expect(
      screen.queryByRole("combobox", {
        name: text("payroll.ux.reasonFor", { name: "First" }),
      }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(input("First"), { key: "Enter", code: "Enter" });
    expect(patchRunItem).not.toHaveBeenCalled();
    fireEvent.keyUp(input("First"), { key: "Enter", code: "Enter" });
    fireEvent.change(input("First"), { target: { value: "0" } });
    fireEvent.keyDown(input("First"), { key: "Enter", code: "Enter" });
    expect(
      await screen.findByText(text("payroll.ui.reasonRequired")),
    ).toBeInTheDocument();
    expect(patchRunItem).not.toHaveBeenCalled();
  });
  it("stops and reloads on 409, retaining the draft without automatic retry or focus advance", async () => {
    vi.mocked(patchRunItem).mockRejectedValue({
      response: {
        status: 409,
        data: {
          status: "error",
          message: "Reload and retry",
          errors: [
            {
              code: "stale_revision",
              message: "Reload and retry",
              field: null,
            },
          ],
        },
      },
    });
    mount();
    await enter();
    input("First").focus();
    fireEvent.keyDown(input("First"), { key: "Enter", code: "Enter" });
    await screen.findByRole("button", {
      name: text("payroll.ux.retryAfterReview"),
    });
    await waitFor(() => expect(listRunItems).toHaveBeenCalledTimes(2));
    expect(patchRunItem).toHaveBeenCalledTimes(1);
    expect(input("Second")).not.toHaveFocus();
    expect(input("First")).toHaveValue("0");
    expect(input("First")).toBeDisabled();
  });
  it("persists column preferences and keeps the chooser working when storage fails", async () => {
    const view = mount();
    await screen.findByText("First");
    fireEvent.click(
      screen.getByRole("switch", { name: text("payroll.ui.showProvisions") }),
    );
    expect(
      JSON.parse(localStorage.getItem("ffi.payroll.columns.v1.grid-user")!)
        .provisions,
    ).toBe(true);
    view.unmount();
    mount();
    await screen.findByText("First");
    expect(
      screen.getByRole("switch", { name: text("payroll.ui.showProvisions") }),
    ).toBeChecked();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(
      screen.getByRole("switch", { name: text("payroll.ui.showProvisions") }),
    );
    expect(
      screen.getByRole("switch", { name: text("payroll.ui.showProvisions") }),
    ).not.toBeChecked();
  });
  it("shows unavailable until the full index arrives and uses server pagination above the cap", async () => {
    vi.mocked(listRunItems)
      .mockResolvedValueOnce({
        items: [],
        count: 1001,
        page: 1,
        page_size: 1000,
        total_pages: 2,
      })
      .mockResolvedValue({
        items: rows,
        count: 1001,
        page: 1,
        page_size: 25,
        total_pages: 41,
      });
    mount();
    expect(
      screen.getByText(text("payroll.ux.indexUnavailable")),
    ).toBeInTheDocument();
    await screen.findByText(text("payroll.ux.indexLimited"));
    await screen.findByText("First");
    expect(
      screen.getByRole("checkbox", { name: text("payroll.ux.needsAttention") }),
    ).toBeDisabled();
    expect(listRunItems).toHaveBeenLastCalledWith(7, {
      page: 1,
      page_size: 25,
      search: undefined,
      has_warnings: undefined,
    });
  });
  it("renders Arabic controls and RTL sticky employee column without hidden decision columns", async () => {
    await useI18nStore.getState().setLanguage("ar");
    mount();
    await screen.findByText("First");
    expect(document.querySelector(".ant-table-wrapper-rtl")).not.toBeNull();
    expect(
      screen.getAllByText(text("payroll.field.net_salary")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(text("payroll.field.total_company_cost")).length,
    ).toBeGreaterThan(0);
    expect(input("First")).toBeInTheDocument();
  });
});
