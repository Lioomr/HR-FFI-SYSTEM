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
  getManagerLeaveRequest: vi.fn(),
  approveLeaveRequestManager: vi.fn(),
  rejectLeaveRequestManager: vi.fn(),
  getManagerLeaveRequestDocumentBlob: vi.fn(),
}));

// The obligations panel talks to its own endpoints and is out of scope here.
vi.mock("../../components/requests/RequestObligationsPanel", () => ({
  default: () => null,
}));

import ManagerLeaveRequestDetailsPage from "./ManagerLeaveRequestDetailsPage";
import {
  approveLeaveRequestManager,
  getManagerLeaveRequest,
  getManagerLeaveRequestDocumentBlob,
  rejectLeaveRequestManager,
  type ManagerLeaveRequest,
} from "../../services/api/managerApi";
import { useAuthStore } from "../../auth/authStore";
import { useI18nStore } from "../../i18n/i18nStore";

const mockedFetch = vi.mocked(getManagerLeaveRequest);
const mockedApprove = vi.mocked(approveLeaveRequestManager);
const mockedReject = vi.mocked(rejectLeaveRequestManager);
const mockedDocument = vi.mocked(getManagerLeaveRequestDocumentBlob);

const BASE: ManagerLeaveRequest = {
  id: 9,
  employee: { id: 11, email: "sara@ffi.test", full_name: "Sara Idris" },
  leave_type: { id: 1, name: "Annual", code: "ANN" },
  start_date: "2026-08-20",
  end_date: "2026-08-24",
  days: 5,
  reason: "Family trip",
  document: null,
  status: "pending_manager",
  created_at: new Date(Date.now() - 86_400_000).toISOString(),
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/leave/requests/9"]}>
      <Routes>
        <Route
          path="/manager/leave/requests/:id"
          element={<ManagerLeaveRequestDetailsPage />}
        />
        <Route
          path="/manager/team-requests"
          element={<div>Team requests</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ManagerLeaveRequestDetailsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.getState().setLanguage("en");
    mockedFetch.mockResolvedValue({ status: "success", data: BASE });
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "21", email: "lead@ffi.test", role: "Employee" },
    });
  });

  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
  });

  it("summarises the employee and the request", async () => {
    renderPage();

    expect(await screen.findByText("Request")).toBeInTheDocument();
    expect(screen.getAllByText("Sara Idris").length).toBeGreaterThan(0);
    expect(screen.getByText("Annual")).toBeInTheDocument();
    expect(screen.getByText("Family trip")).toBeInTheDocument();
    expect(screen.getByText("Approval trail")).toBeInTheDocument();
  });

  it("offers approve and reject in the sticky decision bar while the manager decides", async () => {
    renderPage();

    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(
      within(bar).getByRole("button", { name: "Approve: Sara Idris" }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("button", { name: "Reject: Sara Idris" }),
    ).toBeInTheDocument();
  });

  it("hides the decision controls once the request has moved on", async () => {
    mockedFetch.mockResolvedValue({
      status: "success",
      data: { ...BASE, status: "pending_hr" },
    });

    renderPage();

    expect(
      await screen.findByText(
        "This request is no longer waiting for your decision.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve: Sara Idris" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject: Sara Idris" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Decision actions" }),
    ).not.toBeInTheDocument();
  });

  it("previews the attached document inside the app, not in a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mockedFetch.mockResolvedValue({
      status: "success",
      data: { ...BASE, document: "/media/leave/9.txt" },
    });
    // Not a PDF or image, so the modal falls back to its download notice.
    mockedDocument.mockResolvedValue(
      new Blob(["plain"], { type: "text/plain" }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Preview/ }));

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "This file cannot be previewed here. Download it to view.",
      ),
    ).toBeInTheDocument();
    expect(mockedDocument).toHaveBeenCalledWith(9, false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("confirms an approval through a dialog", async () => {
    mockedApprove.mockResolvedValue({ status: "success", data: {} } as never);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Idris" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith(9));
  });

  it("requires a written reason before rejecting", async () => {
    mockedReject.mockResolvedValue({ status: "success", data: {} } as never);

    renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject: Sara Idris" }),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Reason for rejection" }),
      {
        target: { value: "Peak season" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reject Request" }),
    );

    await waitFor(() =>
      expect(mockedReject).toHaveBeenCalledWith(9, "Peak season"),
    );
  });

  it("shows a no-permission state for a request outside the manager's team", async () => {
    mockedFetch.mockRejectedValue({ response: { status: 403 } });

    renderPage();

    expect(
      await screen.findByText("You cannot review this request"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This request belongs to an employee outside your team, or it has already moved to another approval stage.",
      ),
    ).toBeInTheDocument();
  });
});
