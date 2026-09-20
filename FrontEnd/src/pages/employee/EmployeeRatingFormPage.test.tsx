import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../services/api/contractRatingsApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/api/contractRatingsApi")
  >()),
  getRatingCriteria: vi.fn(),
  getContractRating: vi.fn(),
  submitEmployeeRatingResponse: vi.fn(),
}));

import EmployeeRatingFormPage from "./EmployeeRatingFormPage";
import * as api from "../../services/api/contractRatingsApi";
import { useI18nStore } from "../../i18n/i18nStore";

const getCriteria = vi.mocked(api.getRatingCriteria);
const getRating = vi.mocked(api.getContractRating);
const submit = vi.mocked(api.submitEmployeeRatingResponse);

const criteria = {
  status: "success" as const,
  data: {
    criteria: [
      {
        code: "work_accomplishment",
        label_en: "Work",
        label_ar: "العمل",
        display_order: 1,
      },
      {
        code: "cooperation",
        label_en: "Cooperation",
        label_ar: "التعاون",
        display_order: 2,
      },
    ],
    grade_ranges: {
      EXCELLENT: [90, 100],
      VERY_GOOD: [80, 89],
      GOOD: [70, 79],
      ACCEPTABLE: [60, 69],
      POOR: [0, 59],
    } as api.GradeRanges,
  },
};

// Captured from the live backend for an employee viewer: header + own response only.
const employeeView: api.EmployeeContractRatingView = {
  viewer: "employee",
  id: 1,
  status: "PENDING_RESPONSES",
  rating_mode: "RATE",
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
  employee_response: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/employee/contract-ratings/1"]}>
      <Routes>
        <Route
          path="/employee/contract-ratings/:id"
          element={<EmployeeRatingFormPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useI18nStore.getState().setLanguage("en");
  getCriteria.mockReset().mockResolvedValue(criteria);
  getRating.mockReset().mockResolvedValue({
    status: "success",
    data: employeeView,
  });
  submit.mockReset();
});

describe("EmployeeRatingFormPage", () => {
  it("renders no manager recommendation block", async () => {
    renderPage();
    expect(await screen.findByText("1. Work")).toBeTruthy();
    expect(screen.queryByText("Recommendation")).toBeNull();
    expect(screen.queryByText("Salary proposal")).toBeNull();
  });

  it("explains when this self-evaluation is required to continue", async () => {
    renderPage();

    expect(
      await screen.findByText("Complete your self-evaluation to continue"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "You have an outstanding contract self-evaluation. Submit it to regain access to the rest of the employee portal.",
      ),
    ).toBeTruthy();
  });

  it("submits only criterion_ratings and overall_remark", async () => {
    submit.mockResolvedValue({
      status: "success",
      data: { ...employeeView, status: "WAITING_MANAGER" },
    });
    renderPage();
    await screen.findByText("1. Work");

    fireEvent.click(screen.getAllByText("Excellent")[0]);
    fireEvent.change(screen.getByLabelText("Score: Work"), {
      target: { value: "95" },
    });
    fireEvent.click(screen.getAllByText("Good")[1]);
    fireEvent.change(screen.getByLabelText("Score: Cooperation"), {
      target: { value: "72" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit evaluation" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const payload = submit.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual([
      "criterion_ratings",
      "overall_remark",
    ]);
    expect(payload.criterion_ratings).toEqual({
      work_accomplishment: { grade: "EXCELLENT", score: 95, remark: "" },
      cooperation: { grade: "GOOD", score: 72, remark: "" },
    });
  });

  it("blocks submission while a criterion is incomplete", async () => {
    renderPage();
    await screen.findByText("1. Work");
    fireEvent.click(screen.getByRole("button", { name: "Submit evaluation" }));
    expect(
      (await screen.findAllByText("Select a grade and enter a score.")).length,
    ).toBe(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it("pre-fills a returned response and shows the CEO's reason", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...employeeView,
        employee_response: {
          id: 9,
          rater_type: "EMPLOYEE",
          status: "RETURNED",
          submitted_by: 4,
          submitted_by_name: "RT EMP1",
          criterion_ratings: {
            work_accomplishment: { grade: "VERY_GOOD", score: 84, remark: "" },
            cooperation: { grade: "GOOD", score: 71, remark: "team" },
          },
          average_score: "77.50",
          overall_grade: "GOOD",
          overall_remark: "first pass",
          submitted_at: "2026-09-01T10:00:00Z",
          returned_at: "2026-09-02T10:00:00Z",
          returned_by: 7,
          return_reason: "Please justify the cooperation score",
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-02T10:00:00Z",
        },
      },
    });
    renderPage();
    expect(
      await screen.findByText(/Please justify the cooperation score/),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Score: Work") as HTMLInputElement).value,
    ).toBe("84");
    expect(screen.getByDisplayValue("first pass")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Resubmit evaluation" }),
    ).toBeTruthy();
  });

  it("refuses to render a form from a non-employee payload", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...employeeView,
        viewer: "manager",
        manager_response: null,
      } as unknown as api.ContractRatingView,
    });
    renderPage();
    expect(
      await screen.findByText("This self-evaluation belongs to another employee."),
    ).toBeTruthy();
    expect(screen.queryByText("1. Work")).toBeNull();
  });

  it("shows a read-only state once submitted", async () => {
    getRating.mockResolvedValue({
      status: "success",
      data: {
        ...employeeView,
        status: "PENDING_CEO",
        employee_response: {
          id: 9,
          rater_type: "EMPLOYEE",
          status: "SUBMITTED",
          submitted_by: 4,
          submitted_by_name: "RT EMP1",
          criterion_ratings: {},
          average_score: "90.00",
          overall_grade: "EXCELLENT",
          overall_remark: "",
          submitted_at: "2026-09-01T10:00:00Z",
          returned_at: null,
          returned_by: null,
          return_reason: "",
          created_at: "2026-09-01T10:00:00Z",
          updated_at: "2026-09-01T10:00:00Z",
        },
      },
    });
    renderPage();
    expect(await screen.findByText(/^Submitted\. Your evaluation is locked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Submit evaluation/ })).toBeNull();
  });
});
