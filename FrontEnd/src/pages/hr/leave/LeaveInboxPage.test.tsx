import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../services/api/leaveApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/api/leaveApi")
  >("../../../services/api/leaveApi");
  return {
    ...actual,
    getLeaveRequests: vi.fn(),
    getLeaveTypes: vi.fn(),
  };
});
vi.mock("../../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
  listDelegationCandidates: vi.fn(),
}));

import LeaveInboxPage from "./LeaveInboxPage";
import * as leaveApi from "../../../services/api/leaveApi";
import * as employeesApi from "../../../services/api/employeesApi";
import type { LeaveRequest } from "../../../services/api/leaveApi";
import { useI18nStore } from "../../../i18n/i18nStore";
import {
  restorePhoneViewport,
  setDesktopViewport,
} from "../../../test/viewport";

const getLeaveRequests = vi.mocked(leaveApi.getLeaveRequests);

const request = {
  id: 9,
  employee: { id: 3, full_name: "Mona Adel" },
  leave_type: { id: 1, name: "Annual Leave" },
  start_date: "2026-09-20",
  end_date: "2026-09-24",
  days: 5,
  status: "pending_hr",
  source: "employee",
  created_at: "2026-09-15T08:00:00Z",
} as unknown as LeaveRequest;

beforeEach(() => {
  getLeaveRequests.mockReset();
  getLeaveRequests.mockResolvedValue({
    status: "success",
    data: { items: [request], count: 1 },
  } as never);
  vi.mocked(leaveApi.getLeaveTypes).mockResolvedValue({
    status: "success",
    data: [],
  } as never);
  vi.mocked(employeesApi.listEmployees).mockResolvedValue({
    status: "success",
    data: { results: [], count: 0 },
  } as never);
  vi.mocked(employeesApi.listDelegationCandidates).mockResolvedValue({
    status: "success",
    data: [],
  } as never);
  useI18nStore.getState().setLanguage("en");
  setDesktopViewport();
});

afterEach(() => {
  restorePhoneViewport();
});

describe("LeaveInboxPage filters", () => {
  it("filters by status from the chips and shows the count", async () => {
    render(
      <MemoryRouter>
        <LeaveInboxPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Mona Adel")).toBeInTheDocument();
    expect(screen.getByText("1 requests")).toBeInTheDocument();

    const chips = screen.getByRole("group", { name: "Status" });
    const approved = Array.from(chips.querySelectorAll("button")).find(
      (button) => button.textContent === "Approved",
    ) as HTMLButtonElement;
    fireEvent.click(approved);

    await waitFor(() =>
      expect(getLeaveRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "approved", page: 1 }),
      ),
    );
    expect(approved).toHaveAttribute("aria-pressed", "true");

    // Reset clears every filter again.
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    await waitFor(() =>
      expect(getLeaveRequests.mock.calls.at(-1)?.[0]).not.toHaveProperty(
        "status",
      ),
    );
  });
});
