import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import CreatePayrollRunPage from "./CreatePayrollRunPage";
import { useAuthStore } from "../../../auth/authStore";
import { useI18nStore } from "../../../i18n/i18nStore";
import { resolveTranslation } from "../../../i18n/translate";
import { setPayrollMocksEnabled } from "../../../services/api/payrollTransport";
import {
  payrollMockState,
  resetPayrollMockState,
} from "../../../services/api/payrollMocks/handler";

const en = (key: string, params?: Record<string, unknown>) =>
  resolveTranslation("en", key, params);

beforeEach(async () => {
  setPayrollMocksEnabled(true);
  resetPayrollMockState();
  await useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });
});

afterEach(() => {
  setPayrollMocksEnabled(undefined);
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe("CreatePayrollRunPage", () => {
  it("shows an accessible required inclusive date range with the 30-day limit", async () => {
    const router = createMemoryRouter(
      [{ path: "/hr/payroll/create", element: <CreatePayrollRunPage /> }],
      { initialEntries: ["/hr/payroll/create"] },
    );
    render(<RouterProvider router={router} />);

    expect(screen.getByText(en("payroll.periodRangeHelp"))).toBeInTheDocument();
    expect(screen.getByPlaceholderText(en("common.startDate"))).toBeVisible();
    expect(screen.getByPlaceholderText(en("common.endDate"))).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: en("payroll.createTitle") }),
    );
    expect(await screen.findByText(en("payroll.periodRangeReq"))).toBeVisible();
  });

  it("previews a cross-month window and submits ISO server dates", async () => {
    const router = createMemoryRouter(
      [
        { path: "/hr/payroll/create", element: <CreatePayrollRunPage /> },
        { path: "/hr/payroll/:run_id", element: <p>Run opened</p> },
      ],
      { initialEntries: ["/hr/payroll/create"] },
    );
    render(<RouterProvider router={router} />);

    const start = screen.getByPlaceholderText(en("common.startDate"));
    fireEvent.change(start, { target: { value: "2026-10-15" } });
    fireEvent.keyDown(start, { key: "Enter", code: "Enter", keyCode: 13 });

    const end = screen.getByPlaceholderText(en("common.endDate"));
    fireEvent.change(end, { target: { value: "2026-11-13" } });
    fireEvent.keyDown(end, { key: "Enter", code: "Enter", keyCode: 13 });
    fireEvent.blur(end);

    await waitFor(() =>
      expect(screen.getByText(/30 calendar days$/)).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: en("payroll.createTitle") }),
    );

    expect(await screen.findByText("Run opened")).toBeInTheDocument();
    await waitFor(() =>
      expect(payrollMockState().runs[0]).toMatchObject({
        year: 2026,
        month: 11,
        calendar_days: 30,
        period_start: "2026-10-15",
        period_end: "2026-11-13",
      }),
    );
  });

  it("opens an overlapping run whose end-month anchor differs from the request", async () => {
    const router = createMemoryRouter(
      [
        { path: "/hr/payroll/create", element: <CreatePayrollRunPage /> },
        { path: "/hr/payroll/:run_id", element: <p>Existing run opened</p> },
      ],
      { initialEntries: ["/hr/payroll/create"] },
    );
    render(<RouterProvider router={router} />);

    const start = screen.getByPlaceholderText(en("common.startDate"));
    fireEvent.change(start, { target: { value: "2026-09-30" } });
    fireEvent.keyDown(start, { key: "Enter", code: "Enter", keyCode: 13 });

    const end = screen.getByPlaceholderText(en("common.endDate"));
    fireEvent.change(end, { target: { value: "2026-10-05" } });
    fireEvent.keyDown(end, { key: "Enter", code: "Enter", keyCode: 13 });
    fireEvent.blur(end);

    fireEvent.click(
      screen.getByRole("button", { name: en("payroll.createTitle") }),
    );

    expect(await screen.findByText("Existing run opened")).toBeInTheDocument();
    expect(payrollMockState().runs).toHaveLength(1);
    expect(payrollMockState().runs[0].id).toBe(7);
  });
});
