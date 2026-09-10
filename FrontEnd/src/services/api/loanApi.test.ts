import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "./apiClient";
import { downloadLoanRequestPdf } from "./loanApi";

const get = vi.mocked(api.get);

describe("loanApi PDF download", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("uses the authenticated, same-origin PDF endpoint and returns its blob", async () => {
    const pdf = new Blob(["%PDF"], { type: "application/octet-stream" });
    get.mockResolvedValue({ data: pdf } as never);

    await expect(downloadLoanRequestPdf(42)).resolves.toBe(pdf);

    expect(get).toHaveBeenCalledWith("/api/loans/loan-requests/42/pdf/", {
      responseType: "blob",
    });
    expect(get.mock.calls[0]?.[0]).not.toContain("?");
  });
});
