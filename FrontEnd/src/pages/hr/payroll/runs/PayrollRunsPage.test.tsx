import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import PayrollRunsPage from "./PayrollRunsPage";
import { setPayrollMocksEnabled } from "../../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../../services/api/payrollMocks/handler";
import { clearPayrollEnumCache } from "../../../../services/api/payrollSettingsApi";
import { useI18nStore } from "../../../../i18n/i18nStore";
import { resolveTranslation } from "../../../../i18n/translate";

const FIND = { timeout: 8000 };
const en = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation("en", key, params);

beforeEach(() => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  clearPayrollEnumCache();
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  setPayrollMocksEnabled(undefined);
});

describe("PayrollRunsPage", () => {
  it.each([
    ["Payroll Settings", "/hr/payroll/settings"],
    ["Payroll Accommodation", "/hr/payroll/accommodation"],
  ])("opens %s from the payroll page", async (name, path) => {
    render(
      <MemoryRouter initialEntries={["/hr/payroll"]}>
        <Routes>
          <Route path="/hr/payroll" element={<PayrollRunsPage />} />
          <Route path={path} element={<p>Destination opened</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(name) }),
    );
    expect(await screen.findByText("Destination opened")).toBeInTheDocument();
  });

  it("lists runs with money from the API and validation counts", async () => {
    render(
      <MemoryRouter>
        <PayrollRunsPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("September 2026", {}, FIND),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sep 1, 2026 – Sep 30, 2026 · 30 calendar days"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("102,670").length).toBeGreaterThan(0);
    expect(screen.getAllByText("122,350").length).toBeGreaterThan(0);
  });

  it("shows a cancelled run with its reason", async () => {
    const run = payrollMockState().runs[0];
    run.status = "CANCELLED";
    run.cancelled_at = "2026-10-11T10:00:00Z";
    run.cancel_reason = "Wrong payroll month selected";
    render(
      <MemoryRouter>
        <PayrollRunsPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/Wrong payroll month selected/, {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
  });

  it("shows the cost-incomplete badge on a run", async () => {
    payrollMockState().runs[0].cost_incomplete = true;
    render(
      <MemoryRouter>
        <PayrollRunsPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole(
        "button",
        { name: en("payroll.field.cost_incomplete") },
        FIND,
      ),
    ).toBeInTheDocument();
  });
});

it("shows unavailable company cost as Unknown and renders Arabic", async () => {
  Object.assign(payrollMockState().runs[0], { total_company_cost: null });
  await useI18nStore.getState().setLanguage("ar");
  render(
    <MemoryRouter>
      <PayrollRunsPage />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(
      resolveTranslation("ar", "payroll.ui.unknown"),
      {},
      FIND,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(resolveTranslation("ar", "payroll.field.gross_salary"))
      .length,
  ).toBeGreaterThan(0);
});
