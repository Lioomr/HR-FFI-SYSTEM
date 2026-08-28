import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../services/api/annualLeavePaymentsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/api/annualLeavePaymentsApi")
  >("../../../services/api/annualLeavePaymentsApi");
  return {
    ...actual,
    getAnnualLeavePaymentRequests: vi.fn(),
    reviewAnnualLeavePaymentRequest: vi.fn(),
    createHRAnnualLeaveSettlement: vi.fn(),
  };
});

vi.mock("../../../services/api/employeesApi", () => ({
  listEmployees: vi.fn().mockResolvedValue({
    status: "success",
    data: {
      results: [{ id: 47, employee_id: "FFI-047", full_name: "Sara Ahmed" }],
      count: 1,
    },
  }),
}));

import AnnualLeaveSettlementsPage from "./AnnualLeaveSettlementsPage";
import * as annualApi from "../../../services/api/annualLeavePaymentsApi";
import type { AnnualLeavePaymentRequest } from "../../../services/api/annualLeavePaymentsApi";
import { useI18nStore } from "../../../i18n/i18nStore";

const getAnnualLeavePaymentRequests =
  annualApi.getAnnualLeavePaymentRequests as unknown as ReturnType<
    typeof vi.fn
  >;
const reviewAnnualLeavePaymentRequest =
  annualApi.reviewAnnualLeavePaymentRequest as unknown as ReturnType<
    typeof vi.fn
  >;
const createHRAnnualLeaveSettlement =
  annualApi.createHRAnnualLeaveSettlement as unknown as ReturnType<
    typeof vi.fn
  >;

function makeSettlement(
  overrides: Partial<AnnualLeavePaymentRequest> = {},
): AnnualLeavePaymentRequest {
  return {
    id: 9,
    employee_id: 47,
    employee_name: "Sara Ahmed",
    company: 1,
    cycle_start: "2025-09-01",
    cycle_end: "2026-08-31",
    accrued_days: "12.25",
    used_days: "2.00",
    eligible_unused_days: "10.00",
    fractional_days: "0.25",
    has_pending_annual_leave: false,
    salary_at_year_end: "6000.00",
    payment_amount: "2000.00",
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
    submitted_at: "2026-08-27T09:00:00Z",
    hr_reviewed_at: null,
    ceo_decided_at: null,
    settled_at: null,
    ...overrides,
  };
}

const listResponse = (items: AnnualLeavePaymentRequest[]) => ({
  status: "success" as const,
  data: { items, count: items.length, page: 1, page_size: 20 },
});

function renderPage(path = "/hr/annual-leave-payments") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/hr/annual-leave-payments"
          element={<AnnualLeaveSettlementsPage />}
        />
        <Route
          path="/hr/annual-leave-payments/:id"
          element={<AnnualLeaveSettlementsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** antd + jsdom are slow under a full-suite run; the 1s findBy* default is tight. */
const FIND = { timeout: 8000 };

/** Opens the HR review dialog for the single row on screen. */
async function openReview() {
  fireEvent.click(
    await screen.findByRole("button", { name: /^Review: / }, FIND),
  );
  return screen.findByText("Review Annual Leave Settlement", {}, FIND);
}

beforeEach(() => {
  getAnnualLeavePaymentRequests.mockReset();
  reviewAnnualLeavePaymentRequest.mockReset();
  createHRAnnualLeaveSettlement.mockReset();
  useI18nStore.getState().setLanguage("en");
  getAnnualLeavePaymentRequests.mockResolvedValue(
    listResponse([makeSettlement()]),
  );
});

describe("HR Annual Leave settlements queue", () => {
  it("requests only pending_hr settlements by default and shows the review figures", async () => {
    renderPage();

    await waitFor(() =>
      expect(getAnnualLeavePaymentRequests).toHaveBeenCalledWith(
        expect.objectContaining({ status: "pending_hr" }),
      ),
    );

    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
    expect(screen.getByText("2025-09-01 → 2026-08-31")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument(); // unused eligible days
    expect(screen.getByText("6000.00")).toBeInTheDocument(); // year-end salary
    expect(screen.getByText("2000.00")).toBeInTheDocument(); // payment amount
    // "Pending HR" is both the row status and the selected filter value.
    expect(screen.getAllByText("Pending HR").length).toBeGreaterThan(0);
  });

  it("flags the pending Annual Leave warning from the backend field", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement({ has_pending_annual_leave: true })]),
    );

    renderPage();

    expect(
      await screen.findByText("Pending Annual Leave", {}, FIND),
    ).toBeInTheDocument();
  });

  it("shows no pending warning when the backend field is false", async () => {
    renderPage();

    await screen.findByText("Sara Ahmed", {}, FIND);
    expect(screen.queryByText("Pending Annual Leave")).not.toBeInTheDocument();
  });

  it("repeats the pending warning inside the review dialog for that record", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement({ has_pending_annual_leave: true })]),
    );

    renderPage();
    await openReview();

    expect(
      screen.getByText(
        "This employee has Annual Leave requests still awaiting a decision. Those days are reserved and are not part of the settlement.",
      ),
    ).toBeInTheDocument();
  });

  it("omits the review-dialog warning when the record has no pending leave", async () => {
    renderPage();
    await openReview();

    expect(
      screen.queryByText(
        "This employee has Annual Leave requests still awaiting a decision. Those days are reserved and are not part of the settlement.",
      ),
    ).not.toBeInTheDocument();
  });

  it("never offers the CEO decisions to HR", async () => {
    renderPage();

    await screen.findByText("Sara Ahmed");
    expect(
      screen.queryByRole("button", { name: /^Approve/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Reject/ }),
    ).not.toBeInTheDocument();
  });

  it("forwards to the CEO with the HR comment and reloads the queue", async () => {
    reviewAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({ status: "pending_ceo" }),
    });

    renderPage();
    await openReview();

    fireEvent.change(screen.getByLabelText("HR Comment"), {
      target: { value: "Reviewed by HR." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(reviewAnnualLeavePaymentRequest).toHaveBeenCalledWith(9, {
        decision: "forward",
        comment: "Reviewed by HR.",
      }),
    );
    await waitFor(() =>
      expect(getAnnualLeavePaymentRequests).toHaveBeenCalledTimes(2),
    );
  });

  it("sends a carry-forward decision when HR picks it", async () => {
    reviewAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({
        status: "pending_ceo",
        resolution: "carry_forward",
      }),
    });

    renderPage();
    await openReview();

    // Ant Design's Select is a combobox; pick the carry-forward option by name.
    fireEvent.mouseDown(screen.getByLabelText("HR Decision"));
    fireEvent.click(await screen.findByTitle("Carry Forward"));
    fireEvent.change(screen.getByLabelText("HR Comment"), {
      target: { value: "Carry forward approved for CEO review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(reviewAnnualLeavePaymentRequest).toHaveBeenCalledWith(9, {
        decision: "carry_forward",
        comment: "Carry forward approved for CEO review.",
      }),
    );
  });

  it("shows the exact backend validation error and keeps the dialog open", async () => {
    reviewAnnualLeavePaymentRequest.mockRejectedValue({
      apiData: {
        status: "error",
        message: "Validation error",
        errors: ["Payment request is not pending HR review."],
      },
    });

    renderPage();
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("Payment request is not pending HR review."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Review Annual Leave Settlement"),
    ).toBeInTheDocument();
  });

  it("lets a SystemAdmin open a settlement, as the backend permission allows", async () => {
    createHRAnnualLeaveSettlement.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({ status: "pending_ceo", resolution: "pay" }),
    });

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /New Settlement/ }, FIND),
    );
    fireEvent.mouseDown(await screen.findByLabelText("Employee"));
    fireEvent.click(await screen.findByTitle("Sara Ahmed (FFI-047)", {}, FIND));
    fireEvent.mouseDown(screen.getByLabelText("HR Decision"));
    fireEvent.click(await screen.findByTitle("Pay", {}, FIND));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(
      () =>
        expect(createHRAnnualLeaveSettlement).toHaveBeenCalledWith({
          employee_id: 47,
          decision: "pay",
        }),
      FIND,
    );
  });

  it("opens a settlement for an employee who never submitted one", async () => {
    createHRAnnualLeaveSettlement.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({
        status: "pending_ceo",
        resolution: "carry_forward",
      }),
    });

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /New Settlement/ }),
    );
    expect(
      await screen.findByText("Open Annual Leave Settlement"),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText("Employee"));
    fireEvent.click(await screen.findByTitle("Sara Ahmed (FFI-047)"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createHRAnnualLeaveSettlement).toHaveBeenCalledWith({
        employee_id: 47,
        decision: "carry_forward",
      }),
    );
  });

  it("surfaces the pending-leave block when HR opens a settlement", async () => {
    createHRAnnualLeaveSettlement.mockRejectedValue({
      apiData: {
        status: "error",
        message: "Validation error",
        errors: [
          "Annual leave payment cannot be requested while leave requests are pending.",
        ],
      },
    });

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /New Settlement/ }),
    );
    fireEvent.mouseDown(await screen.findByLabelText("Employee"));
    fireEvent.click(await screen.findByTitle("Sara Ahmed (FFI-047)"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText(
        "Annual leave payment cannot be requested while leave requests are pending.",
      ),
    ).toBeInTheDocument();
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

    renderPage();

    await screen.findByText("Sara Ahmed");
    // The status filter renders its own label, so match anywhere on screen.
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("opens the record named by the notification deep link", async () => {
    renderPage("/hr/annual-leave-payments/9");

    expect(await screen.findByText("Settlement #9")).toBeInTheDocument();
  });
});
