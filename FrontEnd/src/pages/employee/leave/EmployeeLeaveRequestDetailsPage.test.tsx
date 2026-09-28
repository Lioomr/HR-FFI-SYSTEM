import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../services/api/leaveApi", () => ({
  getLeaveRequest: vi.fn(),
  getLeaveRequestDocumentBlob: vi.fn(),
  getLeaveRequestPdfBlob: vi.fn(),
  approveDelegatedLeaveRequest: vi.fn(),
  rejectDelegatedLeaveRequest: vi.fn(),
}));

// The obligations panel talks to its own endpoints and is out of scope here.
vi.mock("../../../components/requests/RequestObligationsPanel", () => ({
  default: () => null,
}));

import EmployeeLeaveRequestDetailsPage from "./EmployeeLeaveRequestDetailsPage";
import * as leaveApi from "../../../services/api/leaveApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const mocked = leaveApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const request = {
  id: 5,
  status: "pending_delegate",
  employee: { id: 7, email: "sara@ffi.test", full_name: "Sara Ahmed" },
  leave_type: { id: 1, name: "Annual" },
  start_date: "2026-10-01",
  end_date: "2026-10-05",
  days: 5,
  reason: "Family trip",
  document: "/media/leave/5.txt",
  created_at: "2026-09-20T09:00:00Z",
  workflow: {
    status: "in_review",
    current_stage: "delegate",
    can_approve: true,
    can_reject: true,
    history: [],
  },
};

const ok = (data: unknown) => ({ status: "success" as const, data });

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/employee/delegated-approvals/leave/:id"
          element={<EmployeeLeaveRequestDetailsPage />}
        />
        <Route
          path="/employee/leave/requests/:id"
          element={<EmployeeLeaveRequestDetailsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(mocked).forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
});

describe("EmployeeLeaveRequestDetailsPage", () => {
  it("approves a delegated request from the sticky decision bar", async () => {
    mocked.getLeaveRequest.mockResolvedValue(ok(request));
    mocked.approveDelegatedLeaveRequest.mockResolvedValue(
      ok({ ...request, status: "pending_manager" }),
    );

    renderPage("/employee/delegated-approvals/leave/5");

    const bar = await screen.findByRole("region", { name: "Decision actions" });
    expect(
      within(bar).getByRole("button", { name: "Reject: Sara Ahmed" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(bar).getByRole("button", { name: "Approve: Sara Ahmed" }),
    );

    await waitFor(() =>
      expect(mocked.approveDelegatedLeaveRequest).toHaveBeenCalledWith(5),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Decision actions" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows no decision bar when the viewer cannot act", async () => {
    mocked.getLeaveRequest.mockResolvedValue(
      ok({
        ...request,
        status: "pending_manager",
        workflow: { ...request.workflow, current_stage: "manager" },
      }),
    );

    renderPage("/employee/leave/requests/5");

    expect(await screen.findByText("Family trip")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Decision actions" }),
    ).not.toBeInTheDocument();
  });

  it("previews the attachment inside the app, not in a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mocked.getLeaveRequest.mockResolvedValue(ok(request));
    // Not a PDF or image, so the modal falls back to its download notice.
    mocked.getLeaveRequestDocumentBlob.mockResolvedValue(
      new Blob(["plain"], { type: "text/plain" }),
    );

    renderPage("/employee/leave/requests/5");

    fireEvent.click(await screen.findByRole("button", { name: /Preview/ }));

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "This file cannot be previewed here. Download it to view.",
      ),
    ).toBeInTheDocument();
    expect(mocked.getLeaveRequestDocumentBlob).toHaveBeenCalledWith(5, false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
