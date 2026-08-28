import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/managerApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api/managerApi")>()),
  getManagerAccess: vi.fn(),
  getManagerAssetReturnRequests: vi.fn(),
  getManagerLeaveRequests: vi.fn(),
  getManagerTeam: vi.fn(),
  approveLeaveRequestManager: vi.fn(),
  rejectLeaveRequestManager: vi.fn(),
  approveManagerAssetReturnRequest: vi.fn(),
  rejectManagerAssetReturnRequest: vi.fn(),
}));

vi.mock(
  "../../services/api/attendanceCorrectionsApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../services/api/attendanceCorrectionsApi")
    >()),
    listAttendanceCorrectionRequests: vi.fn(),
  }),
);

import ManagerTeamRequestsPage from "./ManagerTeamRequestsPage";
import { listAttendanceCorrectionRequests } from "../../services/api/attendanceCorrectionsApi";
import {
  approveLeaveRequestManager,
  getManagerAccess,
  getManagerAssetReturnRequests,
  getManagerLeaveRequests,
  getManagerTeam,
  rejectLeaveRequestManager,
  type ManagerLeaveRequest,
} from "../../services/api/managerApi";
import { resetManagerAccessCache } from "../../hooks/useManagerAccess";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";

const mockedAccess = vi.mocked(getManagerAccess);
const mockedLeave = vi.mocked(getManagerLeaveRequests);
const mockedAssets = vi.mocked(getManagerAssetReturnRequests);
const mockedTeam = vi.mocked(getManagerTeam);
const mockedApprove = vi.mocked(approveLeaveRequestManager);
const mockedReject = vi.mocked(rejectLeaveRequestManager);
const mockedCorrections = vi.mocked(listAttendanceCorrectionRequests);

const PENDING_LEAVE: ManagerLeaveRequest = {
  id: 42,
  employee: { id: 11, email: "sara@ffi.test", full_name: "Sara Idris" },
  leave_type: { id: 1, name: "Annual", code: "ANN" },
  start_date: "2026-08-20",
  end_date: "2026-08-24",
  days: 5,
  reason: "Family trip",
  status: "pending_manager",
  created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
};

const DECIDED_LEAVE: ManagerLeaveRequest = {
  ...PENDING_LEAVE,
  id: 43,
  employee: { id: 12, email: "omar@ffi.test", full_name: "Omar Nabil" },
  status: "approved",
};

function renderPage(path = "/manager/team-requests") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/manager/team-requests"
          element={<ManagerTeamRequestsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ManagerTeamRequestsPage", () => {
  const promptSpy = vi.fn();

  beforeEach(() => {
    resetManagerAccessCache();
    vi.clearAllMocks();
    useI18nStore.getState().setLanguage("en");
    window.prompt = promptSpy;
    mockedAccess.mockResolvedValue({
      status: "success",
      data: {
        has_access: true,
        managed_employee_count: 3,
        source: "direct_reports",
        scopes: ["leave"],
      },
    });
    mockedLeave.mockResolvedValue({
      status: "success",
      data: [PENDING_LEAVE, DECIDED_LEAVE],
    });
    mockedAssets.mockResolvedValue({ status: "success", data: [] });
    mockedTeam.mockResolvedValue({ status: "success", data: [] });
    mockedCorrections.mockResolvedValue({
      status: "success",
      data: { count: 0, next: null, previous: null, results: [] },
    });
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "21", email: "lead@ffi.test", role: "Employee" },
    });
  });

  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
  });

  it("shows the outstanding count per tab and totals them in the header", async () => {
    // One of the two leave rows is still awaiting the manager, plus two
    // attendance corrections whose table owns its own status filter.
    mockedCorrections.mockResolvedValue({
      status: "success",
      data: { count: 2, next: null, previous: null, results: [] },
    });

    renderPage();

    expect(await screen.findByText("3 awaiting you")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Leave Requests/ }),
    ).toHaveTextContent("1");
    expect(
      screen.getByRole("tab", { name: /Attendance Corrections/ }),
    ).toHaveTextContent("2");
  });

  it("offers approve and reject only on rows still awaiting the manager", async () => {
    renderPage();

    expect(
      await screen.findByRole("button", { name: "Approve: Sara Idris" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve: Omar Nabil" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("rejects through a modal with a required reason, never window.prompt", async () => {
    mockedReject.mockResolvedValue({ status: "success", data: {} } as never);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject: Sara Idris" }),
    );

    // The dialog is the only way to give a reason.
    const dialog = await screen.findByRole("dialog");
    expect(promptSpy).not.toHaveBeenCalled();
    expect(
      within(dialog).getByText("Reject leave request"),
    ).toBeInTheDocument();

    // Submitting without a reason is refused.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reject request" }),
    );
    expect(
      await within(dialog).findByText("A rejection reason is required."),
    ).toBeInTheDocument();
    expect(mockedReject).not.toHaveBeenCalled();

    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Reason for rejection" }),
      {
        target: { value: "Coverage already booked" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reject request" }),
    );

    await waitFor(() =>
      expect(mockedReject).toHaveBeenCalledWith(42, "Coverage already booked"),
    );
  });

  it("approves a request and reloads the queue", async () => {
    mockedApprove.mockResolvedValue({ status: "success", data: {} } as never);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Idris" }),
    );

    await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith(42));
    // One initial load plus the reload after the decision.
    await waitFor(() => expect(mockedLeave).toHaveBeenCalledTimes(2));
  });

  it("shows the no-pending-requests empty state when the queue is clear", async () => {
    mockedLeave.mockResolvedValue({ status: "success", data: [] });

    renderPage();

    expect(
      await screen.findByText("No pending team requests"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your team has no requests waiting for your approval right now.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No employees assigned to you yet"),
    ).not.toBeInTheDocument();
  });

  it("filters the leave queue by employee", async () => {
    renderPage();
    await screen.findByText("Sara Idris");

    fireEvent.change(
      screen.getByRole("textbox", { name: /Search by employee/ }),
      {
        target: { value: "omar" },
      },
    );

    await waitFor(() =>
      expect(screen.queryByText("Sara Idris")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Omar Nabil")).toBeInTheDocument();
  });
});
