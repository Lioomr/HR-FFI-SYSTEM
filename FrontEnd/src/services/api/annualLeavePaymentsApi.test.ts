import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from "./apiClient";
import {
  approveAnnualLeavePaymentRequest,
  createEmployeeAnnualLeavePaymentRequest,
  createHRAnnualLeaveSettlement,
  getAnnualLeaveEligibility,
  getAnnualLeavePaymentRequest,
  getAnnualLeavePaymentRequests,
  rejectAnnualLeavePaymentRequest,
  reviewAnnualLeavePaymentRequest,
  toDecimalNumber,
} from "./annualLeavePaymentsApi";

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("eligibility", () => {
  it("reads the dedicated endpoint and returns the envelope untouched", async () => {
    const payload = {
      can_request: true,
      window_open: true,
      cycle_start: "2025-05-02",
      cycle_end: "2026-05-01",
      eligible_unused_days: "21.00",
      fractional_days: "0.00",
      salary_at_year_end: "3500.00",
      estimated_payment_amount: "2450.00",
      has_pending_annual_leave: false,
      reason: "",
    };
    get.mockResolvedValue({ data: { status: "success", data: payload } });

    const res = await getAnnualLeaveEligibility();

    expect(get).toHaveBeenCalledWith(
      "/api/leaves/annual-leave-payments/eligibility/",
    );
    expect(res).toEqual({ status: "success", data: payload });
  });

  it("passes an error envelope straight through", async () => {
    get.mockResolvedValue({
      data: { status: "error", message: "Employee profile is required." },
    });

    const res = await getAnnualLeaveEligibility();

    expect(res).toEqual({
      status: "error",
      message: "Employee profile is required.",
    });
  });
});

describe("retrieve", () => {
  it("returns the standard success envelope with no unwrapping of its own", async () => {
    // The viewset overrides `retrieve` to wrap the serializer output.
    const envelope = {
      status: "success",
      data: {
        id: 15,
        employee_id: 47,
        status: "pending_hr",
        has_pending_annual_leave: false,
      },
    };
    get.mockResolvedValue({ data: envelope });

    const res = await getAnnualLeavePaymentRequest(15);

    expect(get).toHaveBeenCalledWith("/api/leaves/annual-leave-payments/15/");
    expect(res).toEqual(envelope);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.data.id).toBe(15);
      expect(res.data.has_pending_annual_leave).toBe(false);
    }
  });
});

describe("list", () => {
  it("forwards the filters the backend actually supports", async () => {
    get.mockResolvedValue({
      data: {
        status: "success",
        data: { items: [], count: 0, page: 1, page_size: 20 },
      },
    });

    await getAnnualLeavePaymentRequests({
      status: "pending_ceo",
      employee_profile: 47,
      ordering: "-submitted_at",
      page: 1,
      page_size: 20,
    });

    expect(get).toHaveBeenCalledWith("/api/leaves/annual-leave-payments/", {
      params: {
        status: "pending_ceo",
        employee_profile: 47,
        ordering: "-submitted_at",
        page: 1,
        page_size: 20,
      },
    });
  });
});

describe("workflow endpoints", () => {
  beforeEach(() => {
    post.mockResolvedValue({ data: { status: "success", data: { id: 15 } } });
  });

  it("posts the employee payload to the collection route", async () => {
    await createEmployeeAnnualLeavePaymentRequest({ employee_note: "note" });

    expect(post).toHaveBeenCalledWith("/api/leaves/annual-leave-payments/", {
      employee_note: "note",
    });
  });

  it("posts the HR settlement payload to the same collection route", async () => {
    await createHRAnnualLeaveSettlement({
      employee_id: 47,
      decision: "carry_forward",
    });

    expect(post).toHaveBeenCalledWith("/api/leaves/annual-leave-payments/", {
      employee_id: 47,
      decision: "carry_forward",
    });
  });

  it.each([["forward" as const], ["carry_forward" as const]])(
    "posts the %s HR review decision",
    async (decision) => {
      await reviewAnnualLeavePaymentRequest(15, { decision, comment: "c" });

      expect(post).toHaveBeenCalledWith(
        "/api/leaves/annual-leave-payments/15/review/",
        {
          decision,
          comment: "c",
        },
      );
    },
  );

  it("posts the CEO approval", async () => {
    await approveAnnualLeavePaymentRequest(15, "Approved.");

    expect(post).toHaveBeenCalledWith(
      "/api/leaves/annual-leave-payments/15/approve/",
      {
        comment: "Approved.",
      },
    );
  });

  it("posts the CEO rejection with its required comment", async () => {
    await rejectAnnualLeavePaymentRequest(15, "Rejected with reason.");

    expect(post).toHaveBeenCalledWith(
      "/api/leaves/annual-leave-payments/15/reject/",
      {
        comment: "Rejected with reason.",
      },
    );
  });
});

describe("toDecimalNumber", () => {
  it("reads DRF decimal strings", () => {
    expect(toDecimalNumber("2450.00")).toBe(2450);
    expect(toDecimalNumber("0.25")).toBe(0.25);
  });

  it("defaults anything unusable to zero rather than NaN", () => {
    expect(toDecimalNumber(null)).toBe(0);
    expect(toDecimalNumber(undefined)).toBe(0);
    expect(toDecimalNumber("not-a-number")).toBe(0);
  });
});
