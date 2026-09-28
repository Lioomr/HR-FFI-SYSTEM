import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import RequireAuth from "./RequireAuth";
import { useAuthStore, type AuthUser } from "../auth/authStore";

const org = (id: number) => ({
  id,
  code: `C${id}`,
  name: `Company ${id}`,
  node_type: "company" as const,
  parent_id: null,
  is_active: true,
});

const user: AuthUser = {
  id: "1",
  email: "hr@example.com",
  role: "HRManager",
  accessible_organizations: [org(2), org(3)],
  default_organization_id: 2,
  active_organization_id: 2,
};

function Page() {
  const location = useLocation();
  return <div>page {`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/hr/leave/requests/:id" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth company links", () => {
  const replace = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    useAuthStore.setState({ isAuthenticated: true, user: { ...user } });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace },
    });
  });

  afterEach(() => {
    replace.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("selects the link's company before the page loads, then reopens it without the hint", async () => {
    renderAt("/hr/leave/requests/5?company=3");

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/hr/leave/requests/5"),
    );
    expect(useAuthStore.getState().user?.active_organization_id).toBe(3);
    expect(screen.queryByText(/^page/)).toBeNull();
  });

  it("opens the page directly when the link's company is not accessible", async () => {
    renderAt("/hr/leave/requests/5?company=99");

    expect(
      await screen.findByText("page /hr/leave/requests/5"),
    ).toBeInTheDocument();
    expect(useAuthStore.getState().user?.active_organization_id).toBe(2);
    expect(replace).not.toHaveBeenCalled();
  });
});
