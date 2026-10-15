import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./apiClient", () => ({ api: { patch: vi.fn() } }));
import { api } from "./apiClient";
import { editLoanRequest } from "./loanApi";
import { editAssetReturnRequest } from "./assetsApi";

beforeEach(() => vi.clearAllMocks());

describe("loan and asset-return edit clients", () => {
  it("PATCHes loan edits to the loan base path as JSON", async () => {
    const envelope = { status: "success", data: { id: 11 } };
    vi.mocked(api.patch).mockResolvedValue({ data: envelope });
    const body = {
      amount: 1500,
      loan_type: "installment" as const,
      installment_months: 4,
      reason: "Rent",
    };
    expect(await editLoanRequest(11, body)).toEqual(envelope);
    expect(api.patch).toHaveBeenCalledWith(
      "/api/loans/loan-requests/11/edit/",
      body,
    );
  });

  it("PATCHes the asset return note and returns the envelope untouched", async () => {
    const envelope = { status: "success", data: { id: 41, note: "New" } };
    vi.mocked(api.patch).mockResolvedValue({ data: envelope });
    expect(await editAssetReturnRequest("41", { note: "New" })).toEqual(
      envelope,
    );
    expect(api.patch).toHaveBeenCalledWith(
      "/api/assets/return-requests/41/edit/",
      { note: "New" },
    );
  });

  it("preserves HTTP rejections", async () => {
    const error = { response: { status: 422, data: { status: "error" } } };
    vi.mocked(api.patch).mockRejectedValue(error);
    await expect(editLoanRequest(1, { reason: "x" })).rejects.toEqual(error);
    await expect(editAssetReturnRequest(1, { note: "x" })).rejects.toEqual(
      error,
    );
  });
});
