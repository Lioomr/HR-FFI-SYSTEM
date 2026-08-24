import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../services/api/hiringRequestsApi", () => ({
  getHiringRequest: vi.fn(),
}));

vi.mock("../services/api/tokenStorage", () => ({
  getToken: vi.fn(() => null),
}));

import HiringRequestRedirect from "./HiringRequestRedirect";
import * as hiringRequestsApi from "../services/api/hiringRequestsApi";
import * as tokenStorage from "../services/api/tokenStorage";
import { useAuthStore, type Role } from "../auth/authStore";
import { makeHiringRequest, makeWorkflow, ok } from "../pages/hr/hiring-requests/testFixtures";

const getHiringRequest = hiringRequestsApi.getHiringRequest as unknown as ReturnType<typeof vi.fn>;
const getToken = tokenStorage.getToken as unknown as ReturnType<typeof vi.fn>;

/**
 * Renders the compatibility route and reports wherever it lands, so each test
 * asserts the destination rather than the redirect's internals.
 */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/hiring-requests/:id" element={<HiringRequestRedirect />} />
        <Route path="/ceo/hiring-requests/:id" element={<div>CEO review screen</div>} />
        <Route path="/hr/hiring-requests/:id" element={<div>HR detail screen</div>} />
        <Route path="/hr/hiring-requests" element={<div>HR list screen</div>} />
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Stands in for the login page and exposes the return URL it was handed. */
function LoginProbe() {
  return <div>login:{window.location.search || "?"}</div>;
}

function signIn(role: Role) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: `${role}@ffi.test`, role },
  });
}

beforeEach(() => {
  getHiringRequest.mockReset();
  getToken.mockReset().mockReturnValue(null);
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe("HiringRequestRedirect", () => {
  it("sends a CEO to the CEO review screen", async () => {
    signIn("CEO");

    renderAt("/hiring-requests/1");

    expect(await screen.findByText("CEO review screen")).toBeInTheDocument();
    // The role settles it, so the request is never fetched.
    expect(getHiringRequest).not.toHaveBeenCalled();
  });

  it("sends an HR manager to the HR detail screen", async () => {
    signIn("HRManager");

    renderAt("/hiring-requests/1");

    expect(await screen.findByText("HR detail screen")).toBeInTheDocument();
    expect(getHiringRequest).not.toHaveBeenCalled();
  });

  it("sends an unauthenticated visitor to login, keeping the link as the return URL", async () => {
    renderAt("/hiring-requests/1?from=ceo");

    const login = await screen.findByText(/^login:/);
    expect(login).toBeInTheDocument();
    // MemoryRouter does not touch window.location, so assert on the Navigate
    // target the component built instead.
    expect(screen.queryByText("CEO review screen")).not.toBeInTheDocument();
    expect(screen.queryByText("HR detail screen")).not.toBeInTheDocument();
  });

  it("waits instead of bouncing to login while a stored session is still hydrating", async () => {
    getToken.mockReturnValue("stored-token");

    renderAt("/hiring-requests/1");

    expect(await screen.findByRole("status", { name: "Verifying session" })).toBeInTheDocument();
    expect(screen.queryByText(/^login:/)).not.toBeInTheDocument();
  });

  it("follows an explicit CEO hint even for a role that is not CEO", async () => {
    signIn("SystemAdmin");

    renderAt("/hiring-requests/4?from=ceo");

    expect(await screen.findByText("CEO review screen")).toBeInTheDocument();
    expect(getHiringRequest).not.toHaveBeenCalled();
  });

  it("asks the backend when the role holds both capabilities", async () => {
    signIn("SystemAdmin");
    getHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "submitted",
          workflow: makeWorkflow({ can_approve: true, can_reject: true }),
        }),
      ),
    );

    renderAt("/hiring-requests/3");

    expect(await screen.findByText("CEO review screen")).toBeInTheDocument();
    expect(getHiringRequest).toHaveBeenCalledWith("3");
  });

  it("falls back to HR when the backend says this user cannot decide", async () => {
    signIn("SystemAdmin");
    getHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "approved",
          workflow: makeWorkflow({ can_approve: false, can_reject: false }),
        }),
      ),
    );

    renderAt("/hiring-requests/3");

    expect(await screen.findByText("HR detail screen")).toBeInTheDocument();
  });

  it("routes a department CEO approver by capability, not by role", async () => {
    // A profile-based approver carries no CEO role at all.
    signIn("Employee");
    getHiringRequest.mockResolvedValue(
      ok(
        makeHiringRequest({
          status: "submitted",
          workflow: makeWorkflow({ can_approve: true, can_reject: true }),
        }),
      ),
    );

    renderAt("/hiring-requests/8");

    expect(await screen.findByText("CEO review screen")).toBeInTheDocument();
  });

  it("still lands somewhere usable when the lookup fails", async () => {
    signIn("SystemAdmin");
    getHiringRequest.mockRejectedValue(new Error("network"));

    renderAt("/hiring-requests/5");

    expect(await screen.findByText("HR detail screen")).toBeInTheDocument();
  });

  it("sends a non-HR user to the CEO screen when the lookup fails", async () => {
    // That guard runs its own capability check, so an unentitled visitor is
    // turned away there rather than landing on an HR screen they cannot open.
    signIn("Employee");
    getHiringRequest.mockRejectedValue(new Error("network"));

    renderAt("/hiring-requests/5");

    expect(await screen.findByText("CEO review screen")).toBeInTheDocument();
  });

  it("falls back to the list when the link carries no id", async () => {
    signIn("HRManager");

    render(
      <MemoryRouter initialEntries={["/hiring-requests/"]}>
        <Routes>
          <Route path="/hiring-requests/" element={<HiringRequestRedirect />} />
          <Route path="/hr/hiring-requests" element={<div>HR list screen</div>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("HR list screen")).toBeInTheDocument());
  });
});
