import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../../services/api/leaveApi", () => ({
  getLeaveRequest: vi.fn(),
  getMyLeaveRequests: vi.fn(),
  cancelLeaveRequest: vi.fn(),
  getLeaveRequestDocumentBlob: vi.fn(),
  getLeaveRequestPdfBlob: vi.fn(),
  approveDelegatedLeaveRequest: vi.fn(),
  rejectDelegatedLeaveRequest: vi.fn(),
}));
vi.mock("../../../components/requests/RequestObligationsPanel", () => ({
  default: () => null,
}));

import EmployeeLeaveRequestDetailsPage from "./EmployeeLeaveRequestDetailsPage";
import MyLeaveRequestsPage from "./MyLeaveRequestsPage";
import * as leaveApi from "../../../services/api/leaveApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const m = leaveApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ok = (data: unknown) => ({ status: "success" as const, data });

const request = {
  id: 5,
  status: "pending_manager",
  employee: { id: 7, email: "sara@ffi.test", full_name: "Sara Ahmed" },
  leave_type: { id: 1, name: "Annual" },
  start_date: "2026-10-01",
  end_date: "2026-10-05",
  days: 5,
  reason: "Family trip",
  created_at: "2026-09-20T09:00:00Z",
  workflow: {
    status: "in_review",
    current_stage: "manager",
    history: [
      {
        id: 3,
        action: "edit",
        actor: { id: 7, full_name: "Sara Ahmed" },
        at: "2026-09-21T09:00:00Z",
        note: "reason",
      },
    ],
  } as Record<string, unknown>,
};

function Landing() {
  return <div>Edit route {useLocation().pathname}</div>;
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/employee/leave/requests/5"]}>
      <Routes>
        <Route
          path="/employee/leave/requests/:id"
          element={<EmployeeLeaveRequestDetailsPage />}
        />
        <Route path="/employee/leave/requests/:id/edit" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
});

describe("leave detail edit entry", () => {
  it("hides Edit when the server flag is absent or false", async () => {
    m.getLeaveRequest.mockResolvedValue(ok(request));
    renderDetail();
    await screen.findByText("Family trip");
    expect(
      screen.queryByRole("button", { name: "Edit request" }),
    ).not.toBeInTheDocument();
  });

  it("shows Edit and the recorded edit row when can_edit is true", async () => {
    m.getLeaveRequest.mockResolvedValue(
      ok({ ...request, workflow: { ...request.workflow, can_edit: true } }),
    );
    renderDetail();
    expect(await screen.findByText(/Edited by Sara/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit request" }));
    expect(
      await screen.findByText("Edit route /employee/leave/requests/5/edit"),
    ).toBeInTheDocument();
  });
});

describe("leave list edit entry", () => {
  const page = (items: unknown[]) => ({
    status: "success",
    data: { items, count: items.length },
  });

  it("shows Edit only for rows whose workflow allows it", async () => {
    m.getMyLeaveRequests.mockResolvedValue(
      page([
        {
          ...request,
          id: 5,
          workflow: { ...request.workflow, can_edit: true },
        },
        { ...request, id: 6, workflow: { ...request.workflow } },
      ]),
    );
    render(
      <MemoryRouter>
        <MyLeaveRequestsPage />
      </MemoryRouter>,
    );
    await screen.findByText("#6");
    expect(
      screen.getAllByRole("button", { name: "Edit request" }),
    ).toHaveLength(1);
  });
});
