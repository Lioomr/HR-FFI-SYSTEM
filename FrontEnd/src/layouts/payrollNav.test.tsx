import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import BaseLayout from "./BaseLayout";
import { useAuthStore, type Role } from "../auth/authStore";
import { resetManagerAccessCache } from "../hooks/useManagerAccess";
import { getManagerAccess } from "../services/api/managerApi";
import { getEmployee } from "../services/api/employeesApi";
import { setPayrollMocksEnabled } from "../services/api/payrollTransport";
import { useI18nStore } from "../i18n/i18nStore";

vi.mock("../services/api/managerApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api/managerApi")>()),
  getManagerAccess: vi.fn(),
}));

vi.mock("../services/api/employeesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api/employeesApi")>()),
  getEmployee: vi.fn(),
}));

vi.mock("../hooks/useNotificationsRuntime", () => ({
  useNotificationsRuntime: () => undefined,
}));
vi.mock("../components/notifications/NotificationBell", () => ({
  default: () => null,
}));

const NAV_LABEL = "Payroll Settings";

async function renderShellAs(role: Role) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "11", email: "user@ffi.test", role },
  });
  const view = render(
    <MemoryRouter initialEntries={["/employee/home"]}>
      <Routes>
        <Route element={<BaseLayout />}>
          <Route path="/employee/home" element={<div>Home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await screen.findAllByRole("menu");
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  resetManagerAccessCache();
  vi.mocked(getManagerAccess)
    .mockReset()
    .mockResolvedValue({
      status: "success",
      data: {
        has_access: false,
        managed_employee_count: 0,
        source: "none",
        scopes: [],
      },
    });
  vi.mocked(getEmployee).mockReset().mockResolvedValue({
    status: "error",
    message: "no profile",
  });
  useI18nStore.getState().setLanguage("en");
  setPayrollMocksEnabled(true);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useAuthStore.setState({ isAuthenticated: false, user: null });
  setPayrollMocksEnabled(undefined);
});

describe("payroll settings navigation", () => {
  it.each(["HRManager", "SystemAdmin", "CFO"] as Role[])(
    "keeps one payroll entry and hides settings/accommodation from the sidebar for %s",
    async (role) => {
      await renderShellAs(role);
      expect(
        document.querySelector('a[href="/hr/payroll"]'),
      ).toBeInTheDocument();
      expect(
        document.querySelector('a[href="/hr/payroll/settings"]'),
      ).toBeNull();
      expect(
        document.querySelector('a[href="/hr/payroll/accommodation"]'),
      ).toBeNull();
    },
  );

  it.each(["Employee", "Manager", "CEO"] as Role[])(
    "hides payroll settings from %s",
    async (role) => {
      await renderShellAs(role);
      await waitFor(() =>
        expect(
          screen.queryByRole("link", { name: NAV_LABEL }),
        ).not.toBeInTheDocument(),
      );
      expect(document.body.innerHTML.includes("/hr/payroll/settings")).toBe(
        false,
      );
    },
  );

  it("offers the payroll runs to a CFO", async () => {
    await renderShellAs("CFO");
    const link = screen.getAllByRole("link", { name: "Payroll Runs" })[0];
    expect(link).toHaveAttribute("href", "/hr/payroll");
  });

  it("stays hidden until the payroll rebuild API is enabled", async () => {
    setPayrollMocksEnabled(false);
    await renderShellAs("HRManager");
    expect(
      screen.queryByRole("link", { name: NAV_LABEL }),
    ).not.toBeInTheDocument();
  });
});
