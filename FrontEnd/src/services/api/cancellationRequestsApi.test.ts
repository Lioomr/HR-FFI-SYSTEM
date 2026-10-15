import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiClient", () => ({ api: { post: vi.fn(), get: vi.fn() } }));
import { api } from "./apiClient";
import {
  confirmCancellationRequest,
  declineCancellationRequest,
  listCancellationRequests,
  requestCancellation,
  withdrawCancellationRequest,
  type CancellationKind,
} from "./cancellationRequestsApi";

beforeEach(() => vi.clearAllMocks());

describe("cancellation request clients", () => {
  it.each([
    ["leave", "/api/leaves/leave-requests"],
    ["permission", "/api/permission-requests"],
    ["annual_leave_payment", "/api/leaves/annual-leave-payments"],
    ["asset_return", "/api/assets/return-requests"],
    ["asset_damage", "/api/assets/damage-reports"],
    ["loan", "/api/loans/loan-requests"],
  ] as [CancellationKind, string][])(
    "posts the reason for %s",
    async (kind, base) => {
      const envelope = { status: "success", data: { id: 9 } };
      vi.mocked(api.post).mockResolvedValue({ data: envelope });
      expect(await requestCancellation(kind, 9, "Plans changed")).toEqual(
        envelope,
      );
      expect(api.post).toHaveBeenCalledWith(`${base}/9/request-cancellation/`, {
        reason: "Plans changed",
      });
      await withdrawCancellationRequest(kind, 9);
      expect(api.post).toHaveBeenLastCalledWith(
        `${base}/9/withdraw-cancellation-request/`,
      );
    },
  );

  it("lists the HR inbox with filters", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { status: "success" } });
    await listCancellationRequests({
      status: "pending",
      kind: "loan",
      page: 2,
    });
    expect(api.get).toHaveBeenCalledWith("/api/core/cancellation-requests/", {
      params: { status: "pending", kind: "loan", page: 2 },
    });
  });

  it("confirms with an optional comment and declines with a comment", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { status: "success" } });
    await confirmCancellationRequest(4);
    expect(api.post).toHaveBeenLastCalledWith(
      "/api/core/cancellation-requests/4/confirm/",
      {},
    );
    await confirmCancellationRequest(4, "ok");
    expect(api.post).toHaveBeenLastCalledWith(
      "/api/core/cancellation-requests/4/confirm/",
      { comment: "ok" },
    );
    await declineCancellationRequest(4, "no");
    expect(api.post).toHaveBeenLastCalledWith(
      "/api/core/cancellation-requests/4/decline/",
      { comment: "no" },
    );
  });
});
