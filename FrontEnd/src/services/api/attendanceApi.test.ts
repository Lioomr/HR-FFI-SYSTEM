import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
import { api } from "./apiClient";
import * as attendance from "./attendanceApi";
import { getManagerAttendance } from "./managerApi";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    data: { status: "success", data: { results: [], count: 0 } },
  });
});
describe("attendance read contract", () => {
  it("uses only the role-specific GET endpoints", async () => {
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
    expect(Object.keys(attendance).sort()).toEqual([
      "getCEOAttendance",
      "getGlobalAttendance",
      "getMyAttendance",
    ]);
  });
});
