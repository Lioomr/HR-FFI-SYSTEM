import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../../services/api/attendanceApi", () => ({
  getGlobalAttendance: vi.fn(),
  getCEOAttendance: vi.fn(),
}));

vi.mock("../../services/api/employeesApi", () => ({
  listEmployees: vi.fn(),
}));

vi.mock("../../utils/download", () => ({
  downloadBlob: vi.fn(),
}));

import AttendancePreviewPage from "./AttendancePreviewPage";
import {
  getCEOAttendance,
  getGlobalAttendance,
} from "../../services/api/attendanceApi";
import { listEmployees } from "../../services/api/employeesApi";
import type { Employee } from "../../services/api/employeesApi";
import { downloadBlob } from "../../utils/download";
import type { AttendanceRecord } from "../../types/attendance";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getGlobal = getGlobalAttendance as unknown as ReturnType<typeof vi.fn>;
const getCEO = getCEOAttendance as unknown as ReturnType<typeof vi.fn>;
const listEmployeesMock = listEmployees as unknown as ReturnType<typeof vi.fn>;
const downloadBlobMock = downloadBlob as unknown as ReturnType<typeof vi.fn>;

const record = (
  overrides: Partial<AttendanceRecord> = {},
): AttendanceRecord => ({
  id: 1,
  employee_profile: 42,
  employee_name: "Sara Ali",
  employee_name_en: "Sara Ali",
  employee_name_ar: "سارة علي",
  employee_email: "sara@ffi.test",
  date: "2026-08-11",
  check_in_at: "2026-08-11T05:00:00Z",
  check_out_at: "2026-08-11T13:30:00Z",
  status: "PRESENT",
  source: "SYSTEM",
  biotime_emp_code: "100001",
  biotime_terminal_sn: "SN-ABC-123",
  is_overridden: false,
  override_reason: null,
  notes: null,
  created_at: "2026-08-11T05:00:00Z",
  updated_at: "2026-08-11T13:30:00Z",
  ...overrides,
});

const listResponse = (items: AttendanceRecord[], count = items.length) => ({
  status: "success" as const,
  data: {
    items,
    count,
    page: 1,
    page_size: 20,
    summary: { PRESENT: count },
  },
});

const employee = (overrides: Partial<Employee> = {}): Employee =>
  ({
    id: 42,
    employee_id: "FFI-042",
    user_id: 9,
    full_name: "Sara Ali",
    full_name_en: "Sara Ali",
    email: "sara@ffi.test",
    employee_number: "E-042",
    ...overrides,
  }) as Employee;

/** The status chips share their labels with the summary tiles, so pick the chip. */
const statusChip = (label: string) => {
  const chip = screen
    .getAllByText(label)
    .map((node) => node.closest(".ant-tag-checkable"))
    .find(Boolean);
  if (!chip) throw new Error(`No status chip found for "${label}"`);
  return chip as HTMLElement;
};

const lastGlobalParams = () =>
  getGlobal.mock.calls[getGlobal.mock.calls.length - 1][0];

beforeEach(() => {
  getGlobal.mockReset();
  getCEO.mockReset();
  listEmployeesMock.mockReset();
  downloadBlobMock.mockReset();

  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });

  getGlobal.mockResolvedValue(listResponse([record()]));
  getCEO.mockResolvedValue(listResponse([record()]));
  listEmployeesMock.mockResolvedValue({
    status: "success",
    data: { results: [employee()], count: 1 },
  });
});

describe("AttendancePreviewPage BioTime fields", () => {
  it("renders the device code, terminal serial, duration, source and override state", async () => {
    render(<AttendancePreviewPage role="hr" />);

    expect(await screen.findByText("Sara Ali")).toBeInTheDocument();
    expect(screen.getByText("100001")).toBeInTheDocument();
    expect(screen.getByText("SN-ABC-123")).toBeInTheDocument();
    expect(screen.getByText("8h 30m")).toBeInTheDocument();
    expect(screen.getByText("2026-08-11")).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("System")).toBeInTheDocument();
    expect(within(table).getByText("Original")).toBeInTheDocument();
  });

  it("marks overridden records and falls back to a dash without BioTime data", async () => {
    getGlobal.mockResolvedValue(
      listResponse([
        record({
          source: "HR",
          biotime_emp_code: null,
          biotime_terminal_sn: null,
          check_out_at: null,
          is_overridden: true,
          override_reason: "Manual correction",
        }),
      ]),
    );

    render(<AttendancePreviewPage role="hr" />);

    expect(await screen.findByText("Overridden")).toBeInTheDocument();
    const table = screen.getByRole("table");
    // Device code, terminal S/N, check-out and duration all render as "-".
    expect(within(table).getAllByText("-")).toHaveLength(4);
  });

  it("exposes columns for the BioTime identifiers", async () => {
    render(<AttendancePreviewPage role="hr" />);

    await screen.findByText("Sara Ali");
    expect(
      screen.getByRole("columnheader", { name: "Device ID" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Terminal S/N" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Duration" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Override" }),
    ).toBeInTheDocument();
  });
});

describe("AttendancePreviewPage filters", () => {
  it("sends the default date range and pagination", async () => {
    render(<AttendancePreviewPage role="hr" />);

    await waitFor(() => expect(getGlobal).toHaveBeenCalled());
    const params = lastGlobalParams();
    expect(params.page).toBe(1);
    expect(params.page_size).toBe(20);
    expect(params.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.status).toBeUndefined();
    expect(params.source).toBeUndefined();
  });

  it("filters by status", async () => {
    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.click(statusChip("Absent"));

    await waitFor(() => expect(lastGlobalParams().status).toBe("ABSENT"));
  });

  it("filters by source so SYSTEM/BioTime records can be isolated", async () => {
    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "All sources" }));
    fireEvent.click(await screen.findByTitle("System"));

    await waitFor(() => expect(lastGlobalParams().source).toBe("SYSTEM"));
    expect(lastGlobalParams().page).toBe(1);
  });

  it("filters by employee", async () => {
    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Filter by employee" }),
    );
    fireEvent.click(await screen.findByTitle("E-042 - Sara Ali"));

    await waitFor(() => expect(lastGlobalParams().employee_id).toBe(42));
  });

  it("debounces the free-text employee search", async () => {
    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.change(
      screen.getByPlaceholderText("Search by employee name or email"),
      {
        target: { value: "omar" },
      },
    );

    await waitFor(() => expect(lastGlobalParams().search).toBe("omar"));
  });

  it("resets every filter back to the defaults", async () => {
    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.click(statusChip("Absent"));
    await waitFor(() => expect(lastGlobalParams().status).toBe("ABSENT"));

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(lastGlobalParams().status).toBeUndefined());
    expect(lastGlobalParams().source).toBeUndefined();
    expect(lastGlobalParams().employee_id).toBeUndefined();
  });

  it("hides the source and employee filters for the CEO endpoint, which does not support them", async () => {
    render(<AttendancePreviewPage role="ceo" />);

    await waitFor(() => expect(getCEO).toHaveBeenCalled());
    expect(
      screen.queryByRole("combobox", { name: "All sources" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Filter by employee" }),
    ).not.toBeInTheDocument();
    expect(listEmployeesMock).not.toHaveBeenCalled();
  });

  it("keeps pagination working across pages", async () => {
    getGlobal.mockResolvedValue(listResponse([record()], 60));

    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.click(screen.getByTitle("2"));

    await waitFor(() => expect(lastGlobalParams().page).toBe(2));
  });
});

describe("AttendancePreviewPage states", () => {
  it("shows the empty state when no records match", async () => {
    getGlobal.mockResolvedValue(listResponse([]));

    render(<AttendancePreviewPage role="hr" />);

    expect(
      await screen.findByText("No attendance records"),
    ).toBeInTheDocument();
  });

  it("shows a retryable error state when the request fails", async () => {
    getGlobal.mockRejectedValueOnce(
      new Error("Invalid attendance filter: bad date"),
    );

    render(<AttendancePreviewPage role="hr" />);

    expect(
      await screen.findByText("Couldn't load attendance records"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Invalid attendance filter: bad date"),
    ).toBeInTheDocument();

    getGlobal.mockResolvedValue(listResponse([record()]));
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));

    expect(await screen.findByText("Sara Ali")).toBeInTheDocument();
  });

  it("surfaces an error envelope returned with a 200 response", async () => {
    getGlobal.mockResolvedValue({
      status: "error",
      message: "Invalid attendance filter: source",
    });

    render(<AttendancePreviewPage role="hr" />);

    expect(
      await screen.findByText("Invalid attendance filter: source"),
    ).toBeInTheDocument();
  });
});

describe("AttendancePreviewPage late + absence surfacing", () => {
  it("shows minutes late for LATE rows and a dash otherwise", async () => {
    getGlobal.mockResolvedValue(
      listResponse([
        record({ id: 1, status: "LATE", late_minutes: 23 }),
        record({ id: 2, status: "PRESENT", late_minutes: 0 }),
      ]),
    );

    render(<AttendancePreviewPage role="hr" />);

    expect(await screen.findByText("+23m")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Late by" }),
    ).toBeInTheDocument();
  });

  it("tags a pending row the backend flagged as a late arrival", async () => {
    getGlobal.mockResolvedValue(
      listResponse([
        record({
          id: 3,
          status: "PENDING_HR",
          source: "EMPLOYEE",
          is_late_flagged: true,
          check_out_at: null,
        }),
      ]),
    );

    render(<AttendancePreviewPage role="hr" />);

    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Late arrival")).toBeInTheDocument();
  });

  it("does not tag a settled row even when it was flagged late", async () => {
    getGlobal.mockResolvedValue(
      listResponse([record({ id: 4, status: "LATE", is_late_flagged: true })]),
    );

    render(<AttendancePreviewPage role="hr" />);

    await screen.findByText("Sara Ali");
    expect(screen.queryByText("Late arrival")).not.toBeInTheDocument();
  });

  it("derives the attendance-rate tile from the summary counts", async () => {
    getGlobal.mockResolvedValue({
      status: "success" as const,
      data: {
        items: [record()],
        count: 1,
        summary: { PRESENT: 8, LATE: 2, ABSENT: 5, PENDING_HR: 4 },
      },
    });

    render(<AttendancePreviewPage role="hr" />);

    await screen.findByText("Sara Ali");
    // (8 present + 2 late) / (8 + 2 + 5 accountable) = 67%. Pending is excluded.
    expect(screen.getByText("Attendance rate")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("exports the filtered rows as a dated CSV file", async () => {
    getGlobal.mockResolvedValue(
      listResponse([record({ id: 9, status: "LATE", late_minutes: 12 })]),
    );

    render(<AttendancePreviewPage role="hr" />);
    await screen.findByText("Sara Ali");

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalled());
    const [blob, filename] = downloadBlobMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toMatch(/^attendance-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
