import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./apiClient";
import { getEmployeeCurrentRequests } from "./employeeCurrentRequestsApi";

vi.mock("./apiClient", () => ({ api: { get: vi.fn() } }));
const response = (items: unknown[], total_pages = 1) => ({
  data: { status: "success", data: { items, total_pages } },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue(response([]));
});
it("reads older pages, excludes completed requests and links ongoing requests to their owner views", async () => {
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (url === "/api/leaves/employee/leave-requests/") {
      if ((config?.params as { page?: number } | undefined)?.page === 1)
        return response(
          [
            { id: 1, status: "approved" },
            { id: 2, status: "cancelled" },
          ],
          2,
        );
      return response(
        [{ id: 3, status: "pending_hr_completion", created_at: "2026-09-01" }],
        2,
      );
    }
    if (url === "/api/loans/employee/loan-requests/")
      return response([
        { id: 3, status: "pending_disbursement", created_at: "2026-09-03" },
        { id: 4, status: "deducted" },
        { id: 5, status: "rejected" },
      ]);
    if (url === "/api/permission-requests/")
      return response([
        {
          id: 3,
          status: "pending_manager",
          created_at: "2026-09-02",
          reference_no: "PER-3",
        },
      ]);
    if (url === "/api/leaves/annual-leave-payments/") return response([]);
    throw new Error(`Unexpected endpoint: ${url}`);
  });
  const result = await getEmployeeCurrentRequests();
  expect(result.failed).toEqual([]);
  expect(result.requests.map((item) => item.path)).toEqual([
    "/employee/loans/3",
    "/employee/permission-requests/3",
    "/employee/leave/requests/3",
  ]);
  expect(api.get).toHaveBeenCalledWith("/api/leaves/employee/leave-requests/", {
    params: { page: 2, page_size: 100 },
  });
});
it("preserves successful sources and identifies failed sources including API error envelopes", async () => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === "/api/leaves/employee/leave-requests/")
      throw new Error("offline");
    if (url === "/api/permission-requests/")
      return { data: { status: "error", message: "unavailable" } };
    return response([{ id: 7, status: "submitted" }]);
  });
  const result = await getEmployeeCurrentRequests();
  expect(result.failed).toEqual(["leave", "permission"]);
  // The loan and settlement sources both still load.
  expect(result.requests.map((item) => item.kind)).toEqual([
    "loan",
    "settlement",
  ]);
});
it("lists only the caller's in-flight Annual Leave settlements with cycle and preference", async () => {
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url !== "/api/leaves/annual-leave-payments/") return response([]);
    return response([
      {
        id: 11,
        status: "pending_ceo",
        submitted_at: "2026-09-05T08:00:00Z",
        cycle_start: "2025-09-10",
        cycle_end: "2026-09-09",
        employee_preference: "take_as_leave",
      },
      { id: 12, status: "pending_hr", submitted_at: "2026-09-04T08:00:00Z" },
      { id: 13, status: "approved" },
      { id: 14, status: "carried_forward" },
      { id: 15, status: "rejected" },
    ]);
  });
  const result = await getEmployeeCurrentRequests();
  expect(result.failed).toEqual([]);
  expect(result.requests).toEqual([
    expect.objectContaining({
      id: 11,
      kind: "settlement",
      status: "pending_ceo",
      path: "/employee/leave/balance",
      cycle: { start: "2025-09-10", end: "2026-09-09" },
      preference: "take_as_leave",
    }),
    expect.objectContaining({ id: 12, kind: "settlement", preference: "" }),
  ]);
  expect(api.get).toHaveBeenCalledWith("/api/leaves/annual-leave-payments/", {
    params: { page: 1, page_size: 100, mine: true },
  });
});
it("stops pagination when the view or employee scope changes", async () => {
  let active = true;
  vi.mocked(api.get).mockImplementation(async () => {
    active = false;
    return response([], 10);
  });
  await getEmployeeCurrentRequests(() => active);
  expect(api.get).toHaveBeenCalledTimes(1);
});
