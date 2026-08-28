import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../services/api/annualLeavePaymentsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/api/annualLeavePaymentsApi")
  >("../../services/api/annualLeavePaymentsApi");
  return {
    ...actual,
    getAnnualLeavePaymentRequests: vi.fn(),
    approveAnnualLeavePaymentRequest: vi.fn(),
    rejectAnnualLeavePaymentRequest: vi.fn(),
  };
});

import CEOAnnualLeaveSettlementsPage from "./CEOAnnualLeaveSettlementsPage";
import * as annualApi from "../../services/api/annualLeavePaymentsApi";
import type { AnnualLeavePaymentRequest } from "../../services/api/annualLeavePaymentsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const getAnnualLeavePaymentRequests =
  annualApi.getAnnualLeavePaymentRequests as unknown as ReturnType<
    typeof vi.fn
  >;
const approveAnnualLeavePaymentRequest =
  annualApi.approveAnnualLeavePaymentRequest as unknown as ReturnType<
    typeof vi.fn
  >;
const rejectAnnualLeavePaymentRequest =
  annualApi.rejectAnnualLeavePaymentRequest as unknown as ReturnType<
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
    status: "pending_ceo",
    is_termination_settlement: false,
    employee_note: "Please process my unused Annual Leave.",
    hr_review_note: "Reviewed by HR.",
    ceo_decision_note: "",
    submitted_by: 3,
    hr_reviewed_by: 5,
    ceo_decided_by: null,
    submitted_at: "2026-08-27T09:00:00Z",
    hr_reviewed_at: "2026-08-28T09:00:00Z",
    ceo_decided_at: null,
    settled_at: null,
    ...overrides,
  };
}

const listResponse = (items: AnnualLeavePaymentRequest[]) => ({
  status: "success" as const,
  data: { items, count: items.length, page: 1, page_size: 20 },
});

/** antd + jsdom are slow under a full-suite run; the 1s waitFor default is tight. */
const FIND = { timeout: 8000 };

beforeEach(() => {
  getAnnualLeavePaymentRequests.mockReset();
  approveAnnualLeavePaymentRequest.mockReset();
  rejectAnnualLeavePaymentRequest.mockReset();
  useI18nStore.getState().setLanguage("en");
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "ceo@ffi.test", role: "CEO" },
  });
  getAnnualLeavePaymentRequests.mockResolvedValue(
    listResponse([makeSettlement()]),
  );
});

describe("CEO Annual Leave settlements queue", () => {
  it("asks only for the records awaiting the CEO", async () => {
    render(<CEOAnnualLeaveSettlementsPage />);

    await waitFor(() =>
      expect(getAnnualLeavePaymentRequests).toHaveBeenCalledWith(
        expect.objectContaining({ status: "pending_ceo" }),
      ),
    );
    expect(await screen.findByText("Sara Ahmed")).toBeInTheDocument();
  });

  it("labels both decisions in text, never colour alone", async () => {
    render(<CEOAnnualLeaveSettlementsPage />);

    expect(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reject: Sara Ahmed" }),
    ).toBeInTheDocument();
  });

  it("approves a payment settlement and reloads the queue", async () => {
    approveAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({ status: "approved" }),
    });

    render(<CEOAnnualLeaveSettlementsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    );
    expect(
      await screen.findByText("Approve Annual Leave Settlement"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Approving marks this settlement as approved for payment.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(approveAnnualLeavePaymentRequest).toHaveBeenCalledWith(9),
    );
    await waitFor(
      () => expect(getAnnualLeavePaymentRequests).toHaveBeenCalledTimes(2),
      FIND,
    );
  });

  it("spells out that approving a carry-forward pays nothing", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([
        makeSettlement({
          resolution: "carry_forward",
          payment_amount: "0.00",
          carry_forward_days: "10.00",
        }),
      ]),
    );
    approveAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({
        status: "carried_forward",
        resolution: "carry_forward",
      }),
    });

    render(<CEOAnnualLeaveSettlementsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    );

    expect(
      await screen.findByText(
        "Approving carries the days into the next contract year. Nothing is paid.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(approveAnnualLeavePaymentRequest).toHaveBeenCalledWith(9),
    );
  });

  it("requires a written reason before a rejection is sent", async () => {
    rejectAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({ status: "rejected" }),
    });

    render(<CEOAnnualLeaveSettlementsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Reject: Sara Ahmed" }),
    );
    expect(
      await screen.findByText("Reject Annual Leave Settlement"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reject Settlement" }));
    expect(
      await screen.findByText("A rejection reason is required."),
    ).toBeInTheDocument();
    expect(rejectAnnualLeavePaymentRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), {
      target: { value: "Rejected with reason." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject Settlement" }));

    await waitFor(() =>
      expect(rejectAnnualLeavePaymentRequest).toHaveBeenCalledWith(
        9,
        "Rejected with reason.",
      ),
    );
    await waitFor(
      () => expect(getAnnualLeavePaymentRequests).toHaveBeenCalledTimes(2),
      FIND,
    );
  });

  it("lets the re-read replace the optimistic removal, not stand in for it", async () => {
    // Dropping the row locally is only a display shortcut. If the server still
    // reports the record (a concurrent edit, a decision that did not stick),
    // the re-read must put it back rather than leave a stale empty queue.
    approveAnnualLeavePaymentRequest.mockResolvedValue({
      status: "success" as const,
      data: makeSettlement({ status: "approved" }),
    });
    getAnnualLeavePaymentRequests
      .mockResolvedValueOnce(listResponse([makeSettlement()]))
      .mockResolvedValueOnce(
        listResponse([
          makeSettlement({ id: 12, employee_name: "Omar Nasser" }),
        ]),
      );

    render(<CEOAnnualLeaveSettlementsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }, FIND),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Approve" }, FIND),
    );

    // The decided row is gone and the server's own next page is what shows.
    expect(
      await screen.findByText("Omar Nasser", {}, FIND),
    ).toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByText("Sara Ahmed")).not.toBeInTheDocument(),
      FIND,
    );
  });

  it("shows the backend refusal instead of a generic failure", async () => {
    approveAnnualLeavePaymentRequest.mockRejectedValue({
      apiData: {
        status: "error",
        message: "Validation error",
        errors: ["Payment request is not pending CEO approval."],
      },
    });

    render(<CEOAnnualLeaveSettlementsPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Approve: Sara Ahmed" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText("Payment request is not pending CEO approval."),
    ).toBeInTheDocument();
  });

  it("tells a carry-forward apart from a payment in the queue", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement({ resolution: "carry_forward" })]),
    );

    render(<CEOAnnualLeaveSettlementsPage />);

    await screen.findByText("Sara Ahmed");
    expect(screen.getAllByText("Carry Forward").length).toBeGreaterThan(0);
    expect(screen.queryByText("Approved for Payment")).not.toBeInTheDocument();
  });

  it("renders an empty state when nothing awaits the CEO", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue(listResponse([]));

    render(<CEOAnnualLeaveSettlementsPage />);

    expect(
      await screen.findByText(
        "No Annual Leave settlements are awaiting your decision.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a retryable error state when the queue fails to load", async () => {
    getAnnualLeavePaymentRequests.mockResolvedValue({
      status: "error" as const,
      message: "backend down",
    });

    render(<CEOAnnualLeaveSettlementsPage />);

    expect(await screen.findByText("backend down")).toBeInTheDocument();

    getAnnualLeavePaymentRequests.mockResolvedValue(
      listResponse([makeSettlement()]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.getByText("Sara Ahmed")).toBeInTheDocument(),
    );
  });

  it("never offers the HR review controls to the CEO", async () => {
    render(<CEOAnnualLeaveSettlementsPage />);

    await screen.findByText("Sara Ahmed");
    expect(
      screen.queryByRole("button", { name: /^Review/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /New Settlement/ }),
    ).not.toBeInTheDocument();
  });
});
