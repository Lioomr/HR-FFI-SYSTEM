import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../../../services/api/leaveApi", () => ({
  getMyLeaveBalance: vi.fn(),
}));

vi.mock("../../../services/api/annualLeavePaymentsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/api/annualLeavePaymentsApi")
  >("../../../services/api/annualLeavePaymentsApi");
  return {
    ...actual,
    getAnnualLeavePaymentRequests: vi.fn(),
    getAnnualLeaveEligibility: vi.fn(),
    createEmployeeAnnualLeavePaymentRequest: vi.fn(),
  };
});

import MyLeaveBalancePage from "./MyLeaveBalancePage";
import * as leaveApi from "../../../services/api/leaveApi";
import * as annualApi from "../../../services/api/annualLeavePaymentsApi";
import type {
  AnnualLeaveEligibility,
  AnnualLeavePaymentRequest,
} from "../../../services/api/annualLeavePaymentsApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const getMyLeaveBalance = leaveApi.getMyLeaveBalance as unknown as ReturnType<
  typeof vi.fn
>;
const getAnnualLeavePaymentRequests =
  annualApi.getAnnualLeavePaymentRequests as unknown as ReturnType<
    typeof vi.fn
  >;
const getAnnualLeaveEligibility =
  annualApi.getAnnualLeaveEligibility as unknown as ReturnType<typeof vi.fn>;
const createEmployeeAnnualLeavePaymentRequest =
  annualApi.createEmployeeAnnualLeavePaymentRequest as unknown as ReturnType<
    typeof vi.fn
  >;

/** antd + jsdom are slow under a full-suite run; the 1s findBy* default is tight. */
const FIND = { timeout: 8000 };

/** The exact Annual Leave balance row from the backend contract. */
const annualRow = {
  leave_type_id: 1,
  leave_type: "Annual Leave",
  leave_code: "ANNUAL",
  total_days: "12.25",
  used_days: "2.00",
  remaining_days: "10.25",
  pending_days: "3.00",
  requestable_days: "7.00",
  fractional_days: "0.25",
  available_annual_year_days: "12.25",
  adjustments: 0,
};

/** The eligibility payload exactly as `build_annual_leave_eligibility` sends it. */
function makeEligibility(
  overrides: Partial<AnnualLeaveEligibility> = {},
): AnnualLeaveEligibility {
  return {
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
    ...overrides,
  };
}

function makeSettlement(
  overrides: Partial<AnnualLeavePaymentRequest> = {},
): AnnualLeavePaymentRequest {
  return {
    id: 9,
    employee_id: 47,
    employee_name: "Sara Ahmed",
    company: 1,
    cycle_start: "2025-05-02",
    cycle_end: "2026-05-01",
    accrued_days: "21.00",
    used_days: "0.00",
    eligible_unused_days: "21.00",
    fractional_days: "0.00",
    has_pending_annual_leave: false,
    salary_at_year_end: "3500.00",
    payment_amount: "2450.00",
    carry_forward_days: "0.00",
    resolution: "pay",
    status: "pending_hr",
    is_termination_settlement: false,
    employee_note: "Please process my unused Annual Leave.",
    hr_review_note: "",
    ceo_decision_note: "",
    submitted_by: 3,
    hr_reviewed_by: null,
    ceo_decided_by: null,
    submitted_at: "2026-04-28T09:00:00Z",
    hr_reviewed_at: null,
    ceo_decided_at: null,
    settled_at: null,
    ...overrides,
  };
}

const listResponse = (items: AnnualLeavePaymentRequest[]) => ({
  status: "success" as const,
  data: { items, count: items.length, page: 1, page_size: 5 },
});

const eligibilityResponse = (eligibility: AnnualLeaveEligibility) => ({
  status: "success" as const,
  data: eligibility,
});

/** Opens the payment dialog once the eligibility read has enabled the action. */
async function openPaymentModal() {
  const button = await screen.findByRole(
    "button",
    { name: /Request Annual Leave Payment/ },
    FIND,
  );
  await waitFor(() => expect(button).not.toBeDisabled(), FIND);
  fireEvent.click(button);
  return screen.findByText(
    /only be requested during the final 5 days/,
    {},
    FIND,
  );
}

beforeEach(() => {
  getMyLeaveBalance.mockReset();
  getAnnualLeavePaymentRequests.mockReset();
  getAnnualLeaveEligibility.mockReset();
  createEmployeeAnnualLeavePaymentRequest.mockReset();
  useI18nStore.getState().setLanguage("en");
  getMyLeaveBalance.mockResolvedValue({ status: "success", data: [annualRow] });
  getAnnualLeavePaymentRequests.mockResolvedValue(listResponse([]));
  getAnnualLeaveEligibility.mockResolvedValue(
    eligibilityResponse(makeEligibility()),
  );
});

describe("MyLeaveBalancePage — Annual Leave accrual figures", () => {
  it("shows pending days as reserved and the requestable limit", async () => {
    render(<MyLeaveBalancePage />);

    const row = (await screen.findByText("Annual Leave", {}, FIND)).closest(
      "tr",
    )!;
    expect(within(row).getByText("3")).toBeInTheDocument(); // reserved (pending_days)
    expect(within(row).getByText("7")).toBeInTheDocument(); // requestable_days

    // antd renders the header twice for a horizontally scrolling table.
    expect(screen.getAllByText("Reserved (Pending)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Requestable Days").length).toBeGreaterThan(0);
  });

  it("shows the fractional remainder and explains that it cannot be booked", async () => {
    render(<MyLeaveBalancePage />);

    const row = (await screen.findByText("Annual Leave", {}, FIND)).closest(
      "tr",
    )!;
    expect(within(row).getByText("0.25")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Requestable days are calculated by the system: whole remaining days minus days already reserved by pending requests.",
      ),
    ).toBeInTheDocument();
  });

  it("never shows HR or CEO settlement controls to the employee", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement()]),
    );

    render(<MyLeaveBalancePage />);

    await screen.findByText("Pending HR", {}, FIND);
    expect(
      screen.queryByRole("button", { name: /Forward to CEO/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Approve/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Reject/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review" }),
    ).not.toBeInTheDocument();
  });
});

describe("MyLeaveBalancePage — eligibility", () => {
  it("reads eligibility from the backend on load", async () => {
    render(<MyLeaveBalancePage />);

    await waitFor(
      () => expect(getAnnualLeaveEligibility).toHaveBeenCalledTimes(1),
      FIND,
    );
    // Called with no arguments — the endpoint is always about the caller.
    expect(getAnnualLeaveEligibility).toHaveBeenCalledWith();
  });

  it("renders the backend figures verbatim, including the estimated amount", async () => {
    render(<MyLeaveBalancePage />);

    expect(
      await screen.findByText("2025-05-02 → 2026-05-01", {}, FIND),
    ).toBeInTheDocument();
    expect(screen.getByText("Estimated Payment Amount")).toBeInTheDocument();
    expect(screen.getByText("2450.00")).toBeInTheDocument(); // estimated_payment_amount
    expect(screen.getByText("3500.00")).toBeInTheDocument(); // salary_at_year_end
    expect(screen.getByText("21 Days")).toBeInTheDocument(); // eligible_unused_days
  });

  it("hides the action and shows the backend reason when can_request is false", async () => {
    getAnnualLeaveEligibility.mockResolvedValue(
      eligibilityResponse(
        makeEligibility({
          can_request: false,
          window_open: false,
          reason:
            "The Annual Leave payment window opens only during the final 5 days of the contract year.",
        }),
      ),
    );

    render(<MyLeaveBalancePage />);

    expect(
      await screen.findByText(
        "The Annual Leave payment window opens only during the final 5 days of the contract year.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Request Annual Leave Payment/ }),
    ).not.toBeInTheDocument();
  });

  it("surfaces the pending Annual Leave block from the eligibility payload", async () => {
    getAnnualLeaveEligibility.mockResolvedValue(
      eligibilityResponse(
        makeEligibility({
          can_request: false,
          has_pending_annual_leave: true,
          reason:
            "Annual Leave payment cannot be requested while Annual Leave requests are pending.",
        }),
      ),
    );

    render(<MyLeaveBalancePage />);

    expect(
      await screen.findByText(
        "Annual Leave payment cannot be requested while Annual Leave requests are pending.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You have Annual Leave requests still awaiting a decision. Annual Leave payment cannot be requested until they are resolved.",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to its own wording when the backend sends a blank reason", async () => {
    getAnnualLeaveEligibility.mockResolvedValue(
      eligibilityResponse(makeEligibility({ can_request: false, reason: "" })),
    );

    render(<MyLeaveBalancePage />);

    expect(
      await screen.findByText(
        "Annual Leave payment is not available for you right now.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
  });
});

describe("MyLeaveBalancePage — Annual Leave payment request", () => {
  it("submits the employee note and re-reads eligibility, the list and the balance", async () => {
    createEmployeeAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement(),
    });

    render(<MyLeaveBalancePage />);
    expect(await openPaymentModal()).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Note to HR"), {
      target: { value: "Please process my unused Annual Leave." },
    });

    const balanceCallsBefore = getMyLeaveBalance.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(
      () =>
        expect(createEmployeeAnnualLeavePaymentRequest).toHaveBeenCalledWith({
          employee_note: "Please process my unused Annual Leave.",
        }),
      FIND,
    );
    await waitFor(
      () => expect(getAnnualLeaveEligibility).toHaveBeenCalledTimes(2),
      FIND,
    );
    await waitFor(
      () => expect(getAnnualLeavePaymentRequests).toHaveBeenCalledTimes(2),
      FIND,
    );
    await waitFor(
      () =>
        expect(getMyLeaveBalance.mock.calls.length).toBeGreaterThan(
          balanceCallsBefore,
        ),
      FIND,
    );
  });

  it("shows the backend error when the submission is refused", async () => {
    createEmployeeAnnualLeavePaymentRequest.mockRejectedValue({
      apiData: {
        status: "error",
        message: "Validation error",
        errors: [
          "An annual leave settlement already exists for this contract year.",
        ],
      },
    });

    render(<MyLeaveBalancePage />);
    await openPaymentModal();
    fireEvent.click(
      await screen.findByRole("button", { name: "Submit" }, FIND),
    );

    expect(
      await screen.findByText(
        "An annual leave settlement already exists for this contract year.",
        {},
        FIND,
      ),
    ).toBeInTheDocument();
  });

  it("hides the request action while a settlement is still active", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement({ status: "pending_ceo" })]),
    );

    render(<MyLeaveBalancePage />);

    expect(
      await screen.findByText("Pending CEO", {}, FIND),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You already have an Annual Leave settlement in progress. A new request can be submitted only after it is resolved.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Request Annual Leave Payment/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["pending_hr", "Pending HR"],
    ["pending_ceo", "Pending CEO"],
    ["approved", "Approved for Payment"],
    ["rejected", "Rejected"],
    ["carried_forward", "Carried Forward"],
  ] as const)("renders the %s status as %s", async (status, label) => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement({ status })]),
    );

    render(<MyLeaveBalancePage />);

    expect(await screen.findByText(label, {}, FIND)).toBeInTheDocument();
  });
});
