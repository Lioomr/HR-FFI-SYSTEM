import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RequireManagerAccess from "./RequireManagerAccess";
import { useAuthStore, type Role } from "../auth/authStore";
import { resetManagerAccessCache } from "../hooks/useManagerAccess";
import {
  getManagerAccess,
  type ManagerAccess,
} from "../services/api/managerApi";

vi.mock("../services/api/managerApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/api/managerApi")>()),
  getManagerAccess: vi.fn(),
}));

const mockedGetManagerAccess = vi.mocked(getManagerAccess);

function grantAccess(overrides: Partial<ManagerAccess> = {}) {
  mockedGetManagerAccess.mockResolvedValue({
    status: "success",
    data: {
      has_access: true,
      managed_employee_count: 3,
      source: "direct_reports",
      scopes: ["leave", "loan", "attendance", "asset", "announcement"],
      ...overrides,
    },
  });
}

function denyAccess() {
  mockedGetManagerAccess.mockResolvedValue({
    status: "success",
    data: {
      has_access: false,
      managed_employee_count: 0,
      source: "none",
      scopes: [],
    },
  });
}

function signIn(role: Role) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "7", email: "user@ffi.test", role },
  });
}

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/manager/dashboard"]}>
      <Routes>
        <Route
          element={
            <RequireManagerAccess allowRoles={["CEO", "CFO", "SystemAdmin"]} />
          }
        >
          <Route
            path="/manager/dashboard"
            element={<div>Team dashboard content</div>}
          />
        </Route>
        <Route path="/unauthorized" element={<div>Unauthorized page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireManagerAccess", () => {
  beforeEach(() => {
    resetManagerAccessCache();
    mockedGetManagerAccess.mockReset();
  });

  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
  });

  it("lets an Employee with manager capability reach /manager/dashboard", async () => {
    signIn("Employee");
    grantAccess();

    renderGuard();

    expect(
      await screen.findByText("Team dashboard content"),
    ).toBeInTheDocument();
  });

  it("shows a loading state while the capability is being resolved", async () => {
    signIn("Employee");
    grantAccess();

    renderGuard();

    expect(
      screen.getByRole("status", { name: "Checking manager access..." }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Team dashboard content"),
    ).toBeInTheDocument();
  });

  it("blocks an Employee without manager capability", async () => {
    signIn("Employee");
    denyAccess();

    renderGuard();

    expect(
      await screen.findByText("Manager access not available"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Team dashboard content"),
    ).not.toBeInTheDocument();
  });

  it("blocks a Manager-role user who has no direct reports", async () => {
    signIn("Manager");
    denyAccess();

    renderGuard();

    expect(
      await screen.findByText("Manager access not available"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Team dashboard content"),
    ).not.toBeInTheDocument();
  });

  it("admits a Manager-role user who has direct reports", async () => {
    signIn("Manager");
    grantAccess();

    renderGuard();

    expect(
      await screen.findByText("Team dashboard content"),
    ).toBeInTheDocument();
  });

  it.each<Role>(["CEO", "CFO", "SystemAdmin"])(
    "keeps %s access without needing the capability call",
    async (role) => {
      signIn(role);
      denyAccess();

      renderGuard();

      expect(
        await screen.findByText("Team dashboard content"),
      ).toBeInTheDocument();
      expect(mockedGetManagerAccess).not.toHaveBeenCalled();
    },
  );

  it("denies access when the capability request fails", async () => {
    signIn("Employee");
    mockedGetManagerAccess.mockRejectedValue(new Error("network down"));

    renderGuard();

    expect(
      await screen.findByText("Manager access not available"),
    ).toBeInTheDocument();
  });

  it("redirects to /unauthorized when there is no signed-in user", () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });

    renderGuard();

    expect(screen.getByText("Unauthorized page")).toBeInTheDocument();
  });
});
