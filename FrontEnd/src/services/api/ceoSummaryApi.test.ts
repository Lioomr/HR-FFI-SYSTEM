import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./leaveApi", () => ({ getCEOLeaveRequests: vi.fn() }));
vi.mock("./loanApi", () => ({ getCEOLoanRequests: vi.fn() }));
vi.mock("./attendanceApi", () => ({ getCEOAttendance: vi.fn() }));
vi.mock("./assetsApi", () => ({
  getCEOAssetDamageReports: vi.fn(),
  getCEOAssetReturnRequests: vi.fn(),
}));
vi.mock("./employeesApi", () => ({ listEmployeeArchiveRequests: vi.fn() }));

import { getCeoApprovalSummary } from "./ceoSummaryApi";
import { getCEOLeaveRequests } from "./leaveApi";
import { getCEOLoanRequests } from "./loanApi";
import { getCEOAttendance } from "./attendanceApi";
import {
  getCEOAssetDamageReports,
  getCEOAssetReturnRequests,
} from "./assetsApi";
import { listEmployeeArchiveRequests } from "./employeesApi";

const mocks = {
  leave: getCEOLeaveRequests as unknown as ReturnType<typeof vi.fn>,
  loan: getCEOLoanRequests as unknown as ReturnType<typeof vi.fn>,
  attendance: getCEOAttendance as unknown as ReturnType<typeof vi.fn>,
  damage: getCEOAssetDamageReports as unknown as ReturnType<typeof vi.fn>,
  returns: getCEOAssetReturnRequests as unknown as ReturnType<typeof vi.fn>,
  archive: listEmployeeArchiveRequests as unknown as ReturnType<typeof vi.fn>,
};

const counted = (count: number) => ({
  status: "success" as const,
  data: { items: [], count },
});

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
});

describe("getCeoApprovalSummary", () => {
  it("totals the counts across every queue", async () => {
    mocks.leave.mockResolvedValue(counted(3));
    mocks.loan.mockResolvedValue(counted(2));
    mocks.attendance.mockResolvedValue({
      status: "success",
      data: { results: [], count: 4 },
    });
    mocks.damage.mockResolvedValue(counted(1));
    mocks.returns.mockResolvedValue(counted(5));
    mocks.archive.mockResolvedValue(counted(6));

    const summary = await getCeoApprovalSummary();

    expect(summary.totalPending).toBe(21);
    expect(summary.queues.attendance).toEqual({
      key: "attendance",
      count: 4,
      available: true,
    });
    expect(summary.allUnavailable).toBe(false);
  });

  it("probes each queue with the CEO-pending filter and a single row", async () => {
    Object.values(mocks).forEach((fn) => fn.mockResolvedValue(counted(0)));

    await getCeoApprovalSummary();

    expect(mocks.leave).toHaveBeenCalledWith({ page: 1, page_size: 1 });
    expect(mocks.loan).toHaveBeenCalledWith({
      status: "pending_ceo",
      page: 1,
      page_size: 1,
    });
    expect(mocks.attendance).toHaveBeenCalledWith({
      status: "PENDING_CEO",
      page: 1,
      page_size: 1,
    });
    expect(mocks.damage).toHaveBeenCalledWith({
      status: "PENDING_CEO",
      page: 1,
      page_size: 1,
    });
    expect(mocks.returns).toHaveBeenCalledWith({
      status: "PENDING_CEO",
      page: 1,
      page_size: 1,
    });
    expect(mocks.archive).toHaveBeenCalledWith({
      status: "PENDING_CEO",
      page: 1,
      page_size: 1,
    });
  });

  it("marks only the failing queue unavailable and keeps the rest", async () => {
    mocks.leave.mockResolvedValue(counted(3));
    mocks.loan.mockResolvedValue(counted(2));
    mocks.attendance.mockResolvedValue(counted(0));
    mocks.damage.mockResolvedValue(counted(0));
    mocks.returns.mockResolvedValue(counted(0));
    mocks.archive.mockRejectedValue(new Error("403"));

    const summary = await getCeoApprovalSummary();

    expect(summary.queues.employeeArchive).toEqual({
      key: "employeeArchive",
      count: 0,
      available: false,
    });
    expect(summary.queues.leave.available).toBe(true);
    expect(summary.totalPending).toBe(5);
    expect(summary.allUnavailable).toBe(false);
  });

  it("treats an error envelope the same as a thrown failure", async () => {
    Object.values(mocks).forEach((fn) => fn.mockResolvedValue(counted(1)));
    mocks.loan.mockResolvedValue({ status: "error" as const, message: "nope" });

    const summary = await getCeoApprovalSummary();

    expect(summary.queues.loan.available).toBe(false);
    expect(summary.totalPending).toBe(5);
  });

  it("reports allUnavailable only when no queue can be read", async () => {
    Object.values(mocks).forEach((fn) =>
      fn.mockRejectedValue(new Error("offline")),
    );

    const summary = await getCeoApprovalSummary();

    expect(summary.allUnavailable).toBe(true);
    expect(summary.totalPending).toBe(0);
  });

  it("falls back to array length when the endpoint returns a bare list", async () => {
    Object.values(mocks).forEach((fn) => fn.mockResolvedValue(counted(0)));
    mocks.damage.mockResolvedValue({
      status: "success" as const,
      data: [{ id: 1 }, { id: 2 }],
    });

    const summary = await getCeoApprovalSummary();

    expect(summary.queues.assetDamage.count).toBe(2);
  });
});
