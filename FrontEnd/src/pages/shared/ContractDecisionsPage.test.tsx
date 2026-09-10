import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/contractDecisionsApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/api/contractDecisionsApi")
  >("../../services/api/contractDecisionsApi");
  return {
    ...actual,
    listContractDecisions: vi.fn(),
    getContractDecision: vi.fn(),
    submitContractDecision: vi.fn(),
    approveContractDecision: vi.fn(),
    rejectContractDecision: vi.fn(),
  };
});

import ContractDecisionsPage from "./ContractDecisionsPage";
import {
  approveContractDecision,
  getContractDecision,
  listContractDecisions,
  rejectContractDecision,
  submitContractDecision,
  type ContractDecision,
  type ContractDecisionStatus,
} from "../../services/api/contractDecisionsApi";
import { useI18nStore } from "../../i18n/i18nStore";
import { useAuthStore } from "../../auth/authStore";

const listMock = listContractDecisions as unknown as ReturnType<typeof vi.fn>;
const getMock = getContractDecision as unknown as ReturnType<typeof vi.fn>;
const submitMock = submitContractDecision as unknown as ReturnType<
  typeof vi.fn
>;
const approveMock = approveContractDecision as unknown as ReturnType<
  typeof vi.fn
>;
const rejectMock = rejectContractDecision as unknown as ReturnType<
  typeof vi.fn
>;

/** Mirrors `ContractDecisionReadSerializer`; synthetic values only. */
const decision = (
  overrides: Partial<ContractDecision> = {},
): ContractDecision => ({
  id: 7,
  company: 1,
  employee: {
    id: 101,
    employee_id: "FFI-101",
    full_name: "Layla Hassan",
    company_id: 1,
  },
  decision_type: "RENEW_WITH_CHANGES",
  decision_type_label: "Renew with changes",
  status: "PENDING_HR",
  status_label: "Pending HR",
  original_contract_date: "2025-10-01",
  original_contract_expiry: "2026-10-01",
  proposed_contract_date: null,
  proposed_contract_expiry: null,
  original_terms: {
    basic_salary: "1500.00",
    transportation_allowance: "100.00",
    accommodation_allowance: "200.00",
  },
  proposed_terms: {},
  hr_comment: "",
  ceo_comment: "",
  failure_reason: "",
  submitted_at: null,
  ceo_deadline: null,
  ceo_decided_at: null,
  ceo_reminder_count: 0,
  finalized_at: null,
  finalized_by_system: false,
  automatic_renewal: false,
  automatic_renewal_reason: "",
  final_notification_sent_at: null,
  final_notification_attempts: 0,
  last_final_notification_attempt_at: null,
  notification_status: [],
  ...overrides,
});

const listPayload = (items: ContractDecision[]) => ({
  status: "success" as const,
  data: { items, count: items.length, page: 1, page_size: 20 },
});

const detailPayload = (item: ContractDecision) => ({
  status: "success" as const,
  data: item,
});

/** Shapes an axios rejection the way the api client surfaces it. */
const httpError = (status: number, data?: unknown) => {
  const error = new Error("request failed") as Error & {
    response: { status: number; data: unknown };
    apiData: unknown;
  };
  error.response = { status, data };
  error.apiData = data;
  return error;
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/hr/contract-decisions"
          element={<ContractDecisionsPage />}
        />
        <Route
          path="/hr/contract-decisions/:id"
          element={<ContractDecisionsPage />}
        />
        <Route
          path="/ceo/contract-decisions"
          element={<ContractDecisionsPage />}
        />
        <Route
          path="/ceo/contract-decisions/:id"
          element={<ContractDecisionsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const asHr = () =>
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "1", email: "hr@ffi.test", role: "HRManager" },
  });

const asCeo = () =>
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "2", email: "ceo@ffi.test", role: "CEO" },
  });

beforeEach(() => {
  listMock.mockReset();
  getMock.mockReset();
  submitMock.mockReset();
  approveMock.mockReset();
  rejectMock.mockReset();
  useI18nStore.getState().setLanguage("en");
  asHr();
  listMock.mockResolvedValue(listPayload([decision()]));
  getMock.mockResolvedValue(detailPayload(decision()));
});

describe("ContractDecisionsPage list", () => {
  it("labels every backend status the filter offers", async () => {
    const statuses: ContractDecisionStatus[] = [
      "PENDING_HR",
      "PENDING_CEO",
      "APPROVED",
      "AUTO_APPROVED",
      "AUTO_RENEWED",
      "REJECTED",
      "AUTO_RENEWAL_FAILED",
      "MANUAL_RESOLUTION_REQUIRED",
    ];
    listMock.mockResolvedValue(
      listPayload(
        statuses.map((status, index) =>
          decision({
            id: index + 1,
            status,
            status_label: `Label ${status}`,
            employee: {
              id: 100 + index,
              employee_id: `FFI-${100 + index}`,
              full_name: `Employee ${index}`,
              company_id: 1,
            },
          }),
        ),
      ),
    );

    renderAt("/hr/contract-decisions");

    for (const status of statuses) {
      expect(await screen.findByText(`Label ${status}`)).toBeInTheDocument();
    }
  });

  it("offers HR an action on PENDING_HR and MANUAL_RESOLUTION_REQUIRED only", async () => {
    listMock.mockResolvedValue(
      listPayload([
        decision({ id: 1, status: "PENDING_HR", status_label: "Pending HR" }),
        decision({
          id: 2,
          status: "MANUAL_RESOLUTION_REQUIRED",
          status_label: "Manual resolution required",
        }),
        decision({ id: 3, status: "APPROVED", status_label: "Approved" }),
        decision({
          id: 4,
          status: "AUTO_RENEWAL_FAILED",
          status_label: "Automatic renewal failed",
        }),
      ]),
    );

    renderAt("/hr/contract-decisions");

    // Manual resolution is the one non-PENDING_HR status `submit_decision`
    // accepts, so it gets its own action wording. The other two rows get none.
    expect(
      await screen.findByRole("button", { name: "Take action" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resolve manually" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(4);
  });

  it("shows an access-denied state on 403 and does not offer a retry", async () => {
    listMock.mockRejectedValue(httpError(403));

    renderAt("/hr/contract-decisions");

    expect(
      await screen.findByText(
        "You do not have access to contract decisions for this company.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("masks a 500 and offers a retry", async () => {
    listMock.mockRejectedValue(httpError(500, { detail: "psql: relation x" }));

    renderAt("/hr/contract-decisions");

    expect(
      await screen.findByText(
        "An internal server error occurred. Please try again later.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/psql/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders an empty state when nothing matches the filter", async () => {
    listMock.mockResolvedValue(listPayload([]));

    renderAt("/hr/contract-decisions");

    expect(
      await screen.findByText("No contract decisions match this filter."),
    ).toBeInTheDocument();
  });
});

describe("ContractDecisionsPage detail", () => {
  it("renders every retained HR and CEO attempt in the workflow history", async () => {
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "PENDING_CEO",
          status_label: "Pending CEO",
          workflow: {
            status: "in_review",
            current_stage: "ceo",
            history: [
              {
                action: "submit",
                stage: "hr",
                actor: { id: 1, full_name: "Huda HR" },
                at: "2026-08-01T08:00:00Z",
                note: "First submission",
              },
              {
                action: "reject",
                stage: "ceo",
                actor: { id: 2, full_name: "Omar CEO" },
                at: "2026-08-02T08:00:00Z",
                note: "First CEO look",
              },
              {
                action: "submit",
                stage: "hr",
                actor: { id: 1, full_name: "Huda HR" },
                at: "2026-08-03T08:00:00Z",
                note: "Second submission",
              },
              {
                action: "approve",
                stage: "ceo",
                actor: { id: 2, full_name: "Omar CEO" },
                at: "2026-08-04T08:00:00Z",
                note: "Second CEO look",
              },
            ],
          },
        }),
      ),
    );

    renderAt("/hr/contract-decisions/7");

    expect(await screen.findByText("Workflow history")).toBeInTheDocument();
    // Both HR attempts and both CEO attempts survive, not just the latest pair.
    expect(screen.getByText("First submission")).toBeInTheDocument();
    expect(screen.getByText("First CEO look")).toBeInTheDocument();
    expect(screen.getByText("Second submission")).toBeInTheDocument();
    expect(screen.getByText("Second CEO look")).toBeInTheDocument();
    expect(screen.getAllByText("submit")).toHaveLength(2);
  });

  it("explains an automatic renewal and its reason", async () => {
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "AUTO_RENEWED",
          status_label: "Automatically renewed",
          automatic_renewal: true,
          automatic_renewal_reason: "HR took no action before the expiry date.",
        }),
      ),
    );

    renderAt("/hr/contract-decisions/7");

    expect(
      await screen.findByText(
        "This contract was automatically renewed because HR took no action.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("HR took no action before the expiry date.").length,
    ).toBeGreaterThan(0);
  });

  it("explains a failed automatic renewal and withholds the HR action", async () => {
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "AUTO_RENEWAL_FAILED",
          status_label: "Automatic renewal failed",
          failure_reason: "The employee profile is archived.",
        }),
      ),
    );

    renderAt("/hr/contract-decisions/7");

    expect(
      await screen.findByText(
        "Automatic renewal failed. HR cannot resubmit this record; review it with the system administrator.",
      ),
    ).toBeInTheDocument();
    // `submit_decision` refuses this status, so no action is offered.
    expect(screen.queryByRole("button", { name: "Take action" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resolve manually" }),
    ).toBeNull();
  });

  it("lets HR resolve a decision that needs manual resolution", async () => {
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "MANUAL_RESOLUTION_REQUIRED",
          status_label: "Manual resolution required",
          failure_reason: "The stored employee snapshot is stale.",
        }),
      ),
    );

    renderAt("/hr/contract-decisions/7");

    expect(
      await screen.findByText(
        "This decision needs manual HR resolution. Submit a new decision to continue.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resolve manually" }),
    ).toBeInTheDocument();
  });

  it("reports each notification delivery state", async () => {
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          notification_status: [
            {
              id: 11,
              event_key: "contract.final",
              milestone: "final",
              created_at: "2026-08-05T08:00:00Z",
              deliveries: [
                { channel: "email", status: "failed" },
                { channel: "whatsapp", status: "delivered" },
              ],
            },
            {
              id: 12,
              event_key: "contract.reminder",
              milestone: null,
              created_at: "2026-08-06T08:00:00Z",
              deliveries: [],
            },
          ],
        }),
      ),
    );

    renderAt("/hr/contract-decisions/7");

    expect(
      await screen.findByText("final: email failed, whatsapp delivered"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("contract.reminder: in-app only"),
    ).toBeInTheDocument();
  });

  it("shows a not-found state for a decision outside the caller's scope", async () => {
    getMock.mockRejectedValue(httpError(404));

    renderAt("/hr/contract-decisions/999");

    expect(
      await screen.findByText("This contract decision is not available."),
    ).toBeInTheDocument();
  });
});

describe("ContractDecisionsPage HR submission", () => {
  it("sends decimal strings, keeps the existing components and omits the derived total", async () => {
    submitMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "PENDING_CEO",
          status_label: "Pending CEO",
          proposed_terms: {
            basic_salary: "1500.00",
            transportation_allowance: "100.00",
            accommodation_allowance: "200.00",
            total_salary: "1800.00",
          },
        }),
      ),
    );

    renderAt("/hr/contract-decisions");

    fireEvent.click(await screen.findByRole("button", { name: "Take action" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Submit to CEO" }),
    );

    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const [employeeId, payload] = submitMock.mock.calls[0];
    expect(employeeId).toBe(101);
    // Prefilled components are re-sent verbatim as decimal strings, so an
    // untouched allowance is preserved rather than cleared.
    expect(payload.proposed_terms).toEqual({
      basic_salary: "1500.00",
      transportation_allowance: "100.00",
      accommodation_allowance: "200.00",
    });
    // The backend derives the total; sending a stale one would be a 422.
    expect(payload.proposed_terms).not.toHaveProperty("total_salary");
  });

  it("refuses a non-finite amount before it reaches the backend", async () => {
    renderAt("/hr/contract-decisions");

    fireEvent.click(await screen.findByRole("button", { name: "Take action" }));
    const basic = await screen.findByLabelText("Basic salary");
    fireEvent.change(basic, { target: { value: "Infinity" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit to CEO" }));

    expect(
      await screen.findByText(
        "Enter a non-negative amount with at most ten digits and two decimal places.",
        undefined,
        // antd re-renders the form on validation; 1s is tight on a loaded runner.
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized amount before it reaches the backend", async () => {
    renderAt("/hr/contract-decisions");

    fireEvent.click(await screen.findByRole("button", { name: "Take action" }));
    const basic = await screen.findByLabelText("Basic salary");
    // Eleven integer digits exceeds Decimal(12,2).
    fireEvent.change(basic, { target: { value: "12345678901.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit to CEO" }));

    expect(
      await screen.findByText(
        "Enter a non-negative amount with at most ten digits and two decimal places.",
        undefined,
        // antd re-renders the form on validation; 1s is tight on a loaded runner.
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("renders a 422 whose errors are a plain string array", async () => {
    submitMock.mockRejectedValue(
      httpError(422, {
        status: "error",
        message: "total_salary must equal the sum of the salary components.",
        errors: ["total_salary must equal the sum of the salary components."],
      }),
    );

    renderAt("/hr/contract-decisions");

    fireEvent.click(await screen.findByRole("button", { name: "Take action" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit to CEO" }));

    expect(
      await screen.findByText("The backend rejected this request"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "total_salary must equal the sum of the salary components.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a 422 whose errors are field/message objects", async () => {
    submitMock.mockRejectedValue(
      httpError(422, {
        status: "error",
        message: "Validation error",
        errors: [
          { field: "basic_salary", message: "Enter a finite decimal." },
          { field: "petrol_allowance", message: "Too many decimal places." },
        ],
      }),
    );

    renderAt("/hr/contract-decisions");

    fireEvent.click(await screen.findByRole("button", { name: "Take action" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit to CEO" }));

    expect(
      await screen.findByText("basic_salary: Enter a finite decimal."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("petrol_allowance: Too many decimal places."),
    ).toBeInTheDocument();
  });
});

describe("ContractDecisionsPage CEO decision", () => {
  const pendingCeo = () =>
    decision({
      status: "PENDING_CEO",
      status_label: "Pending CEO",
      workflow: {
        status: "in_review",
        can_approve: true,
        can_reject: true,
        history: [],
      },
    });

  beforeEach(() => {
    asCeo();
    getMock.mockResolvedValue(detailPayload(pendingCeo()));
  });

  it("reports the status the backend returned rather than assuming approval", async () => {
    approveMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "MANUAL_RESOLUTION_REQUIRED",
          status_label: "Manual resolution required",
        }),
      ),
    );

    renderAt("/ceo/contract-decisions/7");

    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveMock).toHaveBeenCalledTimes(1));
    // A 200 that came back MANUAL_RESOLUTION_REQUIRED is not an approval.
    expect(
      await screen.findByText("Backend status: Manual resolution required"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Contract decision approved/)).toBeNull();
  });

  it("sends a rejection and reports the returned status", async () => {
    rejectMock.mockResolvedValue(
      detailPayload(decision({ status: "REJECTED", status_label: "Rejected" })),
    );

    renderAt("/ceo/contract-decisions/7");

    fireEvent.click(await screen.findByRole("button", { name: /Reject/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(rejectMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Backend status: Rejected"),
    ).toBeInTheDocument();
  });

  it("explains a stale decision when the backend answers 403", async () => {
    approveMock.mockRejectedValue(httpError(403));

    renderAt("/ceo/contract-decisions/7");

    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText(
        "This decision moved on before your action was saved. The latest state has been reloaded.",
      ),
    ).toBeInTheDocument();
  });

  it("hides both actions when the workflow says the CEO cannot act", async () => {
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "PENDING_CEO",
          status_label: "Pending CEO",
          workflow: {
            status: "in_review",
            can_approve: false,
            can_reject: false,
            history: [],
          },
        }),
      ),
    );

    renderAt("/ceo/contract-decisions/7");

    await screen.findByText("Pending CEO");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});

describe("ContractDecisionsPage Arabic", () => {
  it("renders the manual-resolution surface in Arabic", async () => {
    useI18nStore.getState().setLanguage("ar");
    getMock.mockResolvedValue(
      detailPayload(
        decision({
          status: "MANUAL_RESOLUTION_REQUIRED",
          status_label: "يتطلب معالجة يدوية",
        }),
      ),
    );

    renderAt("/hr/contract-decisions/7");

    expect(await screen.findByText("سجل سير العمل")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "معالجة يدوية" }),
    ).toBeInTheDocument();
  });
});
