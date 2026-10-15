import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
vi.mock("../../../services/api/leaveApi", () => ({
  getMyLeaveRequests: vi.fn(),
  cancelLeaveRequest: vi.fn(),
  getLeaveRequestPdfBlob: vi.fn(),
}));
import MyLeaveRequestsPage from "./MyLeaveRequestsPage";
import {
  getMyLeaveRequests,
  cancelLeaveRequest,
} from "../../../services/api/leaveApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const pending = {
  id: 5,
  status: "pending_hr",
  leave_type: { name: "Annual" },
  workflow: { status: "in_review", can_cancel: true, history: [] },
};
const page = (items: unknown[]) => ({
  status: "success",
  data: { items, count: items.length },
});
beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});
describe("employee leave list cancellation", () => {
  it("confirms before cancelling and refreshes the list", async () => {
    vi.mocked(getMyLeaveRequests)
      .mockResolvedValueOnce(page([pending]) as never)
      .mockResolvedValue(
        page([
          {
            ...pending,
            status: "cancelled",
            workflow: { ...pending.workflow, can_cancel: false },
          },
        ]) as never,
      );
    vi.mocked(cancelLeaveRequest).mockResolvedValue({
      status: "success",
      data: { ...pending, status: "cancelled" },
    } as never);
    render(
      <MemoryRouter>
        <MyLeaveRequestsPage />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel request" }),
    );
    expect(cancelLeaveRequest).not.toHaveBeenCalled();
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel request",
      }),
    );
    await waitFor(() => expect(getMyLeaveRequests).toHaveBeenCalledTimes(2));
    expect(cancelLeaveRequest).toHaveBeenCalledWith(5);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel request" }),
      ).not.toBeInTheDocument(),
    );
  });
  it("fails closed when pending items lack the flag or workflow disallows it", async () => {
    vi.mocked(getMyLeaveRequests).mockResolvedValue(
      page([
        { ...pending, workflow: undefined },
        {
          ...pending,
          id: 6,
          can_cancel: true,
          workflow: { ...pending.workflow, can_cancel: false },
        },
      ]) as never,
    );
    render(
      <MemoryRouter>
        <MyLeaveRequestsPage />
      </MemoryRouter>,
    );
    await screen.findByText("#6");
    expect(
      screen.queryByRole("button", { name: "Cancel request" }),
    ).not.toBeInTheDocument();
  });
});
