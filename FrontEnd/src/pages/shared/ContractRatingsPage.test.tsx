import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/contractRatingsApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/api/contractRatingsApi")
  >()),
  getRatingCriteria: vi.fn(),
  getContractRating: vi.fn(),
  listContractRatings: vi.fn(),
  submitRatingCeoDecision: vi.fn(),
  submitRatingHrGate: vi.fn(),
}));

import ContractRatingsPage from "./ContractRatingsPage";
import * as api from "../../services/api/contractRatingsApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getRating = vi.mocked(api.getContractRating);
const decide = vi.mocked(api.submitRatingCeoDecision);

const header = {
  id: 1,
  company: 5,
  employee: {
    id: 4,
    employee_id: "RTUI-emp1",
    employee_number: "",
    full_name: "RT EMP1",
    department: "",
    section: "",
    job_title: "Engineer",
    manager_at_creation: 3,
  },
  evaluation_period_from: "2025-12-05",
  evaluation_period_to: "2026-12-05",
  contract_date: "2025-12-05",
  contract_expiry: "2026-12-05",
  manager_name: "RT MGR",
};

const fullBase = {
  ...header,
  viewer: "full" as const,
  status: "PENDING_CEO" as const,
  contract_decision: 11,
  hr_gate_decided_by: 8,
  hr_gate_decided_by_name: "Hana HR",
  hr_gate_decided_at: "2026-09-10T08:00:00Z",
  manager_at_creation: 3,
  department_snapshot: "",
  section_snapshot: "",
  job_title_snapshot: "Engineer",
  hr_comment_requested_by: null,
  hr_comment_requested_by_name: "",
  hr_comment_requested_at: null,
  hr_comment_by: null,
  hr_comment_by_name: "",
  hr_comment: "",
  hr_comment_submitted_at: null,
  ceo_decision: "" as const,
  ceo_decided_by: null,
  ceo_decided_by_name: "",
  ceo_comment: "",
  ceo_decided_at: null,
  salary_before_snapshot: {},
  ceo_approved_terms: {},
  salary_effective_date: null,
  salary_change_applied_at: null,
  salary_after_snapshot: {},
  salary_increase_amount: "0",
  salary_increase_percent: "0.00",
  scheduled_termination: false,
  employee_notified_of_termination_at: null,
  employee_notified_of_termination_by: null,
  termination_processed_at: null,
  current_terms: { basic_salary: "5000.00", total_salary: "5000.00" },
  remaining_contract_days: 80,
  employment_status: "ACTIVE",
  is_archived: false,
  archive_reason: "",
  workflow: { status: "in_review" as const, history: [], can_approve: true },
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-01T08:00:00Z",
};

const ratedFull: api.RatedFullContractRating = {
  ...fullBase,
  rating_mode: "RATE",
  manager_response: null,
  employee_response: null,
  comparison_summary: {},
};

const skippedFull: api.SkippedFullContractRating = {
  ...fullBase,
  rating_mode: "SKIP_TO_CEO",
};

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  vi.mocked(api.getRatingCriteria).mockResolvedValue({
    status: "success",
    data: { criteria: [], grade_ranges: {} as api.GradeRanges },
  });
  vi.mocked(api.listContractRatings).mockResolvedValue({
    status: "success",
    data: { items: [] },
  });
  decide.mockReset().mockResolvedValue({
    status: "success",
    data: { ...skippedFull, status: "DECIDED", ceo_decision: "RENEW" },
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/hr/contract-ratings" element={<ContractRatingsPage />} />
        <Route path="/hr/contract-ratings/:id" element={<ContractRatingsPage />} />
        <Route path="/ceo/contract-ratings" element={<ContractRatingsPage />} />
        <Route path="/ceo/contract-ratings/:id" element={<ContractRatingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ContractRatingsPage — HR", () => {
  it("shows a restricted notice, not rating content, for a manager-shaped payload", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...header,
        viewer: "manager",
        status: "PENDING_RESPONSES",
        rating_mode: "RATE",
        manager_response: null,
      },
    });
    renderAt("/hr/contract-ratings/1");
    expect(await screen.findByText("You are a rater on this evaluation")).toBeTruthy();
    expect(screen.queryByText("Comparison")).toBeNull();
  });

  it("offers the one-time routing choice with the account signal on the gate", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...header,
        viewer: "hr_coarse",
        status: "PENDING_HR_GATE",
        rating_mode: "",
        hr_comment_requested_at: null,
        gate: {
          account_connected: false,
          hr_gate_decided_by: null,
          hr_gate_decided_by_name: "",
          hr_gate_decided_at: null,
        },
        outcome: null,
      },
    });
    renderAt("/hr/contract-ratings/1");
    expect(await screen.findByRole("button", { name: /Rate this employee/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send straight to the CEO/ })).toBeTruthy();
    expect(screen.getByText("No linked self-service account")).toBeTruthy();
    // Decision support only: both options stay available without an account.
    expect(
      (screen.getByRole("button", { name: /Rate this employee/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows only coarse status on a pending-CEO rating HR was not asked about", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...header,
        viewer: "hr_coarse",
        status: "PENDING_CEO",
        rating_mode: "RATE",
        hr_comment_requested_at: null,
        gate: null,
        outcome: null,
      },
    });
    renderAt("/hr/contract-ratings/1");
    expect(await screen.findByText("Rating content is confidential")).toBeTruthy();
    expect(screen.queryByText("Comparison")).toBeNull();
    expect(screen.queryByRole("button", { name: /Rate this employee/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Renew/ })).toBeNull();
  });

  it("gives an unlocked HR viewer a comment box but no decision controls", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...ratedFull,
        hr_comment_requested_at: "2026-09-15T08:00:00Z",
        hr_comment_requested_by_name: "The CEO",
      },
    });
    renderAt("/hr/contract-ratings/1");
    expect(await screen.findByText("Comparison")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Submit comment/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^check Renew$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Return/ })).toBeNull();
  });

  it("shows the recorded termination notice and hides the button once set", async () => {
    const outcome = {
      ceo_decision: "TERMINATE" as const,
      ceo_comment: "Not renewing",
      ceo_decided_at: "2026-09-16T08:00:00Z",
      ceo_decided_by: 9,
      ceo_approved_terms: {},
      salary_effective_date: null,
      salary_change_applied_at: null,
      salary_after_snapshot: {},
      scheduled_termination: true,
      employee_notified_of_termination_at: "2026-09-17T09:00:00Z",
      employee_notified_of_termination_by: 2,
      termination_processed_at: null,
    };
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...header,
        viewer: "hr_coarse",
        status: "DECIDED",
        rating_mode: "RATE",
        hr_comment_requested_at: null,
        gate: null,
        outcome,
      },
    });
    renderAt("/hr/contract-ratings/1");
    expect(await screen.findByText("Terminate")).toBeTruthy();
    expect(screen.getByText("Employee notified")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Record employee notified/ }),
    ).toBeNull();
    // Still no rating content for HR.
    expect(screen.queryByText("Comparison")).toBeNull();
  });
});

describe("ContractRatingsPage — CEO", () => {
  it("offers three outcomes plus returns on a rated cycle", async () => {
    getRating.mockResolvedValue({ status: "success", data: ratedFull });
    renderAt("/ceo/contract-ratings/1");
    expect(await screen.findByText("Comparison")).toBeTruthy();
    for (const name of ["Renew", "Renew with increase", "Terminate"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^\\S* ?${name}$`) })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: /Return to manager/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Return to employee/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Return to both/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Request HR comment/ })).toBeTruthy();
  });

  it("replaces evaluation panels with a banner and hides returns on a skipped cycle", async () => {
    getRating.mockResolvedValue({ status: "success", data: skippedFull });
    renderAt("/ceo/contract-ratings/1");
    expect(
      await screen.findByText("HR sent this contract directly to you without a rating"),
    ).toBeTruthy();
    expect(screen.queryByText("Comparison")).toBeNull();
    expect(screen.queryByText("Manager evaluation")).toBeNull();
    expect(screen.queryByRole("button", { name: /Return to/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Renew with increase/ })).toBeTruthy();
    // The banner names who routed it, from hr_gate_decided_by_name.
    expect(screen.getByText(/Routed by Hana HR/)).toBeTruthy();
  });

  it("leaves the queue after a return, since the CEO can no longer fetch it", async () => {
    getRating.mockResolvedValue({ status: "success", data: ratedFull });
    // The backend answers a return with a CEO-shaped payload in its new state.
    decide.mockResolvedValue({
      status: "success",
      data: { ...ratedFull, status: "WAITING_EMPLOYEE" },
    });
    renderAt("/ceo/contract-ratings/1");
    fireEvent.click(
      await screen.findByRole("button", { name: /Return to employee/ }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("textarea")!, {
      target: { value: "Justify the cooperation score" },
    });
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (button) => button.textContent === "Return for correction",
      )!,
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(1, {
        ceo_decision: "RETURN_TO_EMPLOYEE",
        comment: "Justify the cooperation score",
      }),
    );
    // Back to the queue rather than a detail view that would 404 on reload.
    expect(await screen.findByText("Employee contract ratings")).toBeTruthy();
  });

  it("renders salary inputs only under Renew with increase and never sends them for Renew", async () => {
    getRating.mockResolvedValue({ status: "success", data: skippedFull });
    renderAt("/ceo/contract-ratings/1");
    await screen.findByRole("button", { name: /Renew with increase/ });
    expect(screen.queryByLabelText("Basic salary")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Renew with increase/ }));
    expect(await screen.findByLabelText("Basic salary")).toBeTruthy();
    expect(screen.getByText(/Current: 5000.00/)).toBeTruthy();
  });

  it("sends a plain Renew decision without salary keys", async () => {
    getRating.mockResolvedValue({ status: "success", data: skippedFull });
    renderAt("/ceo/contract-ratings/1");
    fireEvent.click(await screen.findByRole("button", { name: /^\S* ?Renew$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (button) => button.textContent === "Renew",
      )!,
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(1, { ceo_decision: "RENEW", comment: "" }),
    );
  });

  it("lists the server's 422 messages instead of swallowing them", async () => {
    getRating.mockResolvedValue({ status: "success", data: skippedFull });
    decide.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          status: "error",
          message: "Validation error",
          errors: ["This rating is not pending a CEO decision."],
        },
      },
    });
    renderAt("/ceo/contract-ratings/1");
    fireEvent.click(await screen.findByRole("button", { name: /^\S* ?Terminate$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (button) => button.textContent === "Terminate",
      )!,
    );
    expect(
      await screen.findByText("This rating is not pending a CEO decision."),
    ).toBeTruthy();
  });
});
