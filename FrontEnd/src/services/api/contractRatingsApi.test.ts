import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./apiClient";
import {
  acknowledgeRatingTerminationNotice,
  getContractRating,
  getRatingCriteria,
  listContractRatings,
  requestRatingHrComment,
  submitEmployeeRatingResponse,
  submitManagerRatingResponse,
  submitRatingCeoDecision,
  submitRatingHrComment,
  submitRatingHrGate,
  toContractRatingView,
} from "./contractRatingsApi";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// Mirrors ContractRatingReadSerializer.to_representation's header block.
const header = {
  id: 1,
  status: "PENDING_CEO",
  rating_mode: "RATE",
  company: 5,
  employee: {
    id: 4,
    employee_id: "E-1",
    employee_number: "",
    full_name: "Employee",
    department: "",
    section: "",
    job_title: "Engineer",
    manager_at_creation: 3,
  },
  evaluation_period_from: "2025-12-05",
  evaluation_period_to: "2026-12-05",
  contract_date: "2025-12-05",
  contract_expiry: "2026-12-05",
  manager_name: "Manager",
};

const envelope = (data: unknown) => ({ data: { status: "success", data } });

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue(envelope(header));
  vi.mocked(api.post).mockReset().mockResolvedValue(envelope(header));
});

describe("contract ratings API routes", () => {
  // The backend mounts this app at the site root, unlike every /api/ module.
  it("uses the real routes without the /api prefix", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(envelope({ criteria: [], grade_ranges: {} }))
      .mockResolvedValueOnce(envelope({ items: [] }));
    await getRatingCriteria();
    await listContractRatings({ status: "PENDING_CEO" });
    await getContractRating(7);
    const body = { criterion_ratings: {}, overall_remark: "" };
    await submitRatingHrGate(7, "RATE");
    await submitManagerRatingResponse(7, body);
    await submitEmployeeRatingResponse(7, body);
    await requestRatingHrComment(7);
    await submitRatingHrComment(7, "context");
    await submitRatingCeoDecision(7, { ceo_decision: "RENEW", comment: "" });
    await acknowledgeRatingTerminationNotice(7);

    expect(vi.mocked(api.get).mock.calls.map((call) => call[0])).toEqual([
      "/contract-ratings/criteria/",
      "/contract-ratings/",
      "/contract-ratings/7/",
    ]);
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ["/contract-ratings/7/hr-gate/", { rating_mode: "RATE" }],
      ["/contract-ratings/7/manager-response/", body],
      ["/contract-ratings/7/employee-response/", body],
      ["/contract-ratings/7/request-hr-comment/", {}],
      ["/contract-ratings/7/hr-comment/", { comment: "context" }],
      ["/contract-ratings/7/ceo-decision/", { ceo_decision: "RENEW", comment: "" }],
      ["/contract-ratings/7/acknowledge-termination-notice/", {}],
    ]);
    expect(vi.mocked(api.get).mock.calls[1][1]).toEqual({
      params: { status: "PENDING_CEO" },
    });
  });

  it("sends salary data only as part of RENEW_WITH_CHANGES", async () => {
    await submitRatingCeoDecision(7, {
      ceo_decision: "RENEW_WITH_CHANGES",
      comment: "",
      ceo_approved_terms: { basic_salary: "6000" },
      salary_effective_date: "2026-12-06",
    });
    expect(vi.mocked(api.post).mock.lastCall![1]).toEqual({
      ceo_decision: "RENEW_WITH_CHANGES",
      comment: "",
      ceo_approved_terms: { basic_salary: "6000" },
      salary_effective_date: "2026-12-06",
    });
  });

  it("drops role-less {} items from the list", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(
      envelope({ items: [{}, { ...header, employee_response: null }] }),
    );
    const response = await listContractRatings();
    expect(response.status === "success" && response.data.items).toEqual([
      { ...header, employee_response: null, viewer: "employee" },
    ]);
  });
});

describe("role-shaped payload classification", () => {
  const full = {
    ...header,
    workflow: { status: "in_review", history: [] },
    hr_comment_requested_at: null,
  };

  it("classifies each backend shape by the keys only it carries", () => {
    expect(toContractRatingView({ ...header, employee_response: null })?.viewer).toBe("employee");
    expect(toContractRatingView({ ...header, manager_response: null })?.viewer).toBe("manager");
    expect(
      toContractRatingView({
        ...full,
        manager_response: null,
        employee_response: null,
        comparison_summary: {},
      })?.viewer,
    ).toBe("full");
    expect(
      toContractRatingView({ ...full, rating_mode: "SKIP_TO_CEO" })?.viewer,
    ).toBe("full");
    expect(
      toContractRatingView({ ...header, hr_comment_requested_at: null })?.viewer,
    ).toBe("hr_coarse");
    expect(toContractRatingView({})).toBeNull();
  });

  it("groups HR gate and outcome keys only when the backend sent them", () => {
    const pendingGate = toContractRatingView({
      ...header,
      status: "PENDING_HR_GATE",
      rating_mode: "",
      hr_comment_requested_at: null,
      account_connected: false,
      hr_gate_decided_by: null,
      hr_gate_decided_at: null,
    });
    expect(pendingGate).toMatchObject({
      viewer: "hr_coarse",
      gate: { account_connected: false },
      outcome: null,
    });
    expect(pendingGate).not.toHaveProperty("account_connected");

    const decided = toContractRatingView({
      ...header,
      status: "DECIDED",
      hr_comment_requested_at: null,
      ceo_decision: "TERMINATE",
      ceo_comment: "",
      ceo_decided_at: "2026-09-17T10:00:00Z",
      ceo_decided_by: 9,
      ceo_approved_terms: {},
      salary_effective_date: null,
      salary_change_applied_at: null,
      salary_after_snapshot: {},
      scheduled_termination: true,
      termination_processed_at: null,
    });
    expect(decided).toMatchObject({
      viewer: "hr_coarse",
      gate: null,
      outcome: { ceo_decision: "TERMINATE", scheduled_termination: true },
    });
  });

  it("reports a role-less mutation result as success with no view", async () => {
    // After a CEO return the rating leaves PENDING_CEO and the CEO gets {}.
    vi.mocked(api.post).mockResolvedValueOnce(envelope({}));
    const response = await submitRatingCeoDecision(3, {
      ceo_decision: "RETURN_TO_EMPLOYEE",
      comment: "Justify",
    });
    expect(response).toEqual({ status: "success", data: null });
  });

  it("reports a role-less detail payload as an error", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(envelope({}));
    expect((await getContractRating(3)).status).toBe("error");
  });
});
