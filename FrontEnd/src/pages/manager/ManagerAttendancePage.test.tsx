import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("../../services/api/managerApi", () => ({
  getManagerAttendance: vi.fn(),
}));
import { getManagerAttendance } from "../../services/api/managerApi";
import ManagerAttendancePage from "./ManagerAttendancePage";
import { useI18nStore } from "../../i18n/i18nStore";
beforeEach(() => {
  vi.clearAllMocks();
  useI18nStore.getState().setLanguage("en");
});
describe("Manager BioTime attendance", () => {
  it("renders the scoped records without mutations and preserves server pagination", async () => {
    vi.mocked(getManagerAttendance).mockResolvedValue({
      status: "success",
      data: {
        results: [
          {
            id: 1,
            employee_name: "Mapped Direct Report",
            date: "2026-09-01",
            status: "PRESENT",
            check_in_at: "2026-09-01T08:00:00Z",
            check_out_at: "2026-09-01T16:00:00Z",
          },
        ],
        count: 26,
      },
    } as never);
    render(<ManagerAttendancePage />);
    expect(await screen.findByText("Mapped Direct Report")).toBeInTheDocument();
    expect(
      screen.getByText("Attendance is recorded through BioTime."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /approve|reject|edit|override|correct/i,
      }),
    ).not.toBeInTheDocument();
    expect(getManagerAttendance).toHaveBeenCalledWith({
      status: undefined,
      page: 1,
      page_size: 25,
    });
    fireEvent.click(screen.getByTitle("2"));
    await waitFor(() =>
      expect(getManagerAttendance).toHaveBeenLastCalledWith({
        status: undefined,
        page: 2,
        page_size: 25,
      }),
    );
  });
  it("renders no employee rows when the scoped API returns none", async () => {
    vi.mocked(getManagerAttendance).mockResolvedValue({
      status: "success",
      data: { results: [], count: 0 },
    });
    render(<ManagerAttendancePage />);
    await waitFor(() => expect(getManagerAttendance).toHaveBeenCalled());
    expect(screen.queryByText("Mapped Direct Report")).not.toBeInTheDocument();
  });
});
