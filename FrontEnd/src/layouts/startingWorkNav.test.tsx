import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import BaseLayout from "./BaseLayout";
import { useAuthStore, type Role } from "../auth/authStore";
import { resetManagerAccessCache } from "../hooks/useManagerAccess";
import { getManagerAccess } from "../services/api/managerApi";
import { getEmployee } from "../services/api/employeesApi";
import { useI18nStore } from "../i18n/i18nStore";

vi.mock("../services/api/managerApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api/managerApi")>()),
  getManagerAccess: vi.fn(),
}));

vi.mock("../services/api/employeesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api/employeesApi")>()),
  getEmployee: vi.fn(),
}));

// The shell's realtime runtime and bell would poll the API during the test.
vi.mock("../hooks/useNotificationsRuntime", () => ({
  useNotificationsRuntime: () => undefined,
}));
vi.mock("../components/notifications/NotificationBell", () => ({
  default: () => null,
}));

const mockedGetManagerAccess = vi.mocked(getManagerAccess);
const mockedGetEmployee = vi.mocked(getEmployee);

const NAV_LABEL = "BioTime Verifications";

function signIn(role: Role) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "11", email: "user@ffi.test", role },
  });
}

async function renderShell() {
  render(
    <MemoryRouter initialEntries={["/employee/home"]}>
      <Routes>
        <Route element={<BaseLayout />}>
          <Route path="/employee/home" element={<div>Home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await screen.findAllByRole("menu");
  await waitFor(() => expect(mockedGetManagerAccess).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  // Desktop breakpoints, so the sidebar (not the mobile drawer) renders.
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
  mockedGetManagerAccess.mockReset().mockResolvedValue({
    status: "success",
    data: {
      has_access: false,
      managed_employee_count: 0,
      source: "none",
      scopes: [],
    },
  });
  mockedGetEmployee.mockReset().mockResolvedValue({
    status: "error",
    message: "no profile",
  });
  useI18nStore.getState().setLanguage("en");
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useAuthStore.setState({ isAuthenticated: false, user: null });
  useI18nStore.getState().setLanguage("en");
});

describe("BioTime Verifications navigation", () => {
  it("offers the entry to an HR manager", async () => {
    signIn("HRManager");
    await renderShell();

    const link = screen.getAllByRole("link", { name: NAV_LABEL })[0];
    expect(link).toHaveAttribute("href", "/hr/starting-work-acknowledgments");
  });

  it("uses the Arabic label in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    signIn("HRManager");
    await renderShell();

    expect(
      screen.getAllByRole("link", { name: "التحقق من حضور BioTime" }).length,
    ).toBeGreaterThan(0);
  });

  it("hides the entry from an employee", async () => {
    signIn("Employee");
    await renderShell();

    expect(
      screen.queryByRole("link", { name: NAV_LABEL }),
    ).not.toBeInTheDocument();
    expect(
      document.body.innerHTML.includes("/hr/starting-work-acknowledgments"),
    ).toBe(false);
  });

  it("hides the entry from a manager and a CEO", async () => {
    for (const role of ["Manager", "CEO"] as Role[]) {
      signIn(role);
      const { unmount } = render(
        <MemoryRouter initialEntries={["/employee/home"]}>
          <Routes>
            <Route element={<BaseLayout />}>
              <Route path="/employee/home" element={<div>Home</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );
      await screen.findAllByRole("menu");
      expect(
        screen.queryByRole("link", { name: NAV_LABEL }),
        `${role} must not see the HR BioTime entry`,
      ).not.toBeInTheDocument();
      unmount();
    }
  });
});
