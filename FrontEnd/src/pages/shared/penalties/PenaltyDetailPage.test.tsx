import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PenaltyDetailPage from "./PenaltyDetailPage";
import * as penaltiesApi from "../../../services/api/penaltiesApi";
import type { PenaltyRecord } from "../../../services/api/penaltiesApi";
import * as employeesApi from "../../../services/api/employeesApi";
import type { Employee } from "../../../services/api/employeesApi";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "7" }),
}));
vi.mock("../../../services/api/penaltiesApi", async () => {
  const actual = await vi.importActual<typeof penaltiesApi>(
    "../../../services/api/penaltiesApi",
  );
  return {
    ...actual,
    getPenalty: vi.fn(),
    getPenaltyCatalog: vi.fn(),
    markPenaltyDisruption: vi.fn(),
    acknowledgePenalty: vi.fn(),
    resolvePenalty: vi.fn(),
  };
});
vi.mock("../../../services/api/employeesApi", () => ({
  getEmployee: vi.fn(),
}));

const record: PenaltyRecord = {
  id: 7,
  company_id: 1,
  employee_profile_id: 2,
  employee_name_en: "Employee One",
  employee_name_ar: "الموظف الأول",
  catalog_code: "O01",
  category: "work_organization",
  occurred_on: "2026-09-29",
  occurrence_number: 1,
  count_period: "cumulative",
  action: "written_warning",
  amount: "0.00",
  status: "issued",
  source: "hr",
  description: "Manual incident",
  description_en: "Manual incident",
  description_ar: "مخالفة يدوية",
  note: "Reviewed",
  employee_response: null,
  dispute_reason: null,
  resolution: null,
  payroll_status: null,
  created_at: "2026-09-29T10:00:00Z",
  updated_at: "2026-09-29T10:00:00Z",
};

beforeEach(() => {
  vi.mocked(penaltiesApi.getPenalty).mockReset();
  vi.mocked(penaltiesApi.markPenaltyDisruption).mockReset();
  vi.mocked(penaltiesApi.acknowledgePenalty).mockReset();
  vi.mocked(penaltiesApi.resolvePenalty).mockReset();
  vi.mocked(penaltiesApi.getPenaltyCatalog)
    .mockReset()
    .mockResolvedValue({ status: "success", data: [] });
  // The signed-in employee owns `record` (employee_profile_id 2).
  vi.mocked(employeesApi.getEmployee)
    .mockReset()
    .mockResolvedValue({
      status: "success",
      data: { id: 2 } as Employee,
    });
});

describe("penalty detail actions", () => {
  it("offers employee responses only on issued HR records", async () => {
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: record,
    });
    render(<PenaltyDetailPage role="employee" />);
    expect(
      await screen.findByRole("button", { name: "Acknowledge" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dispute" })).toBeInTheDocument();
  });

  it("does not offer employee actions on automatic attendance records", async () => {
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: { ...record, source: "automatic" },
    });
    render(<PenaltyDetailPage role="employee" />);
    expect((await screen.findAllByText("Employee One")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByRole("button", { name: "Acknowledge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dispute" }),
    ).not.toBeInTheDocument();
  });

  it("lets the employee download and dispute an automatic warning without showing a count", async () => {
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: {
        ...record,
        catalog_code: "W01",
        source: "automatic",
        automation: "warning_issued",
        occurrence_number: null,
        resolution: {
          decision: "auto_warning",
          resolved_at: "2026-09-30T08:00:00Z",
        },
        warning_notice: {
          id: 3,
          reference_number: "PWN-FFI-000007",
          delivery_status: "scheduled",
          issued_at: "2026-09-30T08:00:00Z",
          download_path: "/api/penalties/7/warning-notice/",
        },
      },
    });
    render(<PenaltyDetailPage role="employee" />);
    expect(
      await screen.findByRole("button", { name: "Download warning letter" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Automatic warning").length).toBeGreaterThan(0);
    expect(screen.getByText("Automatic warning issued")).toBeInTheDocument();
    expect(screen.queryByText("Occurrence")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Dispute" }),
    ).toBeInTheDocument();
  });

  it("preserves the dispute option after acknowledgment, including an applied penalty", async () => {
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: {
        ...record,
        status: "applied",
        employee_response: {
          decision: "acknowledged",
          reason: null,
          submitted_at: "2026-09-30T10:00:00Z",
        },
      },
    });
    render(<PenaltyDetailPage role="employee" />);
    expect(
      await screen.findByRole("button", { name: "Dispute" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Acknowledge" }),
    ).not.toBeInTheDocument();
  });

  it("submits the selected attendance branch to HR marking", async () => {
    const pending = {
      ...record,
      catalog_code: "W02",
      category: "work_time",
      source: "automatic",
      status: "pending_hr_mark" as const,
    };
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: pending,
    });
    vi.mocked(penaltiesApi.markPenaltyDisruption).mockResolvedValue({
      status: "success",
      data: { ...pending, status: "issued" },
    });
    render(<PenaltyDetailPage role="hr" />);
    expect(
      await screen.findByText(
        /Select whether this lateness disrupted other workers/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disrupted work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Excuse incident" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm attendance violation" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "No work disruption" }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "No other workers delayed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(penaltiesApi.markPenaltyDisruption).toHaveBeenCalledWith(7, {
        disruption: "not_disrupted",
        note: "No other workers delayed",
      }),
    );
  });

  it("confirms a non-branch attendance row without offering disruption choices", async () => {
    const pending = {
      ...record,
      catalog_code: "W08",
      category: "work_time",
      source: "automatic",
      status: "pending_hr_mark" as const,
    };
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: pending,
    });
    vi.mocked(penaltiesApi.markPenaltyDisruption).mockResolvedValue({
      status: "success",
      data: { ...pending, status: "issued" },
    });
    render(<PenaltyDetailPage role="hr" />);
    expect(
      await screen.findByText(
        /Confirm only after verifying the attendance facts/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Excuse incident" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Disrupted work" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "No work disruption" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm attendance violation" }),
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "No permission or excuse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(penaltiesApi.markPenaltyDisruption).toHaveBeenCalledWith(7, {
        disruption: "confirmed",
        note: "No permission or excuse",
      }),
    );
  });

  it("hides employee responses when the record belongs to someone else", async () => {
    vi.mocked(employeesApi.getEmployee).mockResolvedValue({
      status: "success",
      data: { id: 99 } as Employee,
    });
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: record,
    });
    render(<PenaltyDetailPage role="employee" />);
    await waitFor(() =>
      expect(employeesApi.getEmployee).toHaveBeenCalledWith("me"),
    );
    expect((await screen.findAllByText("Employee One")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByRole("button", { name: "Acknowledge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dispute" }),
    ).not.toBeInTheDocument();
  });

  it("reloads the record and shows a localized message after a 409 conflict", async () => {
    vi.mocked(penaltiesApi.getPenalty)
      .mockResolvedValueOnce({ status: "success", data: record })
      .mockResolvedValue({
        status: "success",
        data: {
          ...record,
          employee_response: {
            decision: "acknowledged",
            reason: null,
            submitted_at: "2026-09-30T10:00:00Z",
          },
        },
      });
    vi.mocked(penaltiesApi.acknowledgePenalty).mockRejectedValue({
      message: "Request failed with status code 409",
      response: { status: 409 },
      apiData: {
        status: "error",
        message: "This penalty cannot be acknowledged.",
      },
    });
    render(<PenaltyDetailPage role="employee" />);
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
    expect(
      await screen.findByText(/can no longer be acknowledged/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(penaltiesApi.getPenalty).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Acknowledge" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders deductions with the riyal symbol and hides pending candidate noise", async () => {
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: {
        ...record,
        action: "deduction",
        amount: "150.5",
        extra_wage_amount: "0.00",
        total_deduction_amount: "150.5",
      },
    });
    vi.mocked(penaltiesApi.getPenaltyCatalog).mockResolvedValue({
      status: "success",
      data: [
        {
          code: "O01",
          category: "work_organization",
          title_en: "Late report",
          title_ar: "تأخر التقرير",
          description_en: "",
          description_ar: "",
          count_period: "cumulative",
          levels: [],
          automatic: false,
        },
      ],
    });
    const { unmount } = render(<PenaltyDetailPage role="hr" />);
    expect(await screen.findByText("Late report (O01)")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Late report" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("150.5").length).toBe(2);
    expect(screen.getAllByLabelText("Saudi Riyal").length).toBe(2);
    unmount();

    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: {
        ...record,
        source: "automatic",
        status: "pending_hr_mark",
        action: "pending_hr_mark",
        occurrence_number: 0,
        amount: "0.00",
      },
    });
    render(<PenaltyDetailPage role="hr" />);
    expect(await screen.findByText("Awaiting HR decision")).toBeInTheDocument();
    expect(screen.queryByText("Occurrence")).not.toBeInTheDocument();
    expect(screen.queryByText("Sanction amount (SAR)")).not.toBeInTheDocument();
  });

  it.each(["issued", "disputed"] as const)(
    "offers correction waiver and explicit reopen while blocking approval for %s",
    async (status) => {
      const correction: PenaltyRecord = {
        ...record,
        status,
        source: "automatic",
        catalog_code: "W03",
        action: "deduction",
        amount: "10.00",
        total_deduction_amount: "10.00",
        payroll_status: "held",
        resolution: {
          decision: "manual_review",
          proposed_evidence: {
            catalog_code: "W05",
            released_wage_dates: ["2026-09-29"],
            proposed_wage_absence_dates: ["2026-09-29", "2026-09-30"],
            occurred_on: "2026-09-29",
            evidence: { minutes: 50, scheduled_minutes: 540 },
          },
        },
      };
      vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
        status: "success",
        data: correction,
      });
      vi.mocked(penaltiesApi.resolvePenalty).mockResolvedValue({
        status: "success",
        data: {
          ...correction,
          status: "pending_hr_mark",
          resolution: { decision: "reopened" },
        },
      });
      render(<PenaltyDetailPage role="hr" />);
      const reopen = await screen.findByRole("button", {
        name: "Reopen for HR assessment",
      });
      expect(screen.getByRole("button", { name: "Waive" })).toBeInTheDocument();
      expect(
        screen.getByText(/Absence wage dates released by waiver/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Absence wage dates proposed for reassessment/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Uphold" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Approve for payroll" }),
      ).not.toBeInTheDocument();
      fireEvent.click(reopen);
      expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Review corrected arrival" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
      await waitFor(() =>
        expect(penaltiesApi.resolvePenalty).toHaveBeenCalledWith(7, {
          decision: "reopen",
          note: "Review corrected arrival",
        }),
      );
    },
  );

  it("keeps applied correction reviews on a waiver path without reopen or payroll approval", async () => {
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: {
        ...record,
        source: "automatic",
        status: "applied",
        payroll_status: "applied",
        resolution: {
          decision: "manual_review",
          proposed_evidence: {
            catalog_code: "W05",
            occurred_on: "2026-09-29",
            evidence: { minutes: 50 },
          },
        },
      },
    });
    render(<PenaltyDetailPage role="hr" />);
    expect(
      await screen.findByRole("button", { name: "Waive" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reopen for HR assessment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Uphold" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve for payroll" }),
    ).not.toBeInTheDocument();
  });

  it("offers an audited re-rate only for unapplied recurrence-only reviews", async () => {
    const recurrence: PenaltyRecord = {
      ...record,
      action: "deduction",
      amount: "25.00",
      total_deduction_amount: "25.00",
      occurrence_number: 2,
      payroll_status: "held",
      resolution: {
        decision: "manual_review",
        proposed_evidence: { expected_occurrence: 1 },
      },
    };
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: recurrence,
    });
    vi.mocked(penaltiesApi.resolvePenalty).mockResolvedValue({
      status: "success",
      data: { ...recurrence, resolution: { decision: "recurrence_rerated" } },
    });
    const { unmount } = render(<PenaltyDetailPage role="hr" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Re-rate recurrence" }),
    );
    expect(
      screen.queryByRole("button", { name: "Reopen for HR assessment" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Earlier incident was waived" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(penaltiesApi.resolvePenalty).toHaveBeenCalledWith(7, {
        decision: "rerate",
        note: "Earlier incident was waived",
      }),
    );
    unmount();
    vi.mocked(penaltiesApi.getPenalty).mockResolvedValue({
      status: "success",
      data: { ...recurrence, status: "applied", payroll_status: "applied" },
    });
    render(<PenaltyDetailPage role="hr" />);
    expect(
      await screen.findByRole("button", { name: "Waive" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Re-rate recurrence" }),
    ).not.toBeInTheDocument();
  });
});
