import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../../../services/api/leaveApi", () => ({
  getLeaveTypes: vi.fn(),
  getMyLeaveBalance: vi.fn(),
  createLeaveRequest: vi.fn(),
  getLeaveRequest: vi.fn(),
  editLeaveRequest: vi.fn(),
}));
vi.mock("../../../services/api/employeesApi", () => ({
  getEmployee: vi.fn(),
  listDelegationCandidates: vi.fn(),
}));

import RequestLeavePage from "./RequestLeavePage";
import * as leaveApi from "../../../services/api/leaveApi";
import {
  getEmployee,
  listDelegationCandidates,
} from "../../../services/api/employeesApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const m = leaveApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ok = (data: unknown) => ({ status: "success" as const, data });

const existing = {
  id: 5,
  status: "pending_manager",
  leave_type: { id: 2, name: "Sick", code: "SICK" },
  start_date: "2026-10-20",
  end_date: "2026-10-22",
  days: 3,
  reason: "Flu",
  document: "/media/leave/5.pdf",
  will_travel: false,
  delegated_to: { id: 8, email: "omar@ffi.test", full_name: "Omar Salem" },
  workflow: { status: "in_review", can_edit: true, history: [] },
};

function Landing() {
  return <div>At {useLocation().pathname}</div>;
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={["/employee/leave/requests/5/edit"]}>
      <Routes>
        <Route
          path="/employee/leave/requests/:id/edit"
          element={<RequestLeavePage mode="edit" />}
        />
        <Route path="/employee/leave/requests/:id" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function clickSave() {
  const save = screen.getByRole("button", { name: "Save changes" });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  useI18nStore.getState().setLanguage("en");
  m.getLeaveTypes.mockResolvedValue(
    ok([{ id: 2, name: "Sick", code: "SICK" }]),
  );
  m.getMyLeaveBalance.mockResolvedValue(ok([]));
  m.getLeaveRequest.mockResolvedValue(ok(existing));
  m.editLeaveRequest.mockResolvedValue(ok(existing));
  vi.mocked(listDelegationCandidates).mockReset();
  vi.mocked(getEmployee).mockResolvedValue({
    status: "success",
    data: { id: 1, is_saudi: false, nationality: "Egyptian" },
  } as never);
});

describe("RequestLeavePage edit mode", () => {
  it("prefills values, shows the hint and a read-only alternative employee", async () => {
    renderEdit();
    expect(await screen.findByDisplayValue("Flu")).toBeInTheDocument();
    expect(m.getLeaveRequest).toHaveBeenCalledWith("5");
    expect(screen.getAllByText(/until it reaches HR/).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByDisplayValue("Omar Salem")).toBeDisabled();
    expect(listDelegationCandidates).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("submits a PATCH without delegated_to and navigates back to the detail page", async () => {
    renderEdit();
    const reason = await screen.findByDisplayValue("Flu");
    fireEvent.change(reason, { target: { value: "Flu and fever" } });
    await clickSave();
    await waitFor(() => expect(m.editLeaveRequest).toHaveBeenCalledTimes(1));
    const [id, payload] = m.editLeaveRequest.mock.calls[0];
    expect(id).toBe("5");
    expect(payload).toMatchObject({
      leave_type: 2,
      start_date: "2026-10-20",
      end_date: "2026-10-22",
      reason: "Flu and fever",
      will_travel: false,
      date_of_rejoin: null,
    });
    expect(payload).not.toHaveProperty("delegated_to");
    expect(payload).not.toHaveProperty("document");
    expect(
      await screen.findByText("At /employee/leave/requests/5"),
    ).toBeInTheDocument();
  });

  it("shows the server message on a not-editable 422 and refreshes the data", async () => {
    m.editLeaveRequest.mockRejectedValue({
      response: {
        status: 422,
        data: { status: "error", message: "Request already reached HR." },
      },
    });
    renderEdit();
    await screen.findByDisplayValue("Flu");
    m.getLeaveRequest.mockResolvedValue(
      ok({
        ...existing,
        workflow: { ...existing.workflow, can_edit: false },
      }),
    );
    await clickSave();
    expect(
      (await screen.findAllByText("Request already reached HR.")).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(m.getLeaveRequest).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled(),
    );
  });

  it("maps field validation errors onto the date range", async () => {
    m.editLeaveRequest.mockRejectedValue({
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Invalid",
          errors: [{ field: "start_date", message: "Start is too early." }],
        },
      },
    });
    renderEdit();
    await screen.findByDisplayValue("Flu");
    await clickSave();
    expect(
      (await screen.findAllByText("Start is too early.")).length,
    ).toBeGreaterThan(0);
  });

  it("blocks saving when the loaded request is not editable", async () => {
    m.getLeaveRequest.mockResolvedValue(
      ok({ ...existing, workflow: { ...existing.workflow, can_edit: false } }),
    );
    renderEdit();
    await screen.findByDisplayValue("Flu");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText(/can no longer be edited/)).toBeInTheDocument();
  });
});
