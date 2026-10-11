import { beforeEach, expect, it, vi } from "vitest";
import { api } from "./apiClient";
import { getEmployeeCurrentRequests } from "./employeeCurrentRequestsApi";

vi.mock("./apiClient", () => ({ api: { get: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
});

it("loads the compact employee request summary with one request", async () => {
  const requests = [
    {
      id: 8,
      kind: "profile" as const,
      status: "pending_hr",
      createdAt: "2026-09-04T08:00:00Z",
      reference: "PC-FFI-000108",
      path: "/employee/profile#profile-change",
    },
    {
      id: 11,
      kind: "settlement" as const,
      status: "pending_ceo",
      createdAt: "2026-09-03T08:00:00Z",
      reference: "AED-FFI-000101",
      path: "/employee/leave/balance",
      cycle: { start: "2025-09-10", end: "2026-09-09" },
      preference: "take_as_leave" as const,
    },
  ];
  vi.mocked(api.get).mockResolvedValue({
    data: { status: "success", data: { requests } },
  });

  const result = await getEmployeeCurrentRequests();

  expect(result).toEqual({ requests, failed: [] });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith("/api/employees/me/current-requests/");
});

it("reports all summary kinds unavailable when the aggregate request fails", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("offline"));

  const result = await getEmployeeCurrentRequests();

  expect(result.requests).toEqual([]);
  expect(result.failed).toEqual([
    "leave",
    "permission",
    "loan",
    "settlement",
    "profile",
  ]);
});

it("does not start or apply a request after the employee scope changes", async () => {
  let active = false;
  expect(await getEmployeeCurrentRequests(() => active)).toEqual({
    requests: [],
    failed: [],
  });
  expect(api.get).not.toHaveBeenCalled();

  active = true;
  vi.mocked(api.get).mockImplementation(async () => {
    active = false;
    return { data: { status: "success", data: { requests: [] } } };
  });
  expect(await getEmployeeCurrentRequests(() => active)).toEqual({
    requests: [],
    failed: [],
  });
});
