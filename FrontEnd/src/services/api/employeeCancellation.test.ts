import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiClient", () => ({ api: { post: vi.fn() } }));
import { api } from "./apiClient";
import { cancelLeaveRequest } from "./leaveApi";
import { cancelAnnualLeavePaymentRequest } from "./annualLeavePaymentsApi";
import { cancelAssetReturnRequest, cancelAssetDamageReport } from "./assetsApi";

beforeEach(() => vi.clearAllMocks());
describe("employee pending cancellation clients", () => {
  it.each([
    [cancelLeaveRequest, "leaves/leave-requests", "cancelled"],
    [
      cancelAnnualLeavePaymentRequest,
      "leaves/annual-leave-payments",
      "cancelled",
    ],
    [cancelAssetReturnRequest, "assets/return-requests", "CANCELLED"],
    [cancelAssetDamageReport, "assets/damage-reports", "CANCELLED"],
  ] as const)(
    "POSTs without a body and returns the envelope (%s)",
    async (cancel, route, status) => {
      const envelope = { status: "success", data: { id: 17, status } };
      vi.mocked(api.post).mockResolvedValue({ data: envelope });
      expect(await cancel(17)).toEqual(envelope);
      expect(api.post).toHaveBeenCalledWith(`/api/${route}/17/cancel/`);
    },
  );
  it("preserves error envelopes and HTTP rejections", async () => {
    const envelope = {
      status: "error",
      message: "Cannot cancel this request.",
    };
    vi.mocked(api.post).mockResolvedValue({ data: envelope });
    expect(await cancelLeaveRequest(17)).toEqual(envelope);
    const error = { response: { status: 422, data: envelope } };
    vi.mocked(api.post).mockRejectedValue(error);
    await expect(cancelAssetReturnRequest(17)).rejects.toEqual(error);
  });
});
