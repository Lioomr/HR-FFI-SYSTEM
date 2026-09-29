import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from "./apiClient";
import {
  acknowledgePenalty,
  createPenalty,
  disputePenalty,
  getPenalty,
  getPenaltyCatalog,
  listPenalties,
  markPenaltyDisruption,
  resolvePenalty,
  reviewPenaltyPayroll,
} from "./penaltiesApi";

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const success = { data: { status: "success", data: {} } };

beforeEach(() => {
  get.mockReset().mockResolvedValue(success as never);
  post.mockReset().mockResolvedValue(success as never);
});

describe("penalties API contract", () => {
  it("uses the shared company-scoped client and server pagination/filter names", async () => {
    await getPenaltyCatalog();
    expect(get).toHaveBeenLastCalledWith("/api/penalties/catalog/");
    await listPenalties({
      mine: true,
      status: "issued",
      page: 2,
      page_size: 10,
    });
    expect(get).toHaveBeenLastCalledWith("/api/penalties/", {
      params: { mine: true, status: "issued", page: 2, page_size: 10 },
    });
    await getPenalty(42);
    expect(get).toHaveBeenLastCalledWith("/api/penalties/42/");
  });

  it("sends only the published payload for each HR transition", async () => {
    await createPenalty({
      employee_profile_id: 9,
      catalog_code: "safety",
      occurred_on: "2026-09-29",
      note: "Reviewed",
    });
    expect(post).toHaveBeenLastCalledWith("/api/penalties/", {
      employee_profile_id: 9,
      catalog_code: "safety",
      occurred_on: "2026-09-29",
      note: "Reviewed",
    });
    await markPenaltyDisruption(42, {
      disruption: "not_disrupted",
      note: "No impact",
    });
    expect(post).toHaveBeenLastCalledWith(
      "/api/penalties/42/mark-disruption/",
      { disruption: "not_disrupted", note: "No impact" },
    );
    await markPenaltyDisruption(42, {
      disruption: "confirmed",
      note: "No permission",
    });
    expect(post).toHaveBeenLastCalledWith(
      "/api/penalties/42/mark-disruption/",
      { disruption: "confirmed", note: "No permission" },
    );
    await resolvePenalty(42, { decision: "waive", note: "Evidence accepted" });
    expect(post).toHaveBeenLastCalledWith("/api/penalties/42/resolve/", {
      decision: "waive",
      note: "Evidence accepted",
    });
    await reviewPenaltyPayroll(42, {
      decision: "hold",
      note: "Pending review",
    });
    expect(post).toHaveBeenLastCalledWith("/api/penalties/42/payroll-review/", {
      decision: "hold",
      note: "Pending review",
    });
  });

  it("sends employee response requests without HR fields", async () => {
    await acknowledgePenalty(42);
    expect(post).toHaveBeenLastCalledWith("/api/penalties/42/acknowledge/", {});
    await disputePenalty(42, "Incorrect incident");
    expect(post).toHaveBeenLastCalledWith("/api/penalties/42/dispute/", {
      reason: "Incorrect incident",
    });
  });
});
