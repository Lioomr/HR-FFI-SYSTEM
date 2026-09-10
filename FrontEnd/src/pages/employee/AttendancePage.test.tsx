import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { message } from "antd";

vi.mock("../../services/api/attendanceApi", () => ({
  getMyAttendance: vi.fn(),
  getGlobalAttendance: vi.fn(),
}));

import EmployeeAttendancePage from "./AttendancePage";
import { getMyAttendance } from "../../services/api/attendanceApi";
import { useEmployeeAttendanceStore } from "../../stores/attendanceStore";
import { useI18nStore } from "../../i18n/i18nStore";
import type { AttendanceRecord } from "../../types/attendance";

const getMock = getMyAttendance as unknown as ReturnType<typeof vi.fn>;

const record = (
  overrides: Partial<AttendanceRecord> = {},
): AttendanceRecord => ({
  id: 1,
  employee_profile: 42,
  date: "2026-08-11",
  check_in_at: "2026-08-11T05:00:00Z",
  check_out_at: "2026-08-11T13:30:00Z",
  status: "PRESENT",
  source: "SYSTEM",
  is_overridden: false,
  override_reason: null,
  notes: null,
  created_at: "2026-08-11T05:00:00Z",
  updated_at: "2026-08-11T13:30:00Z",
  ...overrides,
});

const listPayload = (items: AttendanceRecord[]) => ({
  status: "success" as const,
  data: { items, count: items.length, page: 1, page_size: 25 },
});

/**
 * The shared jsdom shim answers every media query with `matches: false`, which
 * is the phone layout: antd then hides the columns marked `responsive: ["sm"]`.
 * Call this to exercise the desktop layout instead.
 */
function useDesktopViewport() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  getMock.mockReset();
  useI18nStore.getState().setLanguage("en");
  useEmployeeAttendanceStore.getState().reset();
  getMock.mockResolvedValue(listPayload([record()]));
});

describe("EmployeeAttendancePage status display", () => {
  it("keeps LATE, ABSENT and pending approval visually distinct", async () => {
    getMock.mockResolvedValue(
      listPayload([
        record({ id: 1, date: "2026-08-11", status: "LATE", late_minutes: 23 }),
        record({
          id: 2,
          date: "2026-08-10",
          status: "ABSENT",
          check_in_at: null,
          check_out_at: null,
        }),
        record({
          id: 3,
          date: "2026-08-09",
          status: "PENDING_HR",
          is_late_flagged: true,
        }),
      ]),
    );

    render(<EmployeeAttendancePage />);

    const table = await screen.findByRole("table");
    // Three separate states, never collapsed into one another.
    expect(within(table).getByText("LATE")).toBeInTheDocument();
    expect(within(table).getByText("ABSENT")).toBeInTheDocument();
    expect(within(table).getByText("PENDING_HR")).toBeInTheDocument();
  });

  it("shows the backend late minutes and flags a late arrival still awaiting approval", async () => {
    useDesktopViewport();
    getMock.mockResolvedValue(
      listPayload([
        record({ id: 1, date: "2026-08-11", status: "LATE", late_minutes: 23 }),
        record({
          id: 2,
          date: "2026-08-10",
          status: "PENDING_HR",
          is_late_flagged: true,
          late_minutes: 0,
        }),
        record({
          id: 3,
          date: "2026-08-09",
          status: "PRESENT",
          late_minutes: 0,
        }),
      ]),
    );

    render(<EmployeeAttendancePage />);

    const table = await screen.findByRole("table");
    // The figure comes from the backend, not from a client-side recomputation.
    expect(within(table).getByText("+23m")).toBeInTheDocument();
    // `is_late_flagged` is the stable signal while the row is only PENDING_*.
    expect(within(table).getByText("Late arrival")).toBeInTheDocument();
    // A zero stays a dash rather than "+0m".
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps the late-arrival flag visible on the phone layout", async () => {
    // The late-minutes column is `responsive: ["sm"]`, so on a phone the flag in
    // the always-visible status column is the only late signal left.
    getMock.mockResolvedValue(
      listPayload([
        record({
          id: 1,
          date: "2026-08-10",
          status: "PENDING_HR",
          is_late_flagged: true,
        }),
      ]),
    );

    render(<EmployeeAttendancePage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("PENDING_HR")).toBeInTheDocument();
    expect(within(table).getByText("Late arrival")).toBeInTheDocument();
  });

  it("does not invent rows the backend did not send", async () => {
    // A pre-hire day produces no absence record server-side; the page must not
    // synthesise one to fill the selected range.
    getMock.mockResolvedValue(listPayload([]));

    render(<EmployeeAttendancePage />);

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const table = await screen.findByRole("table");
    expect(within(table).queryByText("ABSENT")).toBeNull();
  });
});

describe("BioTime-only attendance", () => {
  it("has no punch controls and refreshes the read-only range", async () => {
    render(<EmployeeAttendancePage />);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText("Attendance is recorded through BioTime."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /check in|check out/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1][0]).toEqual(getMock.mock.calls[0][0]);
  });
  it("clears previous history and shows unmapped access as information without a toast", async () => {
    const toast = vi.spyOn(message, "error");
    const text =
      "Attendance is unavailable until your BioTime mapping is completed. Contact HR to be registered on a BioTime device.";
    useEmployeeAttendanceStore.setState({ records: [record()], total: 1 });
    getMock.mockRejectedValue({
      response: { status: 403, data: { message: text } },
    });
    render(<EmployeeAttendancePage />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
    expect(useEmployeeAttendanceStore.getState().error).toBeNull();
    toast.mockRestore();
  });
});
