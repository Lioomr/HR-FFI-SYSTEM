import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "./apiClient";
import {
  cancelPermissionRequest,
  createPermissionRequest,
  decidePermissionRequest,
  downloadPermissionRequestPdf,
  getHrPermissionRequests,
  getManagerPermissionRequests,
  getMyPermissionRequests,
  getPermissionRequest,
} from "./permissionRequestsApi";

beforeEach(() => vi.clearAllMocks());

describe("permission request API contract", () => {
  it("uses the documented employee, manager, and HR routes", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { status: "success", data: {} },
    });
    vi.mocked(api.post).mockResolvedValue({
      data: { status: "success", data: {} },
    });
    await getMyPermissionRequests();
    await getManagerPermissionRequests();
    await getHrPermissionRequests();
    await getPermissionRequest(7);
    await cancelPermissionRequest(7);
    await decidePermissionRequest(7, "manager", "approve", "Looks good");
    await decidePermissionRequest(7, "hr", "reject");
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).toEqual([
      "/api/permission-requests/",
      "/api/permission-requests/manager/",
      "/api/permission-requests/hr/",
      "/api/permission-requests/7/",
    ]);
    expect(vi.mocked(api.post).mock.calls.map(([path]) => path)).toEqual([
      "/api/permission-requests/7/cancel/",
      "/api/permission-requests/7/manager-approve/",
      "/api/permission-requests/7/hr-reject/",
    ]);
  });

  it("sends minute-formatted create data and downloads PDFs as blobs", async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { status: "success", data: {} },
    });
    vi.mocked(api.get).mockResolvedValue({
      data: new Blob(["pdf"], { type: "application/pdf" }),
    });
    await createPermissionRequest({
      request_date: "2026-09-12",
      from_time: "09:00",
      to_time: "10:30",
      exit_type: "personal",
      reason: "Appointment",
      duration_minutes: 90,
    });
    await downloadPermissionRequestPdf(4);
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      "/api/permission-requests/",
      {
        request_date: "2026-09-12",
        from_time: "09:00",
        to_time: "10:30",
        exit_type: "personal",
        reason: "Appointment",
        duration_minutes: 90,
      },
    ]);
    expect(vi.mocked(api.get).mock.calls[0]).toEqual([
      "/api/permission-requests/4/pdf/",
      { responseType: "blob" },
    ]);
  });
});
