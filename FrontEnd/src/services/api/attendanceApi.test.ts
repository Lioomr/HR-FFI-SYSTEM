import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("../../utils/download", () => ({ downloadBlob: vi.fn() }));
import { api } from "./apiClient";
import { downloadBlob } from "../../utils/download";
import * as attendance from "./attendanceApi";
import { getManagerAttendance } from "./managerApi";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    data: { status: "success", data: { results: [], count: 0 } },
  });
  vi.mocked(api.post).mockResolvedValue({
    data: { status: "success", data: { results: [] } },
  });
});
describe("attendance read contract", () => {
  it("uses only the role-specific GET endpoints for records", async () => {
    await attendance.getMyAttendance();
    await attendance.getGlobalAttendance();
    await attendance.getCEOAttendance();
    await getManagerAttendance({ page: 2, page_size: 25 });
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual([
      "/api/attendance/me/",
      "/api/attendance/",
      "/api/ceo/attendance/",
      "/api/manager/attendance/",
    ]);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    // Manual attendance create/edit is retired; the only write is HR recalculation.
    expect(Object.keys(attendance).sort()).toEqual([
      "downloadAttendanceNotice",
      "getAttendanceNotice",
      "getAttendanceNotices",
      "getAttendanceViolation",
      "getAttendanceViolations",
      "getCEOAttendance",
      "getGlobalAttendance",
      "getMyAttendance",
      "getTodayAttendanceSummary",
      "recalculateAttendance",
      "toNoticeQueryParams",
      "toViolationQueryParams",
    ]);
  });
});

describe("attendance policy contract", () => {
  it("reads today's summary and violations without company selectors", async () => {
    await attendance.getTodayAttendanceSummary();
    await attendance.getAttendanceViolation(41);
    await attendance.getAttendanceViolations();
    expect(vi.mocked(api.get).mock.calls).toEqual([
      ["/api/attendance/me/today-summary/"],
      ["/api/attendance/violations/41/"],
      ["/api/attendance/violations/", { params: {} }],
    ]);
    // apiClient adds X-Active-Company-Id; callers never pass a company.
    expect(JSON.stringify(vi.mocked(api.get).mock.calls)).not.toMatch(
      /company/i,
    );
  });

  it("serializes multi-value violation filters comma-separated", async () => {
    await attendance.getAttendanceViolations({
      page: 2,
      page_size: 50,
      lifecycle: ["active", "manual_review"],
      payroll_status: ["pending", "claimed"],
      employee_profile_id: 7,
      date_from: "2026-09-01",
      date_to: "2026-09-13",
      search: "  jane ",
    });
    expect(api.get).toHaveBeenCalledWith("/api/attendance/violations/", {
      params: {
        page: 2,
        page_size: 50,
        lifecycle: "active,manual_review",
        payroll_status: "pending,claimed",
        employee_profile_id: 7,
        date_from: "2026-09-01",
        date_to: "2026-09-13",
        search: "jane",
      },
    });
  });

  it("drops empty filters instead of sending blank values", () => {
    expect(
      attendance.toViolationQueryParams({
        lifecycle: [],
        payroll_status: [""],
        employee_profile_id: "",
        search: "   ",
      }),
    ).toEqual({});
  });

  it("posts single-date and range recalculations to the HR endpoint", async () => {
    await attendance.recalculateAttendance({
      employee_profile_id: 7,
      date: "2026-09-13",
    });
    await attendance.recalculateAttendance({
      employee_profile_id: 7,
      date_from: "2026-09-01",
      date_to: "2026-09-13",
    });
    expect(vi.mocked(api.post).mock.calls).toEqual([
      [
        "/api/attendance/hr/recalculate/",
        { employee_profile_id: 7, date: "2026-09-13" },
      ],
      [
        "/api/attendance/hr/recalculate/",
        {
          employee_profile_id: 7,
          date_from: "2026-09-01",
          date_to: "2026-09-13",
        },
      ],
    ]);
    expect(JSON.stringify(vi.mocked(api.post).mock.calls)).not.toMatch(
      /company/i,
    );
  });
});

describe("late attendance notice contract", () => {
  it("lists and reads notices without company selectors", async () => {
    await attendance.getAttendanceNotices();
    await attendance.getAttendanceNotices({
      page: 2,
      page_size: 25,
      notice_level: ["1", "4"],
      employee_profile_id: 7,
      date_from: "2026-09-01",
      date_to: "2026-09-13",
      search: " jane ",
    });
    await attendance.getAttendanceNotice(31);

    expect(vi.mocked(api.get).mock.calls).toEqual([
      ["/api/attendance/notices/", { params: {} }],
      [
        "/api/attendance/notices/",
        {
          params: {
            page: 2,
            page_size: 25,
            notice_level: "1,4",
            employee_profile_id: 7,
            date_from: "2026-09-01",
            date_to: "2026-09-13",
            search: "jane",
          },
        },
      ],
      ["/api/attendance/notices/31/"],
    ]);
    // apiClient adds X-Active-Company-Id; callers never pass a company.
    expect(JSON.stringify(vi.mocked(api.get).mock.calls)).not.toMatch(
      /company/i,
    );
  });

  it("drops empty notice filters", () => {
    expect(
      attendance.toNoticeQueryParams({
        notice_level: [""],
        employee_profile_id: " ",
        search: "  ",
      }),
    ).toEqual({});
  });

  it("downloads the private PDF as a blob through apiClient", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/octet-stream" });
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    await attendance.downloadAttendanceNotice({
      id: 31,
      filename: "late_attendance_notice_LAN-FFI-000058.pdf",
      reference_number: "LAN-FFI-000058",
    });

    expect(vi.mocked(api.get).mock.calls).toEqual([
      ["/api/attendance/notices/31/download/", { responseType: "blob" }],
    ]);
    expect(downloadBlob).toHaveBeenCalledWith(
      blob,
      "late_attendance_notice_LAN-FFI-000058.pdf",
    );
  });
});
