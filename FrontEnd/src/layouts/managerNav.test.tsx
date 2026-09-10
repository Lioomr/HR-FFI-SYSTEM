import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import BaseLayout from "./BaseLayout";
import { buildManagerNavGroups } from "./managerNav";
import { useAuthStore, type Role } from "../auth/authStore";
import { resetManagerAccessCache } from "../hooks/useManagerAccess";
import { getManagerAccess } from "../services/api/managerApi";
import { getEmployee } from "../services/api/employeesApi";
import { translations } from "../i18n/translations";

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

const t = (
  key: string,
  params?: Record<string, unknown> | string,
  fallback?: string,
) => {
  const actualFallback = typeof params === "string" ? params : fallback;
  return translations.en?.[key] ?? actualFallback ?? key;
};

const MANAGER_NAV_LINKS = [
  "Team Dashboard",
  "My Team",
  "Team Requests",
  "Team Attendance",
  "Loan Requests",
];

function setManagerAccess(
  hasAccess: boolean,
  managedEmployeeCount = hasAccess ? 4 : 0,
) {
  mockedGetManagerAccess.mockResolvedValue({
    status: "success",
    data: {
      has_access: hasAccess,
      managed_employee_count: managedEmployeeCount,
      source: hasAccess ? "direct_reports" : "none",
      scopes: hasAccess
        ? ["leave", "loan", "attendance", "asset", "announcement"]
        : [],
    },
  });
}

function signIn(role: Role) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "11", email: "user@ffi.test", role },
  });
}

async function renderShell(path = "/employee/home") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<BaseLayout />}>
          <Route path="/employee/home" element={<div>Home</div>} />
          <Route
            path="/manager/attendance"
            element={<div>Direct-report attendance</div>}
          />
          <Route
            path="/employee/attendance"
            element={<div>Personal attendance</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  // Wait for the sidebar itself, then let the capability request settle so
  // "nav is hidden" assertions cannot pass merely because it is still loading.
  await screen.findAllByRole("menu");
  expect(screen.queryByText("Attendance Corrections")).not.toBeInTheDocument();
  await waitFor(() => expect(mockedGetManagerAccess).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("buildManagerNavGroups", () => {
  it("returns the My Team group when the capability is granted", () => {
    const groups = buildManagerNavGroups(t, true);

    expect(groups).toHaveLength(1);
    const children = (groups[0] as { children: { key: string }[] }).children;
    expect(children.map((child) => child.key)).toEqual([
      "/manager/dashboard",
      "/manager/team",
      "/manager/team-requests",
      "/manager/attendance",
      "/manager/loan-requests",
    ]);
  });

  it("returns nothing without the capability", () => {
    expect(buildManagerNavGroups(t, false)).toEqual([]);
  });
});

describe("BaseLayout manager navigation", () => {
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
    mockedGetManagerAccess.mockReset();
    mockedGetEmployee.mockReset();
    mockedGetEmployee.mockResolvedValue({
      status: "success",
      data: {} as never,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    useAuthStore.setState({ isAuthenticated: false, user: null });
  });

  it.each([
    ["Manager", "/manager/attendance", "Direct-report attendance"],
    ["Employee", "/employee/attendance", "Personal attendance"],
  ] as const)(
    "%s attendance submenu navigates to %s",
    async (role, target, content) => {
      signIn(role);
      setManagerAccess(role === "Manager");
      await renderShell();
      fireEvent.click(
        screen.getByText("Attendance", { selector: ".ant-menu-title-content" }),
      );
      const records = await screen.findByRole("link", { name: "Records" });
      expect(records).toHaveAttribute("href", target);
      fireEvent.click(records);
      expect(await screen.findByText(content)).toBeInTheDocument();
    },
  );

  it.each([
    ["Manager", "/manager/attendance"],
    ["Employee", "/employee/attendance"],
  ] as const)(
    "opens the %s attendance submenu on direct navigation",
    async (role, path) => {
      signIn(role);
      setManagerAccess(role === "Manager");
      await renderShell(path);
      const records = await screen.findByRole("link", { name: "Records" });
      expect(records).toHaveAttribute("href", path);
      expect(records.closest(".ant-menu-submenu")).toHaveClass(
        "ant-menu-submenu-open",
      );
      expect(records.closest(".ant-menu-item")).toHaveClass(
        "ant-menu-item-selected",
      );
    },
  );

  it("shows manager navigation for an Employee with manager capability", async () => {
    signIn("Employee");
    setManagerAccess(true);

    await renderShell();

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Team Dashboard" }),
      ).toBeInTheDocument();
    });
    MANAGER_NAV_LINKS.forEach((label) => {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    });
  });

  it("hides manager navigation for an Employee without manager capability", async () => {
    signIn("Employee");
    setManagerAccess(false);

    await renderShell();

    await waitFor(() => {
      expect(mockedGetManagerAccess).toHaveBeenCalled();
    });
    MANAGER_NAV_LINKS.forEach((label) => {
      expect(
        screen.queryByRole("link", { name: label }),
      ).not.toBeInTheDocument();
    });
  });

  it("hides manager navigation for a Manager-role user without direct reports", async () => {
    signIn("Manager");
    setManagerAccess(false);

    await renderShell();

    await waitFor(() => {
      expect(mockedGetManagerAccess).toHaveBeenCalled();
    });
    expect(
      screen.queryByRole("link", { name: "Team Dashboard" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Team Requests" }),
    ).not.toBeInTheDocument();
    // Their own profile stays reachable.
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
  });

  it("shows manager navigation for a Manager-role user with direct reports", async () => {
    signIn("Manager");
    setManagerAccess(true);

    await renderShell();

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Team Dashboard" }),
      ).toBeInTheDocument();
    });
  });

  it("keeps the CFO manager navigation regardless of the capability response", async () => {
    signIn("CFO");
    setManagerAccess(false);

    await renderShell();

    // CFO reaches the manager surface through its own mandate, so the group
    // stays put; assert on targets since "Loan Requests" appears twice.
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/manager/dashboard",
        "/manager/team",
        "/manager/team-requests",
        "/manager/loan-requests",
      ]),
    );
  });

  it("keeps the CEO team navigation regardless of the capability response", async () => {
    signIn("CEO");
    setManagerAccess(false);

    await renderShell();

    expect(
      screen.getByRole("link", { name: "Team Requests" }),
    ).toBeInTheDocument();
  });

  it("does not add manager navigation to the SystemAdmin menu", async () => {
    signIn("SystemAdmin");
    setManagerAccess(true);

    await renderShell();

    expect(
      screen.queryByRole("link", { name: "Team Dashboard" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });
});
