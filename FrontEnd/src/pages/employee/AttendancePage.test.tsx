import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import dayjs from "dayjs";

vi.mock("../../services/api/attendanceApi", () => ({
  getMyAttendance: vi.fn(),
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  getGlobalAttendance: vi.fn(),
  overrideAttendance: vi.fn(),
}));

import EmployeeAttendancePage from "./AttendancePage";
import {
  checkIn,
  checkOut,
  getMyAttendance,
} from "../../services/api/attendanceApi";
import { useEmployeeAttendanceStore } from "../../stores/attendanceStore";
import { useI18nStore } from "../../i18n/i18nStore";
import type { AttendanceRecord } from "../../types/attendance";

const getMock = getMyAttendance as unknown as ReturnType<typeof vi.fn>;
const checkInMock = checkIn as unknown as ReturnType<typeof vi.fn>;
const checkOutMock = checkOut as unknown as ReturnType<typeof vi.fn>;

const record = (
  overrides: Partial<AttendanceRecord> = {},
): AttendanceRecord => ({
  id: 1,
  employee_profile: 42,
  date: "2026-08-11",
  check_in_at: "2026-08-11T05:00:00Z",
  check_out_at: "2026-08-11T13:30:00Z",
  status: "PRESENT",
  source: "EMPLOYEE",
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
  checkInMock.mockReset();
  checkOutMock.mockReset();
  useI18nStore.getState().setLanguage("en");
  useEmployeeAttendanceStore.getState().reset();
  getMock.mockResolvedValue(listPayload([record()]));
  checkInMock.mockResolvedValue({ status: "success", data: record() });
  checkOutMock.mockResolvedValue({ status: "success", data: record() });
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

describe("EmployeeAttendancePage refresh after check-in", () => {
  it("reloads with the range the page is showing, not the backend default", async () => {
    // Today has no record yet, so the check-in control is enabled.
    getMock.mockResolvedValue(listPayload([record({ date: "2026-08-11" })]));

    render(<EmployeeAttendancePage />);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    const initialParams = getMock.mock.calls[0][0];
    expect(initialParams).toHaveProperty("date_from");
    expect(initialParams).toHaveProperty("date_to");

    fireEvent.click(screen.getByRole("button", { name: /Check In/i }));

    await waitFor(() => expect(checkInMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    // The reload keeps date_from/date_to, so the new row cannot fall outside
    // the visible range.
    expect(getMock.mock.calls[1][0]).toEqual(initialParams);
  });

  it("reloads with the same range after a check-out", async () => {
    // The component matches today's row with `dayjs().format("YYYY-MM-DD")`,
    // which is local. `toISOString()` is UTC, so east of Greenwich the two
    // disagree either side of midnight and the row stops being "today".
    const today = dayjs().format("YYYY-MM-DD");
    getMock.mockResolvedValue(
      listPayload([record({ date: today, check_out_at: null })]),
    );

    render(<EmployeeAttendancePage />);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    const initialParams = getMock.mock.calls[0][0];

    const checkOutButton = await screen.findByRole("button", {
      name: /Check Out/i,
    });
    await waitFor(() => expect(checkOutButton).not.toBeDisabled());
    fireEvent.click(checkOutButton);

    await waitFor(() => expect(checkOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(getMock.mock.calls[1][0]).toEqual(initialParams);
  });
});
