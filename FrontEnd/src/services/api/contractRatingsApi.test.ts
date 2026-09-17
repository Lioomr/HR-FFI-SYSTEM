import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./apiClient";
import {
  acknowledgeRatingTerminationNotice,
  getContractRating,
  getRatingCriteria,
  isEmployeeRatingView,
  isFullContractRating,
  isManagerRatingView,
  listContractRatings,
  listRatingPositions,
  submitEmployeeRatingResponse,
  submitManagerRatingResponse,
  submitRatingCeoDecision,
  submitRatingHrReview,
  type ContractRatingView,
} from "./contractRatingsApi";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: {} });
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
});

const header = {
  id: 1,
  status: "PENDING_HR",
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

describe("contract ratings API routes", () => {
  it("looks up positions for the specific rating", async () => {
    await listRatingPositions(7);
    expect(api.get).toHaveBeenCalledWith("/contract-ratings/7/positions/");
  });
  // The backend mounts this app at the site root, unlike every /api/ module.
  it("never uses the /api prefix", async () => {
    await getRatingCriteria();
    await listContractRatings({ status: "PENDING_CEO" });
    await getContractRating(7);
    await submitManagerRatingResponse(7, {
      criterion_ratings: {},
      overall_remark: "",
      recommendation: "CONTINUE_CONTRACT",
    });
    await submitEmployeeRatingResponse(7, { criterion_ratings: {} });
    await submitRatingHrReview(7, { action: "approve" });
    await submitRatingCeoDecision(7, { action: "ACCEPT" });
    await acknowledgeRatingTerminationNotice(7);

    const urls = [
      ...vi.mocked(api.get).mock.calls.map((call) => call[0]),
      ...vi.mocked(api.post).mock.calls.map((call) => call[0]),
    ];
    expect(urls).toEqual([
      "/contract-ratings/criteria/",
      "/contract-ratings/",
      "/contract-ratings/7/",
      "/contract-ratings/7/manager-response/",
      "/contract-ratings/7/employee-response/",
      "/contract-ratings/7/hr-review/",
      "/contract-ratings/7/ceo-decision/",
      "/contract-ratings/7/acknowledge-termination-notice/",
    ]);
    expect(vi.mocked(api.get).mock.calls[1][1]).toEqual({
      params: { status: "PENDING_CEO" },
    });
  });

  it("sends the employee payload without adding manager keys", async () => {
    await submitEmployeeRatingResponse(3, {
      criterion_ratings: {},
      overall_remark: "fine",
    });
    expect(
      Object.keys(vi.mocked(api.post).mock.lastCall![1] as object),
    ).toEqual(["criterion_ratings", "overall_remark"]);
  });
});

describe("role-shaped payload guards", () => {
  const managerView = { ...header, manager_response: null };
  const employeeView = { ...header, employee_response: null };
  const fullView = {
    ...header,
    manager_response: null,
    employee_response: null,
    comparison_summary: {},
    workflow: { status: "in_review", history: [] },
  };

  it("tells the three shapes apart by the keys each one carries", () => {
    const cases: [unknown, boolean, boolean, boolean][] = [
      [managerView, false, true, false],
      [employeeView, false, false, true],
      [fullView, true, false, false],
      [{}, false, false, false],
    ];
    for (const [view, full, manager, employee] of cases) {
      const typed = view as ContractRatingView;
      expect(isFullContractRating(typed)).toBe(full);
      expect(isManagerRatingView(typed)).toBe(manager);
      expect(isEmployeeRatingView(typed)).toBe(employee);
    }
  });
});
