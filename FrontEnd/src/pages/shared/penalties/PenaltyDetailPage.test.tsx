import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PenaltyDetailPage from "./PenaltyDetailPage";
import * as penaltiesApi from "../../../services/api/penaltiesApi";
import type { PenaltyRecord } from "../../../services/api/penaltiesApi";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "7" }),
}));
vi.mock("../../../services/api/penaltiesApi", async () => {
  const actual = await vi.importActual<typeof penaltiesApi>(
    "../../../services/api/penaltiesApi",
  );
  return { ...actual, getPenalty: vi.fn(), markPenaltyDisruption: vi.fn() };
});

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
});
