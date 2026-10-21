import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import MyPayslipDetailPage from "./MyPayslipDetailPage";
import MyPayslipsPage from "./MyPayslipsPage";
import { setPayrollMocksEnabled } from "../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../../services/api/payrollSettingsApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import { resolveTranslation } from "../../../i18n/translate";

const FIND = { timeout: 8000 };
const en = (key: string) => resolveTranslation("en", key);

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/employee/payslips/201"]}>
      <Routes>
        <Route
          path="/employee/payslips/:id"
          element={<MyPayslipDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  setPayrollMocksEnabled(undefined);
  useI18nStore.getState().setLanguage("en");
});

describe("employee payslip pages", () => {
  it("shows components, itemised deductions, net and the translated payment mode", async () => {
    renderDetail();
    expect(
      await screen.findByText("Basic Salary", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.getByText("Absence")).toBeInTheDocument();
    expect(screen.getAllByText("10,267").length).toBeGreaterThan(0);
    expect(
      screen.getByText(new RegExp(en("payroll.payment_mode.bank_transfer"))),
    ).toBeInTheDocument();
  });

  it("adds the pay up to net, sizes the bar and hides zero components", async () => {
    renderDetail();
    await screen.findByText("Basic Salary", {}, FIND);
    // 10,267 kept of 11,000: the bar and its keys round to whole percents.
    expect(
      screen.getByText(
        en("payroll.ui.flow.netShare").replace("{percent}", "93"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        en("payroll.ui.flow.deductedShare").replace("{percent}", "7"),
      ),
    ).toBeInTheDocument();
    // Telephone and Petrol are 0.00 in this payslip.
    expect(screen.queryByText("Telephone")).not.toBeInTheDocument();
    expect(screen.queryByText("Petrol")).not.toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.flow.zeroHidden")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.flow.noneThisMonth")),
    ).toBeInTheDocument();
  });

  it("never renders provisions or company cost, even when the payload contains them", async () => {
    const detail = payrollMockState().payslipDetails.get(201)!;
    Object.assign(detail, {
      provisions: [{ type: "MEDICAL", label: "Medical", amount: "100.00" }],
      medical_provision: "100.00",
      total_company_cost: "12235.00",
      cost_incomplete: true,
    });
    detail.deductions.push({
      type: "GOSI_COMPANY" as never,
      label: "Company GOSI",
      label_key: "payroll.line.gosi_company",
      amount: "180.00",
      quantity: null,
      source_period: null,
    });
    renderDetail();
    await screen.findByText("Basic Salary", {}, FIND);
    const text = document.body.textContent ?? "";
    for (const forbidden of [
      "Medical",
      "Company GOSI",
      "12,235",
      "Company cost",
      en("payroll.field.cost_incomplete"),
    ]) {
      expect([forbidden, text.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("shows the legacy Previous total deductions line with its exact amount", async () => {
    const detail = payrollMockState().payslipDetails.get(201)!;
    detail.legacy_calculation = true;
    detail.deductions = [
      {
        type: "PREVIOUS_TOTAL_DEDUCTIONS",
        label: "Previous total deductions",
        label_key: "payroll.line.previous_total_deductions",
        amount: "512.75",
        quantity: null,
        source_period: null,
      },
    ];
    renderDetail();
    expect(
      await screen.findByText("Previous total deductions", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getByText("512.75")).toBeInTheDocument();
    expect(
      screen.getByText(en("payroll.ui.legacyPayslip")),
    ).toBeInTheDocument();
  });

  it("lists payslips with net and status", async () => {
    render(
      <MemoryRouter>
        <MyPayslipsPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Sep 1, 2026 – Sep 30, 2026", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getAllByText("10,267").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("renders in Arabic (RTL smoke test)", async () => {
    useI18nStore.getState().setLanguage("ar");
    renderDetail();
    expect(
      await screen.findByText(
        resolveTranslation("ar", "payroll.pdf.earnings"),
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          resolveTranslation("ar", "payroll.payment_mode.bank_transfer"),
        ),
      ),
    ).toBeInTheDocument();
  });
});

it("keeps a null salary component Unknown, labels tables and isolates Arabic money", async () => {
  payrollMockState().payslipDetails.get(201)!.salary_components[0].amount =
    null;
  await useI18nStore.getState().setLanguage("ar");
  renderDetail();
  expect(
    await screen.findByText(
      resolveTranslation("ar", "payroll.ui.unknown"),
      {},
      FIND,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("table", {
      name: resolveTranslation("ar", "payroll.pdf.earnings"),
    }),
  ).toBeInTheDocument();
  expect(document.querySelector('.pslip-figures [dir="ltr"]')).toBeTruthy();
});
